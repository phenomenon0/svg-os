use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::Mutex;

use crate::events::EventBus;
use crate::graph::{Graph, MetaUpdate, NodeUpdate};
use crate::types::*;

/// Trait for executing a specific node type.
/// Implementations are registered per node type string.
#[async_trait]
pub trait NodeExecutor: Send + Sync {
    async fn execute(&self, ctx: &mut ExecContext, node_id: &str) -> Result<(), String>;
}

/// Execution context passed to node executors.
pub struct ExecContext {
    pub node_id: String,
    pub node_type: String,
    pub config: serde_json::Value,
    pub inputs: HashMap<String, serde_json::Value>,
    outputs: HashMap<String, serde_json::Value>,
}

impl ExecContext {
    pub fn get_input(&self, port_name: &str) -> Option<&serde_json::Value> {
        self.inputs.get(port_name)
    }

    pub fn set_output(&mut self, port_name: &str, value: serde_json::Value) {
        self.outputs.insert(port_name.to_string(), value);
    }

    pub fn take_outputs(self) -> HashMap<String, serde_json::Value> {
        self.outputs
    }
}

/// The scheduler runs the execution plan, dispatching to registered executors.
pub struct Scheduler {
    executors: HashMap<String, Arc<dyn NodeExecutor>>,
    output_cache: HashMap<String, serde_json::Value>, // "nodeId:portName" -> value
    running: bool,
    cancelled: bool,
    rerun_requested: bool,
    concurrency_limit: usize,
}

impl Scheduler {
    pub fn new() -> Self {
        Self {
            executors: HashMap::new(),
            output_cache: HashMap::new(),
            running: false,
            cancelled: false,
            rerun_requested: false,
            concurrency_limit: num_cpus(),
        }
    }

    pub fn register_executor(&mut self, node_type: &str, executor: Arc<dyn NodeExecutor>) {
        self.executors.insert(node_type.to_string(), executor);
    }

    pub fn is_running(&self) -> bool {
        self.running
    }

    pub fn cancel(&mut self) {
        self.cancelled = true;
    }

    pub fn get_output(&self, node_id: &str, port_name: &str) -> Option<&serde_json::Value> {
        self.output_cache.get(&format!("{}:{}", node_id, port_name))
    }

    pub async fn execute(
        &mut self,
        graph: &Arc<Mutex<Graph>>,
        events: &EventBus,
        plan: Option<ExecutionPlan>,
    ) {
        if self.running {
            self.rerun_requested = true;
            return;
        }

        self.running = true;
        self.cancelled = false;

        let mut current_plan = plan;

        loop {
            self.rerun_requested = false;
            self.output_cache.clear();

            let execution_plan = match current_plan.take() {
                Some(p) => p,
                None => {
                    let g = graph.lock().await;
                    g.plan_execution()
                }
            };

            events.emit(GraphEvent::ExecStart {
                node_count: execution_plan.order.len(),
            });

            // Handle cycles
            if execution_plan.has_cycle {
                let mut g = graph.lock().await;
                for cycle_node_id in &execution_plan.cycle_nodes {
                    g.update_node(
                        cycle_node_id,
                        NodeUpdate {
                            status: Some(NodeStatus::Error),
                            error: Some("Cycle detected in graph".to_string()),
                            ..Default::default()
                        },
                    );
                }
                events.emit(GraphEvent::ExecCycle {
                    node_ids: execution_plan.cycle_nodes.clone(),
                });
            }

            // Execute level by level
            for level in &execution_plan.levels {
                if self.cancelled {
                    break;
                }
                self.execute_level(level, graph, events).await;
            }

            events.emit(GraphEvent::ExecComplete {
                cancelled: self.cancelled,
                rerun_requested: self.rerun_requested,
            });

            if !self.rerun_requested || self.cancelled {
                break;
            }
        }

        self.running = false;
    }

    pub async fn execute_node(
        &mut self,
        node_id: &str,
        graph: &Arc<Mutex<Graph>>,
        events: &EventBus,
    ) {
        let full_plan = {
            let g = graph.lock().await;
            g.plan_execution()
        };

        let idx = match full_plan.order.iter().position(|id| id == node_id) {
            Some(i) => i,
            None => return,
        };

        let mut downstream = HashSet::new();
        downstream.insert(node_id.to_string());

        let g = graph.lock().await;
        for i in (idx + 1)..full_plan.order.len() {
            let upstream = g.get_upstream(&full_plan.order[i]);
            if upstream.iter().any(|u| downstream.contains(u)) {
                downstream.insert(full_plan.order[i].clone());
            }
        }
        drop(g);

        let sub_plan = ExecutionPlan {
            order: full_plan
                .order
                .iter()
                .filter(|id| downstream.contains(id.as_str()))
                .cloned()
                .collect(),
            levels: full_plan
                .levels
                .iter()
                .map(|level| {
                    level
                        .iter()
                        .filter(|id| downstream.contains(id.as_str()))
                        .cloned()
                        .collect::<Vec<_>>()
                })
                .filter(|level: &Vec<String>| !level.is_empty())
                .collect(),
            cycle_nodes: full_plan
                .cycle_nodes
                .iter()
                .filter(|id| downstream.contains(id.as_str()))
                .cloned()
                .collect(),
            has_cycle: full_plan
                .cycle_nodes
                .iter()
                .any(|id| downstream.contains(id.as_str())),
        };

        self.execute(graph, events, Some(sub_plan)).await;
    }

    async fn execute_level(
        &mut self,
        level: &[NodeId],
        graph: &Arc<Mutex<Graph>>,
        events: &EventBus,
    ) {
        if level.is_empty() {
            return;
        }

        let mut parallel = Vec::new();
        let mut exclusive_groups: HashMap<String, Vec<NodeId>> = HashMap::new();

        {
            let g = graph.lock().await;
            for node_id in level {
                let node = g.get_node(node_id);
                let def = node.and_then(|n| g.get_node_def(&n.node_type));
                let execution = def.and_then(|d| d.execution.as_ref());

                let exclusive_key = match execution {
                    Some(ep) => match ep.mode {
                        Some(ExecutionMode::Exclusive) => Some(
                            ep.concurrency_key
                                .clone()
                                .unwrap_or_else(|| format!("{}:exclusive", node_id)),
                        ),
                        _ => ep.concurrency_key.clone(),
                    },
                    None => None,
                };

                if let Some(key) = exclusive_key {
                    exclusive_groups
                        .entry(key)
                        .or_default()
                        .push(node_id.clone());
                } else {
                    parallel.push(node_id.clone());
                }
            }
        }

        // Execute parallel nodes with bounded concurrency
        if !parallel.is_empty() {
            // For simplicity, execute sequentially for now (tokio tasks would add complexity
            // with the mutable output_cache). The Rust backend is fast enough that level-parallel
            // execution within a level is rarely the bottleneck.
            for node_id in &parallel {
                if self.cancelled {
                    return;
                }
                self.execute_single_node(node_id, graph, events).await;
            }
        }

        // Execute exclusive groups sequentially
        for node_ids in exclusive_groups.values() {
            for node_id in node_ids {
                if self.cancelled {
                    return;
                }
                self.execute_single_node(node_id, graph, events).await;
            }
        }
    }

    async fn execute_single_node(
        &mut self,
        node_id: &str,
        graph: &Arc<Mutex<Graph>>,
        events: &EventBus,
    ) {
        if self.cancelled {
            return;
        }

        let (node_type, config, inputs) = {
            let g = graph.lock().await;
            let node = match g.get_node(node_id) {
                Some(n) => n,
                None => return,
            };

            let node_type = node.node_type.clone();
            let config = node.config.clone();

            // Gather inputs from output cache
            let mut inputs = HashMap::new();
            let edges = g.get_edges_to(node_id, None);
            for edge in edges {
                let cache_key = format!("{}:{}", edge.from.node, edge.from.port);
                if let Some(val) = self.output_cache.get(&cache_key) {
                    inputs.insert(edge.to.port.clone(), val.clone());
                }
            }

            (node_type, config, inputs)
        };

        // Mark as running
        {
            let mut g = graph.lock().await;
            g.update_node(
                node_id,
                NodeUpdate {
                    status: Some(NodeStatus::Running),
                    clear_error: true,
                    ..Default::default()
                },
            );
        }

        events.emit(GraphEvent::ExecNodeStart {
            node_id: node_id.to_string(),
            node_type: node_type.clone(),
        });

        let executor = self.executors.get(&node_type).cloned();

        let mut ctx = ExecContext {
            node_id: node_id.to_string(),
            node_type: node_type.clone(),
            config,
            inputs,
            outputs: HashMap::new(),
        };

        let result = match executor {
            Some(exec) => exec.execute(&mut ctx, node_id).await,
            None => Err(format!("No executor registered for node type: {}", node_type)),
        };

        let outputs = ctx.take_outputs();

        // Store outputs in cache and update node
        for (port, value) in &outputs {
            self.output_cache
                .insert(format!("{}:{}", node_id, port), value.clone());
        }

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;

        match result {
            Ok(()) => {
                let mut g = graph.lock().await;
                let run_count = g
                    .get_node(node_id)
                    .map(|n| n.meta.run_count)
                    .unwrap_or(0);

                // Build data object from outputs
                let data = if outputs.is_empty() {
                    None
                } else {
                    let map: serde_json::Map<String, serde_json::Value> = outputs.into_iter().collect();
                    Some(serde_json::Value::Object(map))
                };

                g.update_node(
                    node_id,
                    NodeUpdate {
                        status: Some(NodeStatus::Done),
                        clear_error: true,
                        data,
                        meta: Some(MetaUpdate {
                            last_run: Some(now),
                            run_count: Some(run_count + 1),
                            position: None,
                            size: None,
                        }),
                        ..Default::default()
                    },
                );

                events.emit(GraphEvent::ExecNodeComplete {
                    node_id: node_id.to_string(),
                    node_type: node_type.clone(),
                    status: NodeStatus::Done,
                    error: None,
                });
            }
            Err(message) => {
                let mut g = graph.lock().await;
                g.update_node(
                    node_id,
                    NodeUpdate {
                        status: Some(NodeStatus::Error),
                        error: Some(message.clone()),
                        ..Default::default()
                    },
                );

                events.emit(GraphEvent::ExecNodeComplete {
                    node_id: node_id.to_string(),
                    node_type,
                    status: NodeStatus::Error,
                    error: Some(message),
                });
            }
        }
    }
}

fn num_cpus() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(8)
        .max(1)
}
