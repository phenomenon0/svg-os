//! svg-wasm: WASM entry point for SVG OS.
//!
//! Holds all runtime state in a thread_local and exposes a flat
//! function-based API via wasm_bindgen. The TypeScript bridge
//! (@svg-os/bridge) calls these functions.

use std::cell::RefCell;
use wasm_bindgen::prelude::*;
use svg_doc::{Document, Node, NodeId, SvgTag, AttrKey, AttrValue};
use svg_render::DiffEngine;
use svg_effects::EffectStore;
use svg_layout::{ConstraintStore, ConnectorStore, Connector, ConnectorRouting,
    DiagramGraph, LayeredLayoutConfig, LayoutDirection, layered_layout};
use svg_runtime::{BindingEngine, Theme, generate_diagram};
use forge_math::Rect;

/// All runtime state for the SVG OS engine.
struct Engine {
    doc: Document,
    diff: DiffEngine,
    effects: EffectStore,
    constraints: ConstraintStore,
    connectors: ConnectorStore,
    bindings: BindingEngine,
    node_types: svg_runtime::NodeTypeRegistry,
    undo_stack: Vec<svg_doc::SvgCommand>,
    redo_stack: Vec<svg_doc::SvgCommand>,
}

impl Engine {
    fn new() -> Self {
        Self {
            doc: Document::new(),
            diff: DiffEngine::new(),
            effects: EffectStore::new(),
            constraints: ConstraintStore::new(),
            connectors: ConnectorStore::new(),
            bindings: BindingEngine::new(),
            node_types: svg_runtime::NodeTypeRegistry::new(),
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        }
    }
}

thread_local! {
    static ENGINE: RefCell<Option<Engine>> = RefCell::new(None);
}

fn with_engine<F, R>(f: F) -> Result<R, JsValue>
where
    F: FnOnce(&mut Engine) -> R,
{
    ENGINE.with(|e| {
        let mut borrow = e.borrow_mut();
        match borrow.as_mut() {
            Some(engine) => Ok(f(engine)),
            None => Err(JsValue::from_str("svg_os_init() has not been called")),
        }
    })
}

fn try_with_engine<F, R>(f: F) -> Result<R, JsValue>
where
    F: FnOnce(&mut Engine) -> Result<R, JsValue>,
{
    ENGINE.with(|e| {
        let mut borrow = e.borrow_mut();
        match borrow.as_mut() {
            Some(engine) => f(engine),
            None => Err(JsValue::from_str("svg_os_init() has not been called")),
        }
    })
}

/// Map a CommandError to JsValue.
fn cmd_err(e: svg_doc::CommandError) -> JsValue {
    JsValue::from_str(&e.to_string())
}

// ══════════════════════════════════════════════════════════════════════════════
// Phase 1 API: Document operations
// ══════════════════════════════════════════════════════════════════════════════

/// Initialize an empty SVG document.
#[wasm_bindgen]
pub fn svg_os_init() {
    ENGINE.with(|e| {
        *e.borrow_mut() = Some(Engine::new());
    });
}

/// Import an SVG string into the document (replaces current).
#[wasm_bindgen]
pub fn svg_os_import_svg(svg: &str) -> std::result::Result<(), JsValue> {
    let doc = svg_doc::doc_from_svg_string(svg)
        .map_err(|e| JsValue::from_str(&e))?;

    try_with_engine(|engine| {
        engine.doc = doc;
        engine.diff = DiffEngine::new();
        engine.undo_stack.clear();
        engine.redo_stack.clear();
        Ok(())
    })
}

/// Export the document to an SVG string.
#[wasm_bindgen]
pub fn svg_os_export_svg() -> Result<String, JsValue> {
    with_engine(|e| svg_doc::doc_to_svg_string(&e.doc))
}

/// Create a new node. Returns the new NodeId as a string.
#[wasm_bindgen]
pub fn svg_os_create_node(parent_id: &str, tag: &str, attrs_json: &str) -> std::result::Result<String, JsValue> {
    try_with_engine(|e| {
        let parent = NodeId::from_str(parent_id)
            .ok_or_else(|| JsValue::from_str("Invalid parent ID"))?;
        let svg_tag = SvgTag::from_name(tag);
        let mut node = Node::new(svg_tag);

        // Parse attributes from JSON
        if !attrs_json.is_empty() {
            if let Ok(attrs) = serde_json::from_str::<serde_json::Value>(attrs_json) {
                if let serde_json::Value::Object(map) = attrs {
                    for (key, value) in map {
                        let attr_key = AttrKey::from_name(&key);
                        let attr_str = match &value {
                            serde_json::Value::String(s) => s.clone(),
                            serde_json::Value::Number(n) => n.to_string(),
                            other => other.to_string(),
                        };
                        let attr_value = AttrValue::parse(&attr_key, &attr_str);
                        node.set_attr(attr_key, attr_value);
                    }
                }
            }
        }

        let index = e.doc.children(parent).len();
        let cmd = svg_doc::SvgCommand::InsertNode {
            node: node.clone(),
            parent,
            index,
        };
        let inverse = cmd.execute(&mut e.doc).map_err(cmd_err)?;
        e.undo_stack.push(inverse);
        e.redo_stack.clear();

        Ok(node.id.to_string())
    })
}

/// Remove a node and its subtree.
#[wasm_bindgen]
pub fn svg_os_remove_node(id: &str) -> std::result::Result<(), JsValue> {
    try_with_engine(|e| {
        let node_id = NodeId::from_str(id)
            .ok_or_else(|| JsValue::from_str("Invalid node ID"))?;

        let cmd = svg_doc::SvgCommand::RemoveNode {
            id: node_id,
            removed_nodes: vec![],
            parent: None,
            index: 0,
        };
        let inverse = cmd.execute(&mut e.doc).map_err(cmd_err)?;
        e.undo_stack.push(inverse);
        e.redo_stack.clear();

        Ok(())
    })
}

/// Set an attribute on a node.
#[wasm_bindgen]
pub fn svg_os_set_attr(id: &str, key: &str, value: &str) -> std::result::Result<(), JsValue> {
    try_with_engine(|e| {
        let node_id = NodeId::from_str(id)
            .ok_or_else(|| JsValue::from_str("Invalid node ID"))?;
        let attr_key = AttrKey::from_name(key);
        let attr_value = AttrValue::parse(&attr_key, value);

        let cmd = svg_doc::SvgCommand::SetAttr {
            id: node_id,
            key: attr_key,
            value: attr_value,
            old_value: None,
        };
        let inverse = cmd.execute(&mut e.doc).map_err(cmd_err)?;
        e.undo_stack.push(inverse);
        e.redo_stack.clear();

        Ok(())
    })
}

/// Remove an attribute from a node.
#[wasm_bindgen]
pub fn svg_os_remove_attr(id: &str, key: &str) -> std::result::Result<(), JsValue> {
    try_with_engine(|e| {
        let node_id = NodeId::from_str(id)
            .ok_or_else(|| JsValue::from_str("Invalid node ID"))?;
        let attr_key = AttrKey::from_name(key);

        let cmd = svg_doc::SvgCommand::RemoveAttr {
            id: node_id,
            key: attr_key,
            old_value: None,
        };
        let inverse = cmd.execute(&mut e.doc).map_err(cmd_err)?;
        e.undo_stack.push(inverse);
        e.redo_stack.clear();

        Ok(())
    })
}

/// Move a node to a new parent at the given index.
#[wasm_bindgen]
pub fn svg_os_reparent(id: &str, new_parent: &str, index: u32) -> std::result::Result<(), JsValue> {
    try_with_engine(|e| {
        let node_id = NodeId::from_str(id)
            .ok_or_else(|| JsValue::from_str("Invalid node ID"))?;
        let parent_id = NodeId::from_str(new_parent)
            .ok_or_else(|| JsValue::from_str("Invalid parent ID"))?;

        let cmd = svg_doc::SvgCommand::Reparent {
            id: node_id,
            new_parent: parent_id,
            index: index as usize,
            old_parent: None,
            old_index: 0,
        };
        let inverse = cmd.execute(&mut e.doc).map_err(cmd_err)?;
        e.undo_stack.push(inverse);
        e.redo_stack.clear();

        Ok(())
    })
}

/// Set multiple attributes on a node as a single undoable batch.
/// attrs_json is an object like {"x": "10", "y": "20"}
#[wasm_bindgen]
pub fn svg_os_set_attrs_batch(id: &str, attrs_json: &str) -> std::result::Result<(), JsValue> {
    try_with_engine(|e| {
        let node_id = NodeId::from_str(id)
            .ok_or_else(|| JsValue::from_str("Invalid node ID"))?;

        let attrs: serde_json::Value = serde_json::from_str(attrs_json)
            .map_err(|err| JsValue::from_str(&format!("Invalid JSON: {}", err)))?;

        let mut commands = Vec::new();
        if let serde_json::Value::Object(map) = attrs {
            for (key, value) in map {
                let attr_key = AttrKey::from_name(&key);
                let attr_str = match &value {
                    serde_json::Value::String(s) => s.clone(),
                    serde_json::Value::Number(n) => n.to_string(),
                    other => other.to_string(),
                };
                let attr_value = AttrValue::parse(&attr_key, &attr_str);
                commands.push(svg_doc::SvgCommand::SetAttr {
                    id: node_id,
                    key: attr_key,
                    value: attr_value,
                    old_value: None,
                });
            }
        }

        let batch = svg_doc::SvgCommand::Batch { commands };
        let inverse = batch.execute(&mut e.doc).map_err(cmd_err)?;
        e.undo_stack.push(inverse);
        e.redo_stack.clear();

        Ok(())
    })
}

/// Undo the last command.
#[wasm_bindgen]
pub fn svg_os_undo() -> Result<bool, JsValue> {
    try_with_engine(|e| {
        if let Some(cmd) = e.undo_stack.pop() {
            let inverse = cmd.execute(&mut e.doc).map_err(cmd_err)?;
            e.redo_stack.push(inverse);
            Ok(true)
        } else {
            Ok(false)
        }
    })
}

/// Redo the last undone command.
#[wasm_bindgen]
pub fn svg_os_redo() -> Result<bool, JsValue> {
    try_with_engine(|e| {
        if let Some(cmd) = e.redo_stack.pop() {
            let inverse = cmd.execute(&mut e.doc).map_err(cmd_err)?;
            e.undo_stack.push(inverse);
            Ok(true)
        } else {
            Ok(false)
        }
    })
}

#[wasm_bindgen]
pub fn svg_os_can_undo() -> Result<bool, JsValue> {
    with_engine(|e| !e.undo_stack.is_empty())
}

#[wasm_bindgen]
pub fn svg_os_can_redo() -> Result<bool, JsValue> {
    with_engine(|e| !e.redo_stack.is_empty())
}

/// Get render ops as JSON (array of SvgDomOp).
/// First call returns full render; subsequent calls return diffs.
#[wasm_bindgen]
pub fn svg_os_get_render_ops() -> Result<String, JsValue> {
    with_engine(|e| {
        let ops = if e.diff.last_rendered_count() == 0 {
            e.diff.full_render(&e.doc)
        } else {
            e.diff.diff(&mut e.doc)
        };
        serde_json::to_string(&ops).unwrap_or_else(|_| "[]".to_string())
    })
}

/// Reset the diff engine and return a full render.
/// Call this after undo/redo or when the TS-side DOM has been cleared.
#[wasm_bindgen]
pub fn svg_os_full_render() -> Result<String, JsValue> {
    with_engine(|e| {
        // Clear dirty/removed so full_render starts clean
        e.doc.take_dirty();
        e.doc.take_removed();
        let ops = e.diff.full_render(&e.doc);
        serde_json::to_string(&ops).unwrap_or_else(|_| "[]".to_string())
    })
}

/// Get the full document as JSON (for debugging).
#[wasm_bindgen]
pub fn svg_os_get_document_json() -> Result<String, JsValue> {
    with_engine(|e| {
        serde_json::to_string(&e.doc).unwrap_or_else(|_| "{}".to_string())
    })
}

/// Get the root node ID.
#[wasm_bindgen]
pub fn svg_os_root_id() -> Result<String, JsValue> {
    with_engine(|e| e.doc.root.to_string())
}

/// Get the defs node ID.
#[wasm_bindgen]
pub fn svg_os_defs_id() -> Result<String, JsValue> {
    with_engine(|e| e.doc.defs.to_string())
}

// ══════════════════════════════════════════════════════════════════════════════
// Phase 2 API: Effects, constraints, bindings, themes, templates
// ══════════════════════════════════════════════════════════════════════════════

/// Add an effect to a node's effect stack.
#[wasm_bindgen]
pub fn svg_os_add_effect(node_id: &str, effect_json: &str) -> std::result::Result<(), JsValue> {
    try_with_engine(|e| {
        let id = NodeId::from_str(node_id)
            .ok_or_else(|| JsValue::from_str("Invalid node ID"))?;
        let effect: svg_effects::Effect = serde_json::from_str(effect_json)
            .map_err(|err| JsValue::from_str(&format!("Invalid effect JSON: {}", err)))?;
        e.effects.add_effect(id, effect);
        Ok(())
    })
}

/// Remove an effect from a node's stack by index.
#[wasm_bindgen]
pub fn svg_os_remove_effect(node_id: &str, index: u32) -> std::result::Result<(), JsValue> {
    try_with_engine(|e| {
        let id = NodeId::from_str(node_id)
            .ok_or_else(|| JsValue::from_str("Invalid node ID"))?;
        e.effects.remove_effect(id, index as usize);
        Ok(())
    })
}

/// Add a constraint.
#[wasm_bindgen]
pub fn svg_os_add_constraint(constraint_json: &str) -> std::result::Result<(), JsValue> {
    try_with_engine(|e| {
        let constraint: svg_layout::Constraint = serde_json::from_str(constraint_json)
            .map_err(|err| JsValue::from_str(&format!("Invalid constraint JSON: {}", err)))?;
        e.constraints.add(constraint);
        Ok(())
    })
}

/// Solve all constraints, then update connector paths.
#[wasm_bindgen]
pub fn svg_os_solve_constraints() -> Result<(), JsValue> {
    with_engine(|e| {
        let viewport = Rect::new(0.0, 0.0, 800.0, 600.0);
        let measurer = svg_text::BrowserTextMeasure;
        e.constraints.solve(&mut e.doc, viewport, Some(&measurer));
        e.connectors.update_paths(&mut e.doc);
    })
}

/// Register a data binding.
#[wasm_bindgen]
pub fn svg_os_bind(binding_json: &str) -> std::result::Result<(), JsValue> {
    try_with_engine(|e| {
        let binding: svg_runtime::Binding = serde_json::from_str(binding_json)
            .map_err(|err| JsValue::from_str(&format!("Invalid binding JSON: {}", err)))?;
        e.bindings.bind(binding);
        Ok(())
    })
}

/// Evaluate all bindings against provided data.
#[wasm_bindgen]
pub fn svg_os_evaluate_bindings(data_json: &str) -> std::result::Result<(), JsValue> {
    try_with_engine(|e| {
        let data: serde_json::Value = serde_json::from_str(data_json)
            .map_err(|err| JsValue::from_str(&format!("Invalid data JSON: {}", err)))?;
        e.bindings.evaluate(&mut e.doc, &data);
        Ok(())
    })
}

/// Evaluate bindings with data flowing through connectors.
/// Data flows from upstream nodes to downstream nodes via connectors
/// with dataFlow set to PassThrough, Field, or Expression.
/// Downstream nodes can access upstream data via $._input.portName.
#[wasm_bindgen]
pub fn svg_os_evaluate_data_flow(data_json: &str) -> std::result::Result<(), JsValue> {
    try_with_engine(|e| {
        let data: serde_json::Value = serde_json::from_str(data_json)
            .map_err(|err| JsValue::from_str(&format!("Invalid data JSON: {}", err)))?;
        e.bindings.evaluate_with_flow(&mut e.doc, &data, &e.connectors);
        Ok(())
    })
}

/// Get the computed data for a node after data flow evaluation.
/// Returns JSON string of the node's merged data (own + upstream inputs).
#[wasm_bindgen]
pub fn svg_os_get_node_data(node_id: &str) -> std::result::Result<String, JsValue> {
    try_with_engine(|e| {
        let nid = NodeId::from_str(node_id)
            .ok_or_else(|| JsValue::from_str("Invalid node ID"))?;
        match e.bindings.get_node_data(nid) {
            Some(data) => serde_json::to_string(data)
                .map_err(|err| JsValue::from_str(&format!("JSON error: {}", err))),
            None => Ok("null".to_string()),
        }
    })
}

/// Apply a theme to the document.
#[wasm_bindgen]
pub fn svg_os_apply_theme(theme_json: &str) -> std::result::Result<(), JsValue> {
    try_with_engine(|e| {
        let theme = Theme::from_json(theme_json)
            .map_err(|err| JsValue::from_str(&err))?;
        theme.apply(&mut e.doc);
        Ok(())
    })
}

/// Instantiate a template with data. Returns the new node ID.
#[wasm_bindgen]
pub fn svg_os_instantiate_template(template_id: &str, data_json: &str) -> std::result::Result<String, JsValue> {
    try_with_engine(|e| {
        let tmpl = NodeId::from_str(template_id)
            .ok_or_else(|| JsValue::from_str("Invalid template ID"))?;
        let data: serde_json::Value = serde_json::from_str(data_json)
            .map_err(|err| JsValue::from_str(&format!("Invalid data JSON: {}", err)))?;

        let new_id = svg_runtime::instantiate_template(&mut e.doc, tmpl, &data)
            .ok_or_else(|| JsValue::from_str("Template not found"))?;

        Ok(new_id.to_string())
    })
}

/// Repeat a template for each data row in a grid layout.
#[wasm_bindgen]
pub fn svg_os_repeat_template(
    template_id: &str,
    rows_json: &str,
    columns: u32,
    gap_x: f32,
    gap_y: f32,
) -> std::result::Result<String, JsValue> {
    try_with_engine(|e| {
        let tmpl = NodeId::from_str(template_id)
            .ok_or_else(|| JsValue::from_str("Invalid template ID"))?;
        let rows: Vec<serde_json::Value> = serde_json::from_str(rows_json)
            .map_err(|err| JsValue::from_str(&format!("Invalid rows JSON: {}", err)))?;

        let ids = svg_runtime::template::repeat_template(
            &mut e.doc, tmpl, &rows, columns, (gap_x, gap_y),
        );

        let id_strings: Vec<String> = ids.iter().map(|id| id.to_string()).collect();
        Ok(serde_json::to_string(&id_strings).unwrap_or_else(|_| "[]".to_string()))
    })
}

/// Export a single node and its subtree as an SVG string.
#[wasm_bindgen]
pub fn svg_os_export_node_svg(node_id: &str) -> std::result::Result<String, JsValue> {
    try_with_engine(|e| {
        let _id = NodeId::from_str(node_id)
            .ok_or_else(|| JsValue::from_str("Invalid node ID"))?;

        // Create a temporary document containing just this subtree
        // For now, just serialize the whole doc (optimization: subtree-only later)
        Ok(svg_doc::doc_to_svg_string(&e.doc))
    })
}

// ══════════════════════════════════════════════════════════════════════════════
// Diagram API: Ports, connectors
// ══════════════════════════════════════════════════════════════════════════════

/// Set ports on a node from JSON: [{ name, position: [x, y], direction }]
#[wasm_bindgen]
pub fn svg_os_add_ports(node_id: &str, ports_json: &str) -> std::result::Result<(), JsValue> {
    try_with_engine(|e| {
        let id = NodeId::from_str(node_id)
            .ok_or_else(|| JsValue::from_str("Invalid node ID"))?;
        let ports: Vec<svg_doc::Port> = serde_json::from_str(ports_json)
            .map_err(|err| JsValue::from_str(&format!("Invalid ports JSON: {}", err)))?;
        if let Some(node) = e.doc.get_mut(id) {
            node.ports = ports;
        }
        Ok(())
    })
}

/// Add default cardinal ports (top, right, bottom, left) to a node.
#[wasm_bindgen]
pub fn svg_os_add_default_ports(node_id: &str) -> std::result::Result<(), JsValue> {
    try_with_engine(|e| {
        let id = NodeId::from_str(node_id)
            .ok_or_else(|| JsValue::from_str("Invalid node ID"))?;
        if let Some(node) = e.doc.get_mut(id) {
            node.add_default_ports();
        }
        Ok(())
    })
}

/// Get ports for a node as JSON.
#[wasm_bindgen]
pub fn svg_os_get_ports(node_id: &str) -> std::result::Result<String, JsValue> {
    try_with_engine(|e| {
        let id = NodeId::from_str(node_id)
            .ok_or_else(|| JsValue::from_str("Invalid node ID"))?;
        let empty: Vec<svg_doc::Port> = Vec::new();
        let ports = e.doc.get(id)
            .map(|n| &n.ports)
            .unwrap_or(&empty);
        Ok(serde_json::to_string(ports).unwrap_or_else(|_| "[]".to_string()))
    })
}

/// Add a connector between two ports. Creates a <path> node and returns its ID.
/// JSON: { from: [nodeId, portName], to: [nodeId, portName], routing: "Straight"|"Orthogonal" }
#[wasm_bindgen]
pub fn svg_os_add_connector(connector_json: &str) -> std::result::Result<String, JsValue> {
    try_with_engine(|e| {
        let val: serde_json::Value = serde_json::from_str(connector_json)
            .map_err(|err| JsValue::from_str(&format!("Invalid JSON: {}", err)))?;

        let from_arr = val.get("from").and_then(|v| v.as_array())
            .ok_or_else(|| JsValue::from_str("Missing 'from' [nodeId, portName]"))?;
        let to_arr = val.get("to").and_then(|v| v.as_array())
            .ok_or_else(|| JsValue::from_str("Missing 'to' [nodeId, portName]"))?;

        let from_node = NodeId::from_str(from_arr[0].as_str().unwrap_or(""))
            .ok_or_else(|| JsValue::from_str("Invalid from node ID"))?;
        let from_port = from_arr[1].as_str().unwrap_or("bottom").to_string();
        let to_node = NodeId::from_str(to_arr[0].as_str().unwrap_or(""))
            .ok_or_else(|| JsValue::from_str("Invalid to node ID"))?;
        let to_port = to_arr[1].as_str().unwrap_or("top").to_string();

        let routing = match val.get("routing").and_then(|v| v.as_str()) {
            Some("Orthogonal") => ConnectorRouting::Orthogonal,
            _ => ConnectorRouting::Straight,
        };

        // Create the <path> node
        let mut path_node = Node::new(SvgTag::Path);
        path_node.set_attr(AttrKey::Stroke, AttrValue::parse(&AttrKey::Stroke, "#64748b"));
        path_node.set_attr(AttrKey::Fill, AttrValue::parse(&AttrKey::Fill, "none"));
        path_node.set_attr(AttrKey::StrokeWidth, AttrValue::F32(2.0));
        let path_id = path_node.id;

        let root = e.doc.root;
        let index = e.doc.children(root).len();
        let cmd = svg_doc::SvgCommand::InsertNode {
            node: path_node,
            parent: root,
            index,
        };
        let inverse = cmd.execute(&mut e.doc).map_err(cmd_err)?;
        e.undo_stack.push(inverse);
        e.redo_stack.clear();

        // Parse optional data flow
        let data_flow = match val.get("dataFlow").and_then(|v| v.as_str()) {
            Some("PassThrough") => svg_layout::DataFlow::PassThrough,
            _ => svg_layout::DataFlow::None,
        };
        // Also handle object form: {"Field": "path"} or {"Expression": "expr"}
        let data_flow = if matches!(data_flow, svg_layout::DataFlow::None) {
            if let Some(obj) = val.get("dataFlow") {
                if let Some(field) = obj.get("Field").and_then(|v| v.as_str()) {
                    svg_layout::DataFlow::Field(field.to_string())
                } else if let Some(expr) = obj.get("Expression").and_then(|v| v.as_str()) {
                    svg_layout::DataFlow::Expression(expr.to_string())
                } else {
                    data_flow
                }
            } else {
                data_flow
            }
        } else {
            data_flow
        };

        // Register connector
        e.connectors.add(Connector {
            path_node: path_id,
            from: (from_node, from_port),
            to: (to_node, to_port),
            routing,
            label: None,
            data_flow,
        });

        // Compute initial path
        e.connectors.update_paths(&mut e.doc);

        Ok(path_id.to_string())
    })
}

/// Remove a connector by its path node ID.
#[wasm_bindgen]
pub fn svg_os_remove_connector(path_node_id: &str) -> std::result::Result<(), JsValue> {
    try_with_engine(|e| {
        let path_id = NodeId::from_str(path_node_id)
            .ok_or_else(|| JsValue::from_str("Invalid path node ID"))?;

        e.connectors.remove_by_path(path_id);

        // Remove the path node from the document
        let cmd = svg_doc::SvgCommand::RemoveNode {
            id: path_id,
            removed_nodes: vec![],
            parent: None,
            index: 0,
        };
        let inverse = cmd.execute(&mut e.doc).map_err(cmd_err)?;
        e.undo_stack.push(inverse);
        e.redo_stack.clear();

        Ok(())
    })
}

/// Recompute all connector paths from current node positions.
#[wasm_bindgen]
pub fn svg_os_update_connectors() -> Result<(), JsValue> {
    with_engine(|e| {
        e.connectors.update_paths(&mut e.doc);
    })
}

/// Get all connectors as JSON.
#[wasm_bindgen]
pub fn svg_os_get_connectors() -> Result<String, JsValue> {
    with_engine(|e| {
        serde_json::to_string(e.connectors.connectors())
            .unwrap_or_else(|_| "[]".to_string())
    })
}

/// Auto-layout all diagram nodes using Sugiyama layered algorithm.
/// config_json: { direction: "TopToBottom"|"LeftToRight", nodeGap: number, layerGap: number }
#[wasm_bindgen]
pub fn svg_os_auto_layout(config_json: &str) -> std::result::Result<(), JsValue> {
    try_with_engine(|e| {
        let val: serde_json::Value = serde_json::from_str(config_json)
            .map_err(|err| JsValue::from_str(&format!("Invalid JSON: {}", err)))?;

        let direction = match val.get("direction").and_then(|v| v.as_str()) {
            Some("LeftToRight") => LayoutDirection::LeftToRight,
            _ => LayoutDirection::TopToBottom,
        };
        let node_gap = val.get("nodeGap").and_then(|v| v.as_f64()).unwrap_or(40.0) as f32;
        let layer_gap = val.get("layerGap").and_then(|v| v.as_f64()).unwrap_or(80.0) as f32;

        let config = LayeredLayoutConfig {
            direction,
            node_gap,
            layer_gap,
            margin: (40.0, 40.0),
        };

        // Collect diagram nodes (nodes that have ports)
        let mut diagram_nodes = Vec::new();
        let mut node_sizes = std::collections::HashMap::new();
        for (id, node) in &e.doc.nodes {
            if !node.ports.is_empty() {
                diagram_nodes.push(*id);
                let w = node.get_f32(&AttrKey::Width);
                let h = node.get_f32(&AttrKey::Height);
                let size = if w > 0.0 && h > 0.0 { (w, h) } else { (160.0, 80.0) };
                node_sizes.insert(*id, size);
            }
        }

        // Build edges from connector store
        let edges: Vec<(NodeId, NodeId)> = e.connectors.connectors()
            .iter()
            .map(|c| (c.from.0, c.to.0))
            .collect();

        let graph = DiagramGraph { nodes: diagram_nodes, edges, node_sizes };
        let result = layered_layout(&graph, &config);

        // Apply positions
        for (node_id, (x, y)) in &result.positions {
            e.doc.set_attr(*node_id, AttrKey::X, AttrValue::F32(*x));
            e.doc.set_attr(*node_id, AttrKey::Y, AttrValue::F32(*y));
        }

        // Update connectors
        e.connectors.update_paths(&mut e.doc);

        Ok(())
    })
}

/// Generate a diagram from JSON graph data. Creates nodes, connectors, runs layout.
/// Returns JSON: { "node_map": { "data-id": "node-uuid", ... }, "connector_count": N }
#[wasm_bindgen]
pub fn svg_os_generate_diagram(graph_json: &str, config_json: &str) -> std::result::Result<String, JsValue> {
    try_with_engine(|e| {
        let graph: serde_json::Value = serde_json::from_str(graph_json)
            .map_err(|err| JsValue::from_str(&format!("Invalid graph JSON: {}", err)))?;

        let val: serde_json::Value = serde_json::from_str(config_json).unwrap_or(serde_json::json!({}));
        let direction = match val.get("direction").and_then(|v| v.as_str()) {
            Some("LeftToRight") => LayoutDirection::LeftToRight,
            _ => LayoutDirection::TopToBottom,
        };
        let node_gap = val.get("nodeGap").and_then(|v| v.as_f64()).unwrap_or(40.0) as f32;
        let layer_gap = val.get("layerGap").and_then(|v| v.as_f64()).unwrap_or(80.0) as f32;

        let config = LayeredLayoutConfig {
            direction,
            node_gap,
            layer_gap,
            margin: (40.0, 40.0),
        };

        let result = generate_diagram(&mut e.doc, &mut e.connectors, &graph, &config)
            .map_err(|err| JsValue::from_str(&err))?;

        let node_map_json: serde_json::Map<String, serde_json::Value> = result.node_map
            .iter()
            .map(|(k, v)| (k.clone(), serde_json::Value::String(v.to_string())))
            .collect();

        let output = serde_json::json!({
            "nodeMap": node_map_json,
            "connectorCount": result.connector_count,
        });

        Ok(output.to_string())
    })
}

// ══════════════════════════════════════════════════════════════════════════════
// Phase 3 API: Clone, group/ungroup, node info
// ══════════════════════════════════════════════════════════════════════════════

/// Clone a node subtree. Returns the new root node's ID.
#[wasm_bindgen]
pub fn svg_os_clone_node(id: &str) -> std::result::Result<String, JsValue> {
    try_with_engine(|e| {
        let node_id = NodeId::from_str(id)
            .ok_or_else(|| JsValue::from_str("Invalid node ID"))?;

        let parent = e.doc.get(node_id)
            .and_then(|n| n.parent)
            .ok_or_else(|| JsValue::from_str("Node has no parent"))?;

        let clone_id = e.doc.clone_subtree(node_id)
            .ok_or_else(|| JsValue::from_str("Clone failed"))?;

        // Reparent clone to same parent as original
        if let Some(clone_node) = e.doc.get_mut(clone_id) {
            clone_node.parent = Some(parent);
        }
        if let Some(parent_node) = e.doc.get_mut(parent) {
            if !parent_node.children.contains(&clone_id) {
                parent_node.children.push(clone_id);
            }
        }
        e.doc.mark_dirty(clone_id);
        e.doc.mark_dirty(parent);

        Ok(clone_id.to_string())
    })
}

/// Group multiple nodes into a new `<g>` element.
/// ids_json is a JSON array of node ID strings.
/// Returns the new group's ID.
#[wasm_bindgen]
pub fn svg_os_group_nodes(ids_json: &str) -> std::result::Result<String, JsValue> {
    try_with_engine(|e| {
        let ids: Vec<String> = serde_json::from_str(ids_json)
            .map_err(|err| JsValue::from_str(&format!("Invalid JSON: {}", err)))?;

        if ids.is_empty() {
            return Err(JsValue::from_str("No nodes to group"));
        }

        let node_ids: Vec<NodeId> = ids.iter()
            .filter_map(|s| NodeId::from_str(s))
            .collect();

        if node_ids.is_empty() {
            return Err(JsValue::from_str("No valid node IDs"));
        }

        // Use the parent of the first node as the group's parent
        let parent = e.doc.get(node_ids[0])
            .and_then(|n| n.parent)
            .ok_or_else(|| JsValue::from_str("First node has no parent"))?;

        // Find the minimum index among the nodes to place the group there
        let min_index = {
            let parent_children = e.doc.children(parent);
            node_ids.iter()
                .filter_map(|id| parent_children.iter().position(|c| c == id))
                .min()
                .unwrap_or(0)
        };

        // Create the group node
        let group = Node::new(SvgTag::G);
        let group_id = group.id;
        e.doc.insert_node(parent, min_index, group);

        // Reparent each node into the group
        for (i, node_id) in node_ids.iter().enumerate() {
            e.doc.reparent(*node_id, group_id, i);
        }

        Ok(group_id.to_string())
    })
}

/// Ungroup: move children of a `<g>` to its parent, then remove the `<g>`.
#[wasm_bindgen]
pub fn svg_os_ungroup(group_id: &str) -> std::result::Result<(), JsValue> {
    try_with_engine(|e| {
        let gid = NodeId::from_str(group_id)
            .ok_or_else(|| JsValue::from_str("Invalid group ID"))?;

        let group_node = e.doc.get(gid)
            .ok_or_else(|| JsValue::from_str("Group not found"))?;

        if group_node.tag != SvgTag::G {
            return Err(JsValue::from_str("Node is not a <g> element"));
        }

        let parent = group_node.parent
            .ok_or_else(|| JsValue::from_str("Group has no parent"))?;

        let children: Vec<NodeId> = group_node.children.clone();

        // Find the group's index in its parent
        let group_index = e.doc.children(parent)
            .iter()
            .position(|c| *c == gid)
            .unwrap_or(0);

        // Reparent each child to the group's parent, at group's position
        for (i, child_id) in children.iter().enumerate() {
            e.doc.reparent(*child_id, parent, group_index + i);
        }

        // Remove the now-empty group
        e.doc.remove_subtree(gid);

        Ok(())
    })
}

/// Get info about a node as JSON.
/// Returns: { tag, attrs: { key: value }, children: [id, ...] }
#[wasm_bindgen]
pub fn svg_os_get_node_info(id: &str) -> std::result::Result<String, JsValue> {
    try_with_engine(|e| {
        let node_id = NodeId::from_str(id)
            .ok_or_else(|| JsValue::from_str("Invalid node ID"))?;

        let node = e.doc.get(node_id)
            .ok_or_else(|| JsValue::from_str("Node not found"))?;

        let mut attrs = serde_json::Map::new();
        for (key, value) in &node.attrs {
            attrs.insert(
                key.as_name().to_string(),
                serde_json::Value::String(value.to_svg_string()),
            );
        }

        let children: Vec<serde_json::Value> = node.children.iter()
            .map(|c| serde_json::Value::String(c.to_string()))
            .collect();

        let info = serde_json::json!({
            "tag": node.tag.as_name(),
            "attrs": attrs,
            "children": children,
            "visible": node.visible,
            "locked": node.locked,
            "name": node.name,
        });

        Ok(info.to_string())
    })
}

// ══════════════════════════════════════════════════════════════════════════════
// Node Type Registry
// ══════════════════════════════════════════════════════════════════════════════

/// Register a node type from JSON. Auto-detects slots from the template SVG.
/// JSON: { id, name, category, template_svg, ?icon }
#[wasm_bindgen]
pub fn svg_os_register_node_type(type_json: &str) -> Result<(), JsValue> {
    try_with_engine(|e| {
        let val: serde_json::Value = serde_json::from_str(type_json)
            .map_err(|err| JsValue::from_str(&format!("Invalid JSON: {}", err)))?;

        let id = val.get("id").and_then(|v| v.as_str())
            .ok_or_else(|| JsValue::from_str("Missing 'id'"))?;
        let name = val.get("name").and_then(|v| v.as_str())
            .ok_or_else(|| JsValue::from_str("Missing 'name'"))?;
        let category = val.get("category").and_then(|v| v.as_str()).unwrap_or("custom");
        let svg = val.get("template_svg").and_then(|v| v.as_str())
            .ok_or_else(|| JsValue::from_str("Missing 'template_svg'"))?;

        let nt = svg_runtime::NodeTypeRegistry::from_template_svg(id, name, category, svg);
        e.node_types.register(nt);
        Ok(())
    })
}

/// List all registered node types as JSON array (lightweight, no SVG payload).
#[wasm_bindgen]
pub fn svg_os_list_node_types() -> Result<String, JsValue> {
    with_engine(|e| {
        let types = e.node_types.list();
        serde_json::to_string(&types).unwrap_or_else(|_| "[]".into())
    })
}

/// Get full node type definition by ID (includes template SVG).
#[wasm_bindgen]
pub fn svg_os_get_node_type(type_id: &str) -> Result<String, JsValue> {
    try_with_engine(|e| {
        match e.node_types.get(type_id) {
            Some(nt) => serde_json::to_string(nt)
                .map_err(|err| JsValue::from_str(&format!("JSON error: {}", err))),
            None => Err(JsValue::from_str(&format!("Node type not found: {}", type_id))),
        }
    })
}

/// Instantiate a node type on the canvas at (x, y) with optional initial data.
/// Returns the new group node ID.
#[wasm_bindgen]
pub fn svg_os_instantiate_node_type(
    type_id: &str,
    x: f32,
    y: f32,
    data_json: &str,
) -> Result<String, JsValue> {
    try_with_engine(|e| {
        let group_id = e.node_types.instantiate(type_id, &mut e.doc, x, y)
            .ok_or_else(|| JsValue::from_str(&format!("Node type not found: {}", type_id)))?;

        // If data provided, evaluate bindings for this node
        if !data_json.is_empty() && data_json != "{}" {
            if let Ok(data) = serde_json::from_str::<serde_json::Value>(data_json) {
                // Set data-bind attributes on child elements
                // (The node type's slots define what fields map to what attributes)
                if let Some(nt) = e.node_types.get(type_id) {
                    for slot in &nt.slots {
                        if let Some(val) = data.get(&slot.field) {
                            let val_str = match val {
                                serde_json::Value::String(s) => s.clone(),
                                other => other.to_string(),
                            };
                            // Walk children to find elements with matching data-bind
                            let children = e.doc.children(group_id);
                            for child_id in &children {
                                // Simple: set on all children that are text elements for text slots
                                if slot.bind_type == "text" {
                                    if let Some(child) = e.doc.get(*child_id) {
                                        if child.tag == svg_doc::SvgTag::Text {
                                            e.doc.set_attr(*child_id, AttrKey::TextContent, AttrValue::Str(val_str.clone()));
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(group_id.to_string())
    })
}

// ══════════════════════════════════════════════════════════════════════════════
// Inline template rendering (standalone, no Engine state)
// ══════════════════════════════════════════════════════════════════════════════

/// Resolve data-bind attributes in an SVG template string and return the
/// modified SVG.  This is a **standalone** function — it does not touch the
/// thread-local Engine and can therefore be called synchronously from the
/// tldraw canvas whenever data changes.
///
/// Supported bind attributes:
///   data-bind="field"          → sets text content
///   data-bind-fill="field"     → sets fill attribute
///   data-bind-stop="field"     → sets stop-color attribute
///   data-bind-expr="expr"      → evaluates expression, sets text content
///   data-bind-attr-X="field"   → sets attribute X
#[wasm_bindgen]
pub fn svg_os_render_template_inline(
    template_svg: &str,
    data_json: &str,
) -> Result<String, JsValue> {
    let data: serde_json::Value = serde_json::from_str(data_json)
        .map_err(|err| JsValue::from_str(&format!("Invalid data JSON: {}", err)))?;

    render_template_inline(template_svg, &data)
        .map_err(|err| JsValue::from_str(&err))
}

// ── Inline template helpers ─────────────────────────────────────────────────

/// Pure-Rust implementation of data-bind resolution via quick-xml.
fn render_template_inline(
    svg: &str,
    data: &serde_json::Value,
) -> Result<String, String> {
    use quick_xml::events::{Event, BytesStart, BytesText};
    use quick_xml::{Reader, Writer};
    use std::io::Cursor;

    let mut reader = Reader::from_str(svg);
    let mut writer = Writer::new(Cursor::new(Vec::new()));
    let mut buf = Vec::new();

    let mut pending_text: Option<String> = None;
    let mut in_bound_element = false;
    let mut depth_at_bind: usize = 0;
    let mut current_depth: usize = 0;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                current_depth += 1;
                let mut elem = BytesStart::from(e.name());
                let mut text_bind: Option<String> = None;

                for attr_result in e.attributes() {
                    let attr = attr_result.map_err(|e| format!("XML attr error: {}", e))?;
                    let key = std::str::from_utf8(attr.key.as_ref()).unwrap_or("");
                    let val = attr.unescape_value().map_err(|e| format!("XML unescape: {}", e))?;

                    if key == "data-bind" {
                        text_bind = resolve_field(data, &val);
                    } else if key == "data-bind-expr" {
                        text_bind = eval_inline_expr(&val, data);
                    } else if key == "data-bind-fill" {
                        if let Some(v) = resolve_field(data, &val) {
                            elem.push_attribute(("fill", v.as_str()));
                        }
                    } else if key == "data-bind-stop" {
                        if let Some(v) = resolve_field(data, &val) {
                            elem.push_attribute(("stop-color", v.as_str()));
                        }
                    } else if let Some(target_attr) = key.strip_prefix("data-bind-attr-") {
                        if let Some(v) = resolve_field(data, &val) {
                            elem.push_attribute((target_attr, v.as_str()));
                        }
                    } else {
                        elem.push_attribute(attr);
                    }
                }

                writer.write_event(Event::Start(elem))
                    .map_err(|e| format!("XML write: {}", e))?;

                if let Some(text) = text_bind {
                    pending_text = Some(text);
                    in_bound_element = true;
                    depth_at_bind = current_depth;
                }
            }
            Ok(Event::End(ref e)) => {
                if in_bound_element && current_depth == depth_at_bind {
                    if let Some(ref text) = pending_text {
                        writer.write_event(Event::Text(BytesText::new(text)))
                            .map_err(|e| format!("XML write: {}", e))?;
                    }
                    pending_text = None;
                    in_bound_element = false;
                }
                current_depth = current_depth.saturating_sub(1);
                writer.write_event(Event::End(e.to_owned()))
                    .map_err(|e| format!("XML write: {}", e))?;
            }
            Ok(Event::Text(ref e)) => {
                if in_bound_element && current_depth == depth_at_bind {
                    // Skip original text — will be replaced at End
                } else {
                    writer.write_event(Event::Text(e.to_owned()))
                        .map_err(|e| format!("XML write: {}", e))?;
                }
            }
            Ok(Event::Empty(ref e)) => {
                let mut elem = BytesStart::from(e.name());

                for attr_result in e.attributes() {
                    let attr = attr_result.map_err(|e| format!("XML attr error: {}", e))?;
                    let key = std::str::from_utf8(attr.key.as_ref()).unwrap_or("");
                    let val = attr.unescape_value().map_err(|e| format!("XML unescape: {}", e))?;

                    if key == "data-bind-fill" {
                        if let Some(v) = resolve_field(data, &val) {
                            elem.push_attribute(("fill", v.as_str()));
                        }
                    } else if key == "data-bind-stop" {
                        if let Some(v) = resolve_field(data, &val) {
                            elem.push_attribute(("stop-color", v.as_str()));
                        }
                    } else if let Some(target_attr) = key.strip_prefix("data-bind-attr-") {
                        if let Some(v) = resolve_field(data, &val) {
                            elem.push_attribute((target_attr, v.as_str()));
                        }
                    } else if key == "data-bind" || key == "data-bind-expr" {
                        // Skip — self-closing elements can't have text content
                    } else {
                        elem.push_attribute(attr);
                    }
                }

                writer.write_event(Event::Empty(elem))
                    .map_err(|e| format!("XML write: {}", e))?;
            }
            Ok(Event::Eof) => break,
            Ok(e) => {
                writer.write_event(e)
                    .map_err(|err| format!("XML write: {}", err))?;
            }
            Err(e) => return Err(format!("XML parse error: {}", e)),
        }
        buf.clear();
    }

    let result = writer.into_inner().into_inner();
    String::from_utf8(result).map_err(|e| format!("UTF-8 error: {}", e))
}

/// Resolve a dotted field path against JSON data, returning the string value.
fn resolve_field(data: &serde_json::Value, field: &str) -> Option<String> {
    let mut current = data;
    for part in field.split('.') {
        match current {
            serde_json::Value::Object(map) => current = map.get(part)?,
            serde_json::Value::Array(arr) => {
                let idx: usize = part.parse().ok()?;
                current = arr.get(idx)?;
            }
            _ => return None,
        }
    }
    Some(match current {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    })
}

/// Evaluate an expression string against data using the svg-runtime expression engine.
fn eval_inline_expr(expr: &str, data: &serde_json::Value) -> Option<String> {
    let compiled = svg_runtime::CompiledExpr::parse(expr).ok()?;
    let ctx = svg_runtime::EvalContext {
        data,
        value: None,
        row_index: None,
        row_count: None,
    };
    compiled.eval_to_string(&ctx).ok()
}

// ══════════════════════════════════════════════════════════════════════════════
// Expression evaluation (debug/testing)
// ══════════════════════════════════════════════════════════════════════════════

/// Evaluate an expression against JSON data. Returns the result as a string.
/// Useful for debugging and testing expressions in the Studio.
#[wasm_bindgen]
pub fn svg_os_eval_expr(expr: &str, data_json: &str) -> Result<String, JsValue> {
    let data: serde_json::Value = serde_json::from_str(data_json)
        .map_err(|err| JsValue::from_str(&format!("Invalid JSON: {}", err)))?;

    let compiled = svg_runtime::CompiledExpr::parse(expr)
        .map_err(|err| JsValue::from_str(&format!("Parse error: {}", err)))?;

    let ctx = svg_runtime::EvalContext {
        data: &data,
        value: None,
        row_index: None,
        row_count: None,
    };

    compiled.eval_to_string(&ctx)
        .map_err(|err| JsValue::from_str(&format!("Eval error: {}", err)))
}

// ══════════════════════════════════════════════════════════════════════════════
// Text measurement registration
// ══════════════════════════════════════════════════════════════════════════════

/// Register a JavaScript text measurement callback.
/// The callback should accept (text: string, font: string, size: number)
/// and return a Float32Array of [width, height, ascent, descent].
///
/// Example JS:
/// ```js
/// const canvas = document.createElement('canvas');
/// const ctx = canvas.getContext('2d');
/// registerTextMeasurer((text, font, size) => {
///   ctx.font = `${size}px ${font}`;
///   const m = ctx.measureText(text);
///   return new Float32Array([
///     m.width,
///     size * 1.2,
///     m.actualBoundingBoxAscent || size * 0.8,
///     m.actualBoundingBoxDescent || size * 0.2,
///   ]);
/// });
/// ```
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn svg_os_register_text_measurer(callback: js_sys::Function) {
    let measure_fn = Box::new(move |text: &str, font: &str, size: f32| -> [f32; 4] {
        let this = JsValue::NULL;
        let result = callback.call3(
            &this,
            &JsValue::from_str(text),
            &JsValue::from_str(font),
            &JsValue::from_f64(size as f64),
        );
        match result {
            Ok(val) => {
                let arr = js_sys::Float32Array::new(&val);
                let mut out = [0.0f32; 4];
                arr.copy_to(&mut out);
                out
            }
            Err(_) => {
                let w = text.len() as f32 * size * 0.6;
                [w, size * 1.2, size * 0.8, size * 0.2]
            }
        }
    });
    svg_text::set_text_measure_fn(measure_fn);
}

// ══════════════════════════════════════════════════════════════════════════════
// AI Context API: graph manifest, node context, connection suggestions
// ══════════════════════════════════════════════════════════════════════════════

/// Get a compact semantic map of the entire document graph.
#[wasm_bindgen]
pub fn svg_os_get_graph_manifest() -> Result<String, JsValue> {
    with_engine(|engine| {
        let manifest = svg_runtime::build_manifest(
            &engine.doc,
            &engine.connectors,
            &engine.bindings,
            &engine.node_types,
        );
        serde_json::to_string(&manifest).unwrap_or_else(|_| "{}".into())
    })
}

/// Get focused context for a single node.
#[wasm_bindgen]
pub fn svg_os_get_node_context(node_id: &str) -> Result<String, JsValue> {
    let nid = NodeId::from_str(node_id)
        .ok_or_else(|| JsValue::from_str("Invalid node ID"))?;
    with_engine(|engine| {
        match svg_runtime::build_node_context(
            nid,
            &engine.doc,
            &engine.connectors,
            &engine.bindings,
            &engine.node_types,
        ) {
            Some(ctx) => serde_json::to_string(&ctx).unwrap_or_else(|_| "null".into()),
            None => "null".into(),
        }
    })
}

/// Get connection suggestions for linking two nodes.
#[wasm_bindgen]
pub fn svg_os_suggest_connection(from_id: &str, to_id: &str) -> Result<String, JsValue> {
    let from = NodeId::from_str(from_id)
        .ok_or_else(|| JsValue::from_str("Invalid from node ID"))?;
    let to = NodeId::from_str(to_id)
        .ok_or_else(|| JsValue::from_str("Invalid to node ID"))?;
    with_engine(|engine| {
        let suggestion = svg_runtime::suggest_connection(
            from,
            to,
            &engine.doc,
            &engine.connectors,
            &engine.bindings,
            &engine.node_types,
        );
        serde_json::to_string(&suggestion).unwrap_or_else(|_| "{}".into())
    })
}

/// Get pending AI evaluations that need to be resolved by the TypeScript layer.
#[wasm_bindgen]
pub fn svg_os_get_pending_ai_evals() -> Result<String, JsValue> {
    with_engine(|engine| {
        let pending = engine.bindings.pending_ai_evals();
        serde_json::to_string(pending).unwrap_or_else(|_| "[]".into())
    })
}

/// Resolve an AI evaluation by providing the result data.
/// After resolving, call evaluate_data_flow again to propagate downstream.
#[wasm_bindgen]
pub fn svg_os_resolve_ai_eval(node_id: &str, result_json: &str) -> Result<(), JsValue> {
    let nid = NodeId::from_str(node_id)
        .ok_or_else(|| JsValue::from_str("Invalid node ID"))?;
    let result: serde_json::Value = serde_json::from_str(result_json)
        .map_err(|err| JsValue::from_str(&format!("Invalid result JSON: {}", err)))?;
    try_with_engine(|engine| {
        engine.bindings.set_node_data(nid, result);
        Ok(())
    })
}

/// Set node data directly (for external data injection).
#[wasm_bindgen]
pub fn svg_os_set_node_data(node_id: &str, data_json: &str) -> Result<(), JsValue> {
    let nid = NodeId::from_str(node_id)
        .ok_or_else(|| JsValue::from_str("Invalid node ID"))?;
    let data: serde_json::Value = serde_json::from_str(data_json)
        .map_err(|err| JsValue::from_str(&format!("Invalid data JSON: {}", err)))?;
    try_with_engine(|engine| {
        engine.bindings.set_node_data(nid, data);
        Ok(())
    })
}

/// Set the semantic role of a node.
#[wasm_bindgen]
pub fn svg_os_set_node_role(node_id: &str, role: &str) -> Result<(), JsValue> {
    let nid = NodeId::from_str(node_id)
        .ok_or_else(|| JsValue::from_str("Invalid node ID"))?;
    let node_role = match role {
        "Element" => svg_doc::NodeRole::Element,
        "Source" => svg_doc::NodeRole::Source,
        "View" => svg_doc::NodeRole::View,
        "Transform" => svg_doc::NodeRole::Transform,
        "Container" => svg_doc::NodeRole::Container,
        _ => return Err(JsValue::from_str("Invalid role. Expected: Element, Source, View, Transform, Container")),
    };
    try_with_engine(|engine| {
        match engine.doc.get_mut(nid) {
            Some(node) => {
                node.role = node_role;
                Ok(())
            }
            None => Err(JsValue::from_str("Node not found")),
        }
    })
}

// ── Non-WASM test support ───────────────────────────────────────────────────

#[cfg(not(target_arch = "wasm32"))]
pub fn main() {
    eprintln!("svg-wasm is a WASM crate. Build with: wasm-pack build crates/svg-wasm --target web");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_and_export() {
        svg_os_init();
        let svg = svg_os_export_svg().unwrap();
        assert!(svg.contains("<svg"));
        assert!(svg.contains("</svg>"));
    }

    #[test]
    fn create_and_undo() {
        svg_os_init();
        let root = svg_os_root_id().unwrap();

        let rect_id = svg_os_create_node(&root, "rect", r##"{"x":"10","y":"20","width":"100","height":"50","fill":"#ff0000"}"##).unwrap();
        assert!(!rect_id.is_empty());

        let svg = svg_os_export_svg().unwrap();
        assert!(svg.contains("<rect"));

        // Undo
        assert!(svg_os_undo().unwrap());
        let svg = svg_os_export_svg().unwrap();
        assert!(!svg.contains("<rect"));

        // Redo
        assert!(svg_os_redo().unwrap());
        let svg = svg_os_export_svg().unwrap();
        assert!(svg.contains("<rect"));
    }

    #[test]
    fn import_svg() {
        svg_os_init();
        let input = r#"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
            <rect x="5" y="5" width="190" height="90" fill="blue"/>
        </svg>"#;

        svg_os_import_svg(input).unwrap();
        let svg = svg_os_export_svg().unwrap();
        assert!(svg.contains("width=\"190\""));
    }

    #[test]
    fn render_ops_json() {
        svg_os_init();
        let ops = svg_os_get_render_ops().unwrap();
        let parsed: Vec<serde_json::Value> = serde_json::from_str(&ops).unwrap();
        assert!(!parsed.is_empty());
    }

    #[test]
    fn render_template_inline_text_and_fill() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
  <text data-bind="name">Placeholder</text>
  <rect data-bind-fill="color" fill="#ccc" width="100" height="50"/>
</svg>"##;
        let data = r##"{"name": "Alice", "color": "#ff0000"}"##;
        let result = svg_os_render_template_inline(svg, data).unwrap();
        assert!(result.contains("Alice"), "should contain bound text");
        assert!(result.contains(r##"fill="#ff0000""##), "should contain bound fill");
        assert!(!result.contains("Placeholder"), "original text should be replaced");
    }

    #[test]
    fn render_template_inline_expr() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg">
  <text data-bind-expr="if($.score > 90, 'Excellent', 'Good')">?</text>
</svg>"#;
        let data = r#"{"score": 95}"#;
        let result = svg_os_render_template_inline(svg, data).unwrap();
        assert!(result.contains("Excellent"));
    }

    #[test]
    fn render_template_inline_attr_binding() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg">
  <rect data-bind-attr-width="w" width="10" height="50"/>
</svg>"#;
        let data = r#"{"w": "200"}"#;
        let result = svg_os_render_template_inline(svg, data).unwrap();
        assert!(result.contains(r#"width="200""#));
    }

    #[test]
    fn render_template_inline_nested_field() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg">
  <text data-bind="user.name">?</text>
</svg>"#;
        let data = r#"{"user": {"name": "Bob"}}"#;
        let result = svg_os_render_template_inline(svg, data).unwrap();
        assert!(result.contains("Bob"));
    }
}
