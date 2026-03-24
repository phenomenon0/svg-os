//! Tauri command handlers for the Rust graph engine.

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use svg_graph_engine::graph::{Graph, NodeUpdate};
use svg_graph_engine::types::*;
use svg_store::SqliteStore;
use tauri::State;
use tokio::sync::Mutex;

pub struct GraphEngine {
    pub graph: Arc<Mutex<Graph>>,
}

impl GraphEngine {
    pub fn new(graph: Graph) -> Self {
        Self {
            graph: Arc::new(Mutex::new(graph)),
        }
    }
}

#[derive(Deserialize)]
pub struct AddNodeRequest {
    pub node_type: String,
    pub config: Option<serde_json::Value>,
    pub id: Option<String>,
}

#[derive(Serialize)]
pub struct AddNodeResponse {
    pub id: String,
}

#[tauri::command]
pub async fn graph_add_node(
    engine: State<'_, GraphEngine>,
    request: AddNodeRequest,
) -> Result<AddNodeResponse, String> {
    let mut graph = engine.graph.lock().await;
    let id = if let Some(preset_id) = request.id {
        graph.add_node_with_id(&preset_id, &request.node_type, request.config)?
    } else {
        graph.add_node(&request.node_type, request.config)?
    };
    Ok(AddNodeResponse { id })
}

#[tauri::command]
pub async fn graph_remove_node(
    engine: State<'_, GraphEngine>,
    node_id: String,
) -> Result<(), String> {
    let mut graph = engine.graph.lock().await;
    graph.remove_node(&node_id);
    Ok(())
}

#[derive(Deserialize)]
pub struct UpdateNodeRequest {
    pub node_id: String,
    pub config: Option<serde_json::Value>,
    pub data: Option<serde_json::Value>,
    pub status: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn graph_update_node(
    engine: State<'_, GraphEngine>,
    request: UpdateNodeRequest,
) -> Result<(), String> {
    let mut graph = engine.graph.lock().await;

    let status = request.status.map(|s| match s.as_str() {
        "running" => NodeStatus::Running,
        "done" => NodeStatus::Done,
        "error" => NodeStatus::Error,
        _ => NodeStatus::Idle,
    });

    graph.update_node(
        &request.node_id,
        NodeUpdate {
            config: request.config,
            data: request.data,
            status,
            error: request.error,
            ..Default::default()
        },
    );
    Ok(())
}

#[derive(Deserialize)]
pub struct AddEdgeRequest {
    pub from_node: String,
    pub from_port: String,
    pub to_node: String,
    pub to_port: String,
    pub id: Option<String>,
}

#[derive(Serialize)]
pub struct AddEdgeResponse {
    pub id: String,
}

#[tauri::command]
pub async fn graph_add_edge(
    engine: State<'_, GraphEngine>,
    request: AddEdgeRequest,
) -> Result<AddEdgeResponse, String> {
    let mut graph = engine.graph.lock().await;
    let from = PortRef {
        node: request.from_node,
        port: request.from_port,
    };
    let to = PortRef {
        node: request.to_node,
        port: request.to_port,
    };

    let id = if let Some(preset_id) = request.id {
        graph.add_edge_unchecked(&preset_id, from, to)?;
        preset_id
    } else {
        graph.add_edge(from, to)?
    };

    Ok(AddEdgeResponse { id })
}

#[tauri::command]
pub async fn graph_remove_edge(
    engine: State<'_, GraphEngine>,
    edge_id: String,
) -> Result<(), String> {
    let mut graph = engine.graph.lock().await;
    graph.remove_edge(&edge_id);
    Ok(())
}

#[tauri::command]
pub async fn graph_get_snapshot(
    engine: State<'_, GraphEngine>,
) -> Result<GraphSnapshot, String> {
    let graph = engine.graph.lock().await;
    Ok(graph.serialize())
}

#[tauri::command]
pub async fn graph_load_snapshot(
    engine: State<'_, GraphEngine>,
    snapshot: GraphSnapshot,
) -> Result<(), String> {
    let mut graph = engine.graph.lock().await;
    graph.deserialize(&snapshot);
    Ok(())
}

#[tauri::command]
pub async fn graph_undo(
    engine: State<'_, GraphEngine>,
) -> Result<GraphSnapshot, String> {
    let mut graph = engine.graph.lock().await;
    if graph.undo() {
        Ok(graph.serialize())
    } else {
        Err("Nothing to undo".to_string())
    }
}

#[tauri::command]
pub async fn graph_redo(
    engine: State<'_, GraphEngine>,
) -> Result<GraphSnapshot, String> {
    let mut graph = engine.graph.lock().await;
    if graph.redo() {
        Ok(graph.serialize())
    } else {
        Err("Nothing to redo".to_string())
    }
}

#[tauri::command]
pub async fn graph_clear(
    engine: State<'_, GraphEngine>,
) -> Result<(), String> {
    let mut graph = engine.graph.lock().await;
    graph.clear();
    Ok(())
}

// ── Node def registration ───────────────────────────────────────────────

#[tauri::command]
pub async fn graph_register_node_def(
    engine: State<'_, GraphEngine>,
    def: NodeDef,
) -> Result<(), String> {
    let mut graph = engine.graph.lock().await;
    graph.register_node_def(def);
    Ok(())
}

#[tauri::command]
pub async fn graph_list_node_defs(
    engine: State<'_, GraphEngine>,
) -> Result<Vec<NodeDef>, String> {
    let graph = engine.graph.lock().await;
    Ok(graph.list_node_defs().into_iter().cloned().collect())
}

// ── Store commands ──────────────────────────────────────────────────────

pub struct StoreState {
    pub store: std::sync::Mutex<SqliteStore>,
}

#[derive(Serialize)]
pub struct GraphListEntry {
    pub id: i64,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    pub is_autosave: bool,
}

#[tauri::command]
pub async fn store_save(
    engine: State<'_, GraphEngine>,
    store_state: State<'_, StoreState>,
    name: Option<String>,
    tldraw_snapshot: Option<Vec<u8>>,
) -> Result<i64, String> {
    let graph = engine.graph.lock().await;
    let snapshot = graph.serialize();
    let store = store_state.store.lock().map_err(|e| e.to_string())?;
    store.save(
        &name.unwrap_or_else(|| "Untitled".to_string()),
        &snapshot,
        tldraw_snapshot.as_deref(),
    )
}

#[tauri::command]
pub async fn store_autosave(
    engine: State<'_, GraphEngine>,
    store_state: State<'_, StoreState>,
    tldraw_snapshot: Option<Vec<u8>>,
) -> Result<i64, String> {
    let graph = engine.graph.lock().await;
    let snapshot = graph.serialize();
    let store = store_state.store.lock().map_err(|e| e.to_string())?;
    store.autosave("default", &snapshot, tldraw_snapshot.as_deref())
}

#[tauri::command]
pub async fn store_load(
    engine: State<'_, GraphEngine>,
    store_state: State<'_, StoreState>,
    id: i64,
) -> Result<Option<Vec<u8>>, String> {
    let (snapshot, tldraw) = {
        let store = store_state.store.lock().map_err(|e| e.to_string())?;
        store.load(id)?
    }; // MutexGuard dropped here before await
    let mut graph = engine.graph.lock().await;
    graph.deserialize(&snapshot);
    Ok(tldraw)
}

#[tauri::command]
pub async fn store_load_latest(
    engine: State<'_, GraphEngine>,
    store_state: State<'_, StoreState>,
) -> Result<Option<Vec<u8>>, String> {
    let loaded = {
        let store = store_state.store.lock().map_err(|e| e.to_string())?;
        store.load_latest_autosave()?
    }; // MutexGuard dropped here before await
    match loaded {
        Some((_id, snapshot, tldraw)) => {
            let mut graph = engine.graph.lock().await;
            graph.deserialize(&snapshot);
            Ok(tldraw)
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn store_list(
    store_state: State<'_, StoreState>,
) -> Result<Vec<GraphListEntry>, String> {
    let store = store_state.store.lock().map_err(|e| e.to_string())?;
    let records = store.list()?;
    Ok(records
        .into_iter()
        .map(|r| GraphListEntry {
            id: r.id,
            name: r.name,
            created_at: r.created_at,
            updated_at: r.updated_at,
            is_autosave: r.is_autosave,
        })
        .collect())
}

#[tauri::command]
pub async fn store_get_setting(
    store_state: State<'_, StoreState>,
    key: String,
) -> Result<Option<String>, String> {
    let store = store_state.store.lock().map_err(|e| e.to_string())?;
    store.get_setting(&key)
}

#[tauri::command]
pub async fn store_set_setting(
    store_state: State<'_, StoreState>,
    key: String,
    value: String,
) -> Result<(), String> {
    let store = store_state.store.lock().map_err(|e| e.to_string())?;
    store.set_setting(&key, &value)
}
