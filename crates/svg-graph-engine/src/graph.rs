use std::collections::{HashMap, HashSet, VecDeque};

use crate::events::EventBus;
use crate::types::*;

const MAX_UNDO: usize = 100;

pub struct Graph {
    nodes: HashMap<String, NodeState>,
    edges: HashMap<String, Edge>,
    edges_by_source: HashMap<String, HashSet<String>>,
    edges_by_target: HashMap<String, HashSet<String>>,
    node_defs: HashMap<String, NodeDef>,
    undo_stack: Vec<GraphSnapshot>,
    redo_stack: Vec<GraphSnapshot>,
    batching: bool,
    events: EventBus,
}

impl Graph {
    pub fn new() -> Self {
        Self {
            nodes: HashMap::new(),
            edges: HashMap::new(),
            edges_by_source: HashMap::new(),
            edges_by_target: HashMap::new(),
            node_defs: HashMap::new(),
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            batching: false,
            events: EventBus::new(),
        }
    }

    pub fn events(&self) -> &EventBus {
        &self.events
    }

    // ── Node type registry ──────────────────────────────────────────────

    pub fn register_node_def(&mut self, def: NodeDef) {
        self.node_defs.insert(def.node_type.clone(), def);
    }

    pub fn get_node_def(&self, node_type: &str) -> Option<&NodeDef> {
        self.node_defs.get(node_type)
    }

    pub fn list_node_defs(&self) -> Vec<&NodeDef> {
        self.node_defs.values().collect()
    }

    // ── Nodes ───────────────────────────────────────────────────────────

    pub fn add_node(
        &mut self,
        node_type: &str,
        config: Option<serde_json::Value>,
    ) -> Result<NodeId, String> {
        let def = self
            .node_defs
            .get(node_type)
            .ok_or_else(|| format!("Unknown node type: {}", node_type))?;
        let _ = def; // just validating it exists

        let id = new_id();
        let now = chrono_now();

        let state = NodeState {
            id: id.clone(),
            node_type: node_type.to_string(),
            config: config.unwrap_or(serde_json::Value::Object(serde_json::Map::new())),
            data: serde_json::Value::Object(serde_json::Map::new()),
            status: NodeStatus::Idle,
            error: None,
            meta: NodeMeta {
                created: now,
                last_run: 0,
                run_count: 0,
                position: None,
                size: None,
            },
        };

        if !self.batching {
            self.push_undo();
        }

        self.nodes.insert(id.clone(), state);
        self.edges_by_source.insert(id.clone(), HashSet::new());
        self.edges_by_target.insert(id.clone(), HashSet::new());

        self.events.emit(GraphEvent::NodeCreated {
            id: id.clone(),
            node_type: node_type.to_string(),
        });

        Ok(id)
    }

    /// Add a node with a pre-assigned ID (used when syncing from frontend).
    pub fn add_node_with_id(
        &mut self,
        id: &str,
        node_type: &str,
        config: Option<serde_json::Value>,
    ) -> Result<NodeId, String> {
        if self.nodes.contains_key(id) {
            return Err(format!("Node already exists: {}", id));
        }

        let now = chrono_now();
        let state = NodeState {
            id: id.to_string(),
            node_type: node_type.to_string(),
            config: config.unwrap_or(serde_json::Value::Object(serde_json::Map::new())),
            data: serde_json::Value::Object(serde_json::Map::new()),
            status: NodeStatus::Idle,
            error: None,
            meta: NodeMeta {
                created: now,
                last_run: 0,
                run_count: 0,
                position: None,
                size: None,
            },
        };

        if !self.batching {
            self.push_undo();
        }

        let id_string = id.to_string();
        self.nodes.insert(id_string.clone(), state);
        self.edges_by_source
            .insert(id_string.clone(), HashSet::new());
        self.edges_by_target
            .insert(id_string.clone(), HashSet::new());

        self.events.emit(GraphEvent::NodeCreated {
            id: id_string.clone(),
            node_type: node_type.to_string(),
        });

        Ok(id_string)
    }

    pub fn remove_node(&mut self, id: &str) {
        if !self.nodes.contains_key(id) {
            return;
        }

        if !self.batching {
            self.push_undo();
        }

        // Collect connected edges
        let mut connected = HashSet::new();
        if let Some(src) = self.edges_by_source.get(id) {
            connected.extend(src.iter().cloned());
        }
        if let Some(tgt) = self.edges_by_target.get(id) {
            connected.extend(tgt.iter().cloned());
        }

        // Remove connected edges
        for edge_id in &connected {
            if let Some(edge) = self.edges.remove(edge_id) {
                self.detach_edge(&edge);
                self.events.emit(GraphEvent::EdgeRemoved {
                    id: edge_id.clone(),
                });
            }
        }

        self.nodes.remove(id);
        self.edges_by_source.remove(id);
        self.edges_by_target.remove(id);

        self.events.emit(GraphEvent::NodeRemoved { id: id.to_string() });
    }

    pub fn get_node(&self, id: &str) -> Option<&NodeState> {
        self.nodes.get(id)
    }

    pub fn get_node_mut(&mut self, id: &str) -> Option<&mut NodeState> {
        self.nodes.get_mut(id)
    }

    pub fn get_nodes(&self) -> Vec<&NodeState> {
        self.nodes.values().collect()
    }

    pub fn update_node(&mut self, id: &str, updates: NodeUpdate) {
        let node = match self.nodes.get_mut(id) {
            Some(n) => n,
            None => return,
        };

        // Capture event fields before consuming updates
        let evt_status = updates.status.clone();
        let evt_error = updates.error.clone();

        if let Some(config) = updates.config {
            if let (Some(existing), Some(new)) = (node.config.as_object_mut(), config.as_object()) {
                for (k, v) in new {
                    existing.insert(k.clone(), v.clone());
                }
            } else {
                node.config = config;
            }
        }

        let evt_data = updates.data.clone();
        if let Some(data) = updates.data {
            if let (Some(existing), Some(new)) = (node.data.as_object_mut(), data.as_object()) {
                for (k, v) in new {
                    existing.insert(k.clone(), v.clone());
                }
            } else {
                node.data = data;
            }
        }

        if let Some(status) = updates.status {
            node.status = status;
        }

        if updates.clear_error {
            node.error = None;
        } else if let Some(error) = updates.error {
            node.error = Some(error);
        }

        if let Some(meta) = updates.meta {
            if let Some(lr) = meta.last_run {
                node.meta.last_run = lr;
            }
            if let Some(rc) = meta.run_count {
                node.meta.run_count = rc;
            }
            if let Some(pos) = meta.position {
                node.meta.position = Some(pos);
            }
            if let Some(size) = meta.size {
                node.meta.size = Some(size);
            }
        }

        self.events.emit(GraphEvent::NodeUpdated {
            id: id.to_string(),
            status: evt_status,
            data: evt_data,
            error: evt_error,
        });
    }

    // ── Edges ───────────────────────────────────────────────────────────

    pub fn add_edge(&mut self, from: PortRef, to: PortRef) -> Result<EdgeId, String> {
        // Validate nodes exist
        let from_node = self
            .nodes
            .get(&from.node)
            .ok_or("Source node not found")?;
        let to_node = self.nodes.get(&to.node).ok_or("Target node not found")?;

        // Validate port types
        let from_def = self
            .node_defs
            .get(&from_node.node_type)
            .ok_or("Source node type definition not found")?;
        let to_def = self
            .node_defs
            .get(&to_node.node_type)
            .ok_or("Target node type definition not found")?;

        let source_port = from_def
            .outputs
            .iter()
            .find(|p| p.name == from.port)
            .ok_or_else(|| format!("Output port '{}' not found on {}", from.port, from_node.node_type))?;
        let target_port = to_def
            .inputs
            .iter()
            .find(|p| p.name == to.port)
            .ok_or_else(|| format!("Input port '{}' not found on {}", to.port, to_node.node_type))?;

        if !source_port.port_type.is_compatible_with(&target_port.port_type) {
            return Err(format!(
                "Type mismatch: {:?} -> {:?}",
                source_port.port_type, target_port.port_type
            ));
        }

        // Check for duplicate
        for edge in self.edges.values() {
            if edge.from.node == from.node
                && edge.from.port == from.port
                && edge.to.node == to.node
                && edge.to.port == to.port
            {
                return Err("Edge already exists".to_string());
            }
        }

        if !self.batching {
            self.push_undo();
        }

        let id = new_id();
        let edge = Edge {
            id: id.clone(),
            from: from.clone(),
            to: to.clone(),
        };
        self.edges.insert(id.clone(), edge.clone());
        self.attach_edge(&edge);

        self.events.emit(GraphEvent::EdgeCreated {
            id: id.clone(),
            from,
            to,
        });

        Ok(id)
    }

    /// Add an edge with a pre-assigned ID and skip port validation (used when syncing from frontend).
    pub fn add_edge_unchecked(&mut self, id: &str, from: PortRef, to: PortRef) -> Result<(), String> {
        if self.edges.contains_key(id) {
            return Err(format!("Edge already exists: {}", id));
        }

        if !self.batching {
            self.push_undo();
        }

        let edge = Edge {
            id: id.to_string(),
            from: from.clone(),
            to: to.clone(),
        };
        self.edges.insert(id.to_string(), edge.clone());
        self.attach_edge(&edge);

        self.events.emit(GraphEvent::EdgeCreated {
            id: id.to_string(),
            from,
            to,
        });

        Ok(())
    }

    pub fn remove_edge(&mut self, id: &str) {
        let edge = match self.edges.remove(id) {
            Some(e) => e,
            None => return,
        };

        if !self.batching {
            self.push_undo();
        }

        self.detach_edge(&edge);
        self.events.emit(GraphEvent::EdgeRemoved { id: id.to_string() });
    }

    pub fn get_edges(&self) -> Vec<&Edge> {
        self.edges.values().collect()
    }

    pub fn get_edges_from(&self, node_id: &str, port: Option<&str>) -> Vec<&Edge> {
        self.edges_by_source
            .get(node_id)
            .map(|ids| {
                ids.iter()
                    .filter_map(|eid| self.edges.get(eid))
                    .filter(|e| port.map_or(true, |p| e.from.port == p))
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn get_edges_to(&self, node_id: &str, port: Option<&str>) -> Vec<&Edge> {
        self.edges_by_target
            .get(node_id)
            .map(|ids| {
                ids.iter()
                    .filter_map(|eid| self.edges.get(eid))
                    .filter(|e| port.map_or(true, |p| e.to.port == p))
                    .collect()
            })
            .unwrap_or_default()
    }

    // ── Query ───────────────────────────────────────────────────────────

    pub fn get_upstream(&self, node_id: &str) -> Vec<NodeId> {
        self.get_edges_to(node_id, None)
            .iter()
            .map(|e| e.from.node.clone())
            .collect()
    }

    pub fn get_downstream(&self, node_id: &str) -> Vec<NodeId> {
        self.get_edges_from(node_id, None)
            .iter()
            .map(|e| e.to.node.clone())
            .collect()
    }

    pub fn plan_execution(&self) -> ExecutionPlan {
        let node_ids: Vec<&String> = self.nodes.keys().collect();
        let mut in_degree: HashMap<&str, usize> = HashMap::new();
        let mut adj: HashMap<&str, HashSet<&str>> = HashMap::new();

        for id in &node_ids {
            in_degree.insert(id.as_str(), 0);
            adj.insert(id.as_str(), HashSet::new());
        }

        for edge in self.edges.values() {
            adj.entry(edge.from.node.as_str())
                .or_default()
                .insert(edge.to.node.as_str());
            *in_degree.entry(edge.to.node.as_str()).or_insert(0) += 1;
        }

        let mut queue: VecDeque<&str> = VecDeque::new();
        for (id, deg) in &in_degree {
            if *deg == 0 {
                queue.push_back(id);
            }
        }

        let mut sorted: Vec<NodeId> = Vec::new();
        let mut levels: Vec<Vec<NodeId>> = Vec::new();
        let mut node_level: HashMap<&str, usize> = HashMap::new();

        while let Some(id) = queue.pop_front() {
            sorted.push(id.to_string());

            let mut level = 0;
            for upstream in self.get_upstream(id) {
                if let Some(&ul) = node_level.get(upstream.as_str()) {
                    level = level.max(ul + 1);
                }
            }
            node_level.insert(id, level);
            while levels.len() <= level {
                levels.push(Vec::new());
            }
            levels[level].push(id.to_string());

            if let Some(neighbors) = adj.get(id) {
                for next in neighbors {
                    let deg = in_degree.entry(next).or_insert(1);
                    *deg -= 1;
                    if *deg == 0 {
                        queue.push_back(next);
                    }
                }
            }
        }

        let cycle_nodes: Vec<NodeId> = node_ids
            .iter()
            .filter(|id| !node_level.contains_key(id.as_str()))
            .map(|id| id.to_string())
            .collect();

        ExecutionPlan {
            has_cycle: !cycle_nodes.is_empty(),
            order: sorted,
            levels,
            cycle_nodes,
        }
    }

    // ── Undo/Redo ───────────────────────────────────────────────────────

    fn push_undo(&mut self) {
        self.undo_stack.push(self.serialize());
        if self.undo_stack.len() > MAX_UNDO {
            self.undo_stack.remove(0);
        }
        self.redo_stack.clear();
    }

    pub fn undo(&mut self) -> bool {
        let snapshot = match self.undo_stack.pop() {
            Some(s) => s,
            None => return false,
        };
        self.redo_stack.push(self.serialize());
        self.deserialize(&snapshot);
        true
    }

    pub fn redo(&mut self) -> bool {
        let snapshot = match self.redo_stack.pop() {
            Some(s) => s,
            None => return false,
        };
        self.undo_stack.push(self.serialize());
        self.deserialize(&snapshot);
        true
    }

    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }

    pub fn batch<F>(&mut self, f: F)
    where
        F: FnOnce(&mut Self),
    {
        self.push_undo();
        self.batching = true;
        f(self);
        self.batching = false;
    }

    // ── Persistence ─────────────────────────────────────────────────────

    pub fn serialize(&self) -> GraphSnapshot {
        GraphSnapshot {
            nodes: self
                .nodes
                .values()
                .map(|n| NodeSnapshotEntry {
                    id: n.id.clone(),
                    node_type: n.node_type.clone(),
                    config: n.config.clone(),
                    meta: n.meta.clone(),
                })
                .collect(),
            edges: self.edges.values().cloned().collect(),
            subsystems: Vec::new(),
            version: 1,
        }
    }

    pub fn deserialize(&mut self, snapshot: &GraphSnapshot) {
        self.nodes.clear();
        self.edges.clear();
        self.edges_by_source.clear();
        self.edges_by_target.clear();

        for entry in &snapshot.nodes {
            let state = NodeState {
                id: entry.id.clone(),
                node_type: entry.node_type.clone(),
                config: entry.config.clone(),
                data: serde_json::Value::Object(serde_json::Map::new()),
                status: NodeStatus::Idle,
                error: None,
                meta: entry.meta.clone(),
            };
            self.nodes.insert(entry.id.clone(), state);
            self.edges_by_source
                .insert(entry.id.clone(), HashSet::new());
            self.edges_by_target
                .insert(entry.id.clone(), HashSet::new());
        }

        for edge in &snapshot.edges {
            self.edges.insert(edge.id.clone(), edge.clone());
            self.attach_edge(edge);
        }
    }

    /// Clear the entire graph.
    pub fn clear(&mut self) {
        if !self.batching {
            self.push_undo();
        }
        self.nodes.clear();
        self.edges.clear();
        self.edges_by_source.clear();
        self.edges_by_target.clear();
    }

    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }

    pub fn edge_count(&self) -> usize {
        self.edges.len()
    }

    // ── Internal ────────────────────────────────────────────────────────

    fn attach_edge(&mut self, edge: &Edge) {
        self.edges_by_source
            .entry(edge.from.node.clone())
            .or_default()
            .insert(edge.id.clone());
        self.edges_by_target
            .entry(edge.to.node.clone())
            .or_default()
            .insert(edge.id.clone());
    }

    fn detach_edge(&mut self, edge: &Edge) {
        if let Some(set) = self.edges_by_source.get_mut(&edge.from.node) {
            set.remove(&edge.id);
        }
        if let Some(set) = self.edges_by_target.get_mut(&edge.to.node) {
            set.remove(&edge.id);
        }
    }
}

/// Partial update for a node.
pub struct NodeUpdate {
    pub config: Option<serde_json::Value>,
    pub data: Option<serde_json::Value>,
    pub status: Option<NodeStatus>,
    pub error: Option<String>,
    pub clear_error: bool,
    pub meta: Option<MetaUpdate>,
}

impl Default for NodeUpdate {
    fn default() -> Self {
        Self {
            config: None,
            data: None,
            status: None,
            error: None,
            clear_error: false,
            meta: None,
        }
    }
}

pub struct MetaUpdate {
    pub last_run: Option<i64>,
    pub run_count: Option<u64>,
    pub position: Option<Position>,
    pub size: Option<Size>,
}

fn chrono_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_def(node_type: &str) -> NodeDef {
        NodeDef {
            node_type: node_type.to_string(),
            subsystem: "test".to_string(),
            inputs: vec![PortDef {
                name: "in".to_string(),
                port_type: DataType::Any,
                multiple: false,
                optional: true,
            }],
            outputs: vec![PortDef {
                name: "out".to_string(),
                port_type: DataType::Any,
                multiple: false,
                optional: false,
            }],
            schema: None,
            execution: None,
        }
    }

    #[test]
    fn test_add_remove_node() {
        let mut graph = Graph::new();
        graph.register_node_def(test_def("test:a"));

        let id = graph.add_node("test:a", None).unwrap();
        assert_eq!(graph.node_count(), 1);
        assert!(graph.get_node(&id).is_some());

        graph.remove_node(&id);
        assert_eq!(graph.node_count(), 0);
    }

    #[test]
    fn test_add_edge() {
        let mut graph = Graph::new();
        graph.register_node_def(test_def("test:a"));

        let a = graph.add_node("test:a", None).unwrap();
        let b = graph.add_node("test:a", None).unwrap();

        let eid = graph
            .add_edge(
                PortRef { node: a.clone(), port: "out".into() },
                PortRef { node: b.clone(), port: "in".into() },
            )
            .unwrap();

        assert_eq!(graph.edge_count(), 1);
        assert_eq!(graph.get_downstream(&a), vec![b.clone()]);
        assert_eq!(graph.get_upstream(&b), vec![a.clone()]);

        graph.remove_edge(&eid);
        assert_eq!(graph.edge_count(), 0);
    }

    #[test]
    fn test_topological_sort() {
        let mut graph = Graph::new();
        graph.register_node_def(test_def("test:a"));

        let a = graph.add_node("test:a", None).unwrap();
        let b = graph.add_node("test:a", None).unwrap();
        let c = graph.add_node("test:a", None).unwrap();

        graph
            .add_edge(
                PortRef { node: a.clone(), port: "out".into() },
                PortRef { node: b.clone(), port: "in".into() },
            )
            .unwrap();
        graph
            .add_edge(
                PortRef { node: b.clone(), port: "out".into() },
                PortRef { node: c.clone(), port: "in".into() },
            )
            .unwrap();

        let plan = graph.plan_execution();
        assert!(!plan.has_cycle);
        assert_eq!(plan.order.len(), 3);

        let a_idx = plan.order.iter().position(|x| *x == a).unwrap();
        let b_idx = plan.order.iter().position(|x| *x == b).unwrap();
        let c_idx = plan.order.iter().position(|x| *x == c).unwrap();
        assert!(a_idx < b_idx);
        assert!(b_idx < c_idx);
    }

    #[test]
    fn test_undo_redo() {
        let mut graph = Graph::new();
        graph.register_node_def(test_def("test:a"));

        let id = graph.add_node("test:a", None).unwrap();
        assert_eq!(graph.node_count(), 1);

        graph.undo();
        assert_eq!(graph.node_count(), 0);

        graph.redo();
        assert_eq!(graph.node_count(), 1);
        assert!(graph.get_node(&id).is_some());
    }

    #[test]
    fn test_serialize_deserialize() {
        let mut graph = Graph::new();
        graph.register_node_def(test_def("test:a"));

        let a = graph.add_node("test:a", None).unwrap();
        let b = graph.add_node("test:a", None).unwrap();
        graph
            .add_edge(
                PortRef { node: a.clone(), port: "out".into() },
                PortRef { node: b.clone(), port: "in".into() },
            )
            .unwrap();

        let snapshot = graph.serialize();
        assert_eq!(snapshot.nodes.len(), 2);
        assert_eq!(snapshot.edges.len(), 1);

        let mut graph2 = Graph::new();
        graph2.register_node_def(test_def("test:a"));
        graph2.deserialize(&snapshot);
        assert_eq!(graph2.node_count(), 2);
        assert_eq!(graph2.edge_count(), 1);
    }

    #[test]
    fn test_remove_node_cascades_edges() {
        let mut graph = Graph::new();
        graph.register_node_def(test_def("test:a"));

        let a = graph.add_node("test:a", None).unwrap();
        let b = graph.add_node("test:a", None).unwrap();
        graph
            .add_edge(
                PortRef { node: a.clone(), port: "out".into() },
                PortRef { node: b.clone(), port: "in".into() },
            )
            .unwrap();

        graph.remove_node(&a);
        assert_eq!(graph.node_count(), 1);
        assert_eq!(graph.edge_count(), 0);
    }
}
