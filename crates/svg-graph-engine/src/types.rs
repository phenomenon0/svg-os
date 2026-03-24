use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub type NodeId = String;
pub type PortId = String;
pub type EdgeId = String;
pub type SubsystemId = String;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DataType {
    Any,
    Data,
    Text,
    Number,
    Boolean,
    Array,
    Image,
    Stream,
    Void,
}

impl DataType {
    pub fn is_compatible_with(&self, target: &DataType) -> bool {
        if *target == DataType::Any {
            return true;
        }
        match self {
            DataType::Any => true,
            DataType::Data => matches!(target, DataType::Any | DataType::Data | DataType::Array),
            DataType::Text => matches!(
                target,
                DataType::Any | DataType::Text | DataType::Number | DataType::Boolean
            ),
            DataType::Number => {
                matches!(target, DataType::Any | DataType::Number | DataType::Boolean)
            }
            DataType::Boolean => {
                matches!(target, DataType::Any | DataType::Number | DataType::Boolean)
            }
            DataType::Array => matches!(target, DataType::Any | DataType::Array),
            DataType::Image => matches!(target, DataType::Any | DataType::Image),
            DataType::Stream => matches!(target, DataType::Any | DataType::Stream),
            DataType::Void => matches!(target, DataType::Any | DataType::Void),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortDef {
    pub name: String,
    #[serde(rename = "type")]
    pub port_type: DataType,
    #[serde(default)]
    pub multiple: bool,
    #[serde(default)]
    pub optional: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortRef {
    pub node: NodeId,
    pub port: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Edge {
    pub id: EdgeId,
    pub from: PortRef,
    pub to: PortRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeStatus {
    Idle,
    Running,
    Done,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Size {
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeMeta {
    pub created: i64,
    pub last_run: i64,
    pub run_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<Position>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<Size>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeState {
    pub id: NodeId,
    #[serde(rename = "type")]
    pub node_type: String,
    pub config: serde_json::Value,
    pub data: serde_json::Value,
    pub status: NodeStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub meta: NodeMeta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionPlan {
    pub order: Vec<NodeId>,
    pub levels: Vec<Vec<NodeId>>,
    pub cycle_nodes: Vec<NodeId>,
    pub has_cycle: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphSnapshot {
    pub nodes: Vec<NodeSnapshotEntry>,
    pub edges: Vec<Edge>,
    #[serde(default)]
    pub subsystems: Vec<SubsystemId>,
    pub version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeSnapshotEntry {
    pub id: NodeId,
    #[serde(rename = "type")]
    pub node_type: String,
    pub config: serde_json::Value,
    pub meta: NodeMeta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExecutionMode {
    Sync,
    Async,
    Exclusive,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionPolicy {
    #[serde(default)]
    pub mode: Option<ExecutionMode>,
    #[serde(default)]
    pub concurrency_key: Option<String>,
    #[serde(default)]
    pub cache: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeDef {
    #[serde(rename = "type")]
    pub node_type: String,
    pub subsystem: SubsystemId,
    pub inputs: Vec<PortDef>,
    pub outputs: Vec<PortDef>,
    #[serde(default)]
    pub schema: Option<serde_json::Value>,
    #[serde(default)]
    pub execution: Option<ExecutionPolicy>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GraphEvent {
    NodeCreated {
        id: NodeId,
        node_type: String,
    },
    NodeRemoved {
        id: NodeId,
    },
    NodeUpdated {
        id: NodeId,
        status: Option<NodeStatus>,
        data: Option<serde_json::Value>,
        error: Option<String>,
    },
    EdgeCreated {
        id: EdgeId,
        from: PortRef,
        to: PortRef,
    },
    EdgeRemoved {
        id: EdgeId,
    },
    ExecStart {
        node_count: usize,
    },
    ExecNodeStart {
        node_id: NodeId,
        node_type: String,
    },
    ExecNodeComplete {
        node_id: NodeId,
        node_type: String,
        status: NodeStatus,
        error: Option<String>,
    },
    ExecComplete {
        cancelled: bool,
        rerun_requested: bool,
    },
    ExecCycle {
        node_ids: Vec<NodeId>,
    },
}

pub fn new_id() -> String {
    Uuid::new_v4().to_string()
}
