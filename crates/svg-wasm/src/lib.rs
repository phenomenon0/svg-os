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
use svg_layout::ConstraintStore;
use svg_runtime::{BindingEngine, Theme};
use forge_math::Rect;

/// All runtime state for the SVG OS engine.
struct Engine {
    doc: Document,
    diff: DiffEngine,
    effects: EffectStore,
    constraints: ConstraintStore,
    bindings: BindingEngine,
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
            bindings: BindingEngine::new(),
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        }
    }
}

thread_local! {
    static ENGINE: RefCell<Option<Engine>> = RefCell::new(None);
}

fn with_engine<F, R>(f: F) -> R
where
    F: FnOnce(&mut Engine) -> R,
{
    ENGINE.with(|e| {
        let mut borrow = e.borrow_mut();
        let engine = borrow.as_mut().expect("svg_os_init() not called");
        f(engine)
    })
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

    ENGINE.with(|e| {
        let mut borrow = e.borrow_mut();
        let engine = borrow.as_mut().expect("svg_os_init() not called");
        engine.doc = doc;
        engine.diff = DiffEngine::new();
        engine.undo_stack.clear();
        engine.redo_stack.clear();
    });

    Ok(())
}

/// Export the document to an SVG string.
#[wasm_bindgen]
pub fn svg_os_export_svg() -> String {
    with_engine(|e| svg_doc::doc_to_svg_string(&e.doc))
}

/// Create a new node. Returns the new NodeId as a string.
#[wasm_bindgen]
pub fn svg_os_create_node(parent_id: &str, tag: &str, attrs_json: &str) -> std::result::Result<String, JsValue> {
    with_engine(|e| {
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
        let inverse = cmd.execute(&mut e.doc);
        e.undo_stack.push(inverse);
        e.redo_stack.clear();

        Ok(node.id.to_string())
    })
}

/// Remove a node and its subtree.
#[wasm_bindgen]
pub fn svg_os_remove_node(id: &str) -> std::result::Result<(), JsValue> {
    with_engine(|e| {
        let node_id = NodeId::from_str(id)
            .ok_or_else(|| JsValue::from_str("Invalid node ID"))?;

        let cmd = svg_doc::SvgCommand::RemoveNode {
            id: node_id,
            removed_nodes: vec![],
            parent: None,
            index: 0,
        };
        let inverse = cmd.execute(&mut e.doc);
        e.undo_stack.push(inverse);
        e.redo_stack.clear();

        Ok(())
    })
}

/// Set an attribute on a node.
#[wasm_bindgen]
pub fn svg_os_set_attr(id: &str, key: &str, value: &str) -> std::result::Result<(), JsValue> {
    with_engine(|e| {
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
        let inverse = cmd.execute(&mut e.doc);
        e.undo_stack.push(inverse);
        e.redo_stack.clear();

        Ok(())
    })
}

/// Remove an attribute from a node.
#[wasm_bindgen]
pub fn svg_os_remove_attr(id: &str, key: &str) -> std::result::Result<(), JsValue> {
    with_engine(|e| {
        let node_id = NodeId::from_str(id)
            .ok_or_else(|| JsValue::from_str("Invalid node ID"))?;
        let attr_key = AttrKey::from_name(key);

        let cmd = svg_doc::SvgCommand::RemoveAttr {
            id: node_id,
            key: attr_key,
            old_value: None,
        };
        let inverse = cmd.execute(&mut e.doc);
        e.undo_stack.push(inverse);
        e.redo_stack.clear();

        Ok(())
    })
}

/// Move a node to a new parent at the given index.
#[wasm_bindgen]
pub fn svg_os_reparent(id: &str, new_parent: &str, index: u32) -> std::result::Result<(), JsValue> {
    with_engine(|e| {
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
        let inverse = cmd.execute(&mut e.doc);
        e.undo_stack.push(inverse);
        e.redo_stack.clear();

        Ok(())
    })
}

/// Undo the last command.
#[wasm_bindgen]
pub fn svg_os_undo() -> bool {
    with_engine(|e| {
        if let Some(cmd) = e.undo_stack.pop() {
            let inverse = cmd.execute(&mut e.doc);
            e.redo_stack.push(inverse);
            true
        } else {
            false
        }
    })
}

/// Redo the last undone command.
#[wasm_bindgen]
pub fn svg_os_redo() -> bool {
    with_engine(|e| {
        if let Some(cmd) = e.redo_stack.pop() {
            let inverse = cmd.execute(&mut e.doc);
            e.undo_stack.push(inverse);
            true
        } else {
            false
        }
    })
}

#[wasm_bindgen]
pub fn svg_os_can_undo() -> bool {
    with_engine(|e| !e.undo_stack.is_empty())
}

#[wasm_bindgen]
pub fn svg_os_can_redo() -> bool {
    with_engine(|e| !e.redo_stack.is_empty())
}

/// Get render ops as JSON (array of SvgDomOp).
/// First call returns full render; subsequent calls return diffs.
#[wasm_bindgen]
pub fn svg_os_get_render_ops() -> String {
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
pub fn svg_os_full_render() -> String {
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
pub fn svg_os_get_document_json() -> String {
    with_engine(|e| {
        serde_json::to_string(&e.doc).unwrap_or_else(|_| "{}".to_string())
    })
}

/// Get the root node ID.
#[wasm_bindgen]
pub fn svg_os_root_id() -> String {
    with_engine(|e| e.doc.root.to_string())
}

/// Get the defs node ID.
#[wasm_bindgen]
pub fn svg_os_defs_id() -> String {
    with_engine(|e| e.doc.defs.to_string())
}

// ══════════════════════════════════════════════════════════════════════════════
// Phase 2 API: Effects, constraints, bindings, themes, templates
// ══════════════════════════════════════════════════════════════════════════════

/// Add an effect to a node's effect stack.
#[wasm_bindgen]
pub fn svg_os_add_effect(node_id: &str, effect_json: &str) -> std::result::Result<(), JsValue> {
    with_engine(|e| {
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
    with_engine(|e| {
        let id = NodeId::from_str(node_id)
            .ok_or_else(|| JsValue::from_str("Invalid node ID"))?;
        e.effects.remove_effect(id, index as usize);
        Ok(())
    })
}

/// Add a constraint.
#[wasm_bindgen]
pub fn svg_os_add_constraint(constraint_json: &str) -> std::result::Result<(), JsValue> {
    with_engine(|e| {
        let constraint: svg_layout::Constraint = serde_json::from_str(constraint_json)
            .map_err(|err| JsValue::from_str(&format!("Invalid constraint JSON: {}", err)))?;
        e.constraints.add(constraint);
        Ok(())
    })
}

/// Solve all constraints.
#[wasm_bindgen]
pub fn svg_os_solve_constraints() {
    with_engine(|e| {
        let viewport = Rect::new(0.0, 0.0, 800.0, 600.0);
        e.constraints.solve(&mut e.doc, viewport);
    })
}

/// Register a data binding.
#[wasm_bindgen]
pub fn svg_os_bind(binding_json: &str) -> std::result::Result<(), JsValue> {
    with_engine(|e| {
        let binding: svg_runtime::Binding = serde_json::from_str(binding_json)
            .map_err(|err| JsValue::from_str(&format!("Invalid binding JSON: {}", err)))?;
        e.bindings.bind(binding);
        Ok(())
    })
}

/// Evaluate all bindings against provided data.
#[wasm_bindgen]
pub fn svg_os_evaluate_bindings(data_json: &str) -> std::result::Result<(), JsValue> {
    with_engine(|e| {
        let data: serde_json::Value = serde_json::from_str(data_json)
            .map_err(|err| JsValue::from_str(&format!("Invalid data JSON: {}", err)))?;
        e.bindings.evaluate(&mut e.doc, &data);
        Ok(())
    })
}

/// Apply a theme to the document.
#[wasm_bindgen]
pub fn svg_os_apply_theme(theme_json: &str) -> std::result::Result<(), JsValue> {
    with_engine(|e| {
        let theme = Theme::from_json(theme_json)
            .map_err(|err| JsValue::from_str(&err))?;
        theme.apply(&mut e.doc);
        Ok(())
    })
}

/// Instantiate a template with data. Returns the new node ID.
#[wasm_bindgen]
pub fn svg_os_instantiate_template(template_id: &str, data_json: &str) -> std::result::Result<String, JsValue> {
    with_engine(|e| {
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
    with_engine(|e| {
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
    with_engine(|e| {
        let _id = NodeId::from_str(node_id)
            .ok_or_else(|| JsValue::from_str("Invalid node ID"))?;

        // Create a temporary document containing just this subtree
        // For now, just serialize the whole doc (optimization: subtree-only later)
        Ok(svg_doc::doc_to_svg_string(&e.doc))
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
        let svg = svg_os_export_svg();
        assert!(svg.contains("<svg"));
        assert!(svg.contains("</svg>"));
    }

    #[test]
    fn create_and_undo() {
        svg_os_init();
        let root = svg_os_root_id();

        let rect_id = svg_os_create_node(&root, "rect", r##"{"x":"10","y":"20","width":"100","height":"50","fill":"#ff0000"}"##).unwrap();
        assert!(!rect_id.is_empty());

        let svg = svg_os_export_svg();
        assert!(svg.contains("<rect"));

        // Undo
        assert!(svg_os_undo());
        let svg = svg_os_export_svg();
        assert!(!svg.contains("<rect"));

        // Redo
        assert!(svg_os_redo());
        let svg = svg_os_export_svg();
        assert!(svg.contains("<rect"));
    }

    #[test]
    fn import_svg() {
        svg_os_init();
        let input = r#"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
            <rect x="5" y="5" width="190" height="90" fill="blue"/>
        </svg>"#;

        svg_os_import_svg(input).unwrap();
        let svg = svg_os_export_svg();
        assert!(svg.contains("width=\"190\""));
    }

    #[test]
    fn render_ops_json() {
        svg_os_init();
        let ops = svg_os_get_render_ops();
        let parsed: Vec<serde_json::Value> = serde_json::from_str(&ops).unwrap();
        assert!(!parsed.is_empty());
    }
}
