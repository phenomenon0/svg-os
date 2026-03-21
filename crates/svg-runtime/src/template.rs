//! Template instantiation: clone templates and bind data rows.

use svg_doc::{Document, NodeId, AttrKey, AttrValue};
use serde_json::Value;

/// Instantiate a template node with data, returning the new node ID.
///
/// Clones the template subtree, then applies field mappings from
/// the data object to the clone's attributes.
pub fn instantiate_template(
    doc: &mut Document,
    template: NodeId,
    data: &Value,
) -> Option<NodeId> {
    let clone_id = doc.clone_subtree(template)?;

    // Apply data fields as attributes on the clone
    if let Value::Object(map) = data {
        for (key, value) in map {
            let attr_key = AttrKey::from_name(key);
            let attr_str = value_to_string(value);
            let attr_value = AttrValue::parse(&attr_key, &attr_str);
            doc.set_attr(clone_id, attr_key, attr_value);
        }
    }

    Some(clone_id)
}

/// Repeat a template for each row of data, laid out in a grid.
///
/// Creates `rows.len()` clones of the template, positions them in
/// a grid with the given column count and gap, and applies each
/// row's data to the corresponding clone.
pub fn repeat_template(
    doc: &mut Document,
    template: NodeId,
    rows: &[Value],
    columns: u32,
    gap: (f32, f32),
) -> Vec<NodeId> {
    let template_node = match doc.get(template) {
        Some(n) => n,
        None => return vec![],
    };
    let parent = template_node.parent.unwrap_or(doc.root);
    let base_x = template_node.get_f32(&AttrKey::X);
    let base_y = template_node.get_f32(&AttrKey::Y);
    let cell_w = template_node.get_f32(&AttrKey::Width);
    let cell_h = template_node.get_f32(&AttrKey::Height);

    let mut created = Vec::new();

    for (i, row_data) in rows.iter().enumerate() {
        let col = (i as u32) % columns;
        let row = (i as u32) / columns;

        let x = base_x + col as f32 * (cell_w + gap.0);
        let y = base_y + row as f32 * (cell_h + gap.1);

        if let Some(clone_id) = instantiate_template(doc, template, row_data) {
            doc.set_attr(clone_id, AttrKey::X, AttrValue::F32(x));
            doc.set_attr(clone_id, AttrKey::Y, AttrValue::F32(y));

            // Reparent to template's parent
            if let Some(clone_node) = doc.get_mut(clone_id) {
                clone_node.parent = Some(parent);
            }
            if let Some(parent_node) = doc.get_mut(parent) {
                if !parent_node.children.contains(&clone_id) {
                    parent_node.children.push(clone_id);
                }
            }

            created.push(clone_id);
        }
    }

    created
}

fn value_to_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use svg_doc::{Node, SvgTag};
    use serde_json::json;

    #[test]
    fn instantiate_template_basic() {
        let mut doc = Document::new();
        let root = doc.root;

        let mut rect = Node::new(SvgTag::Rect);
        rect.set_attr(AttrKey::Width, AttrValue::F32(100.0));
        rect.set_attr(AttrKey::Height, AttrValue::F32(50.0));
        rect.set_attr(AttrKey::Fill, AttrValue::Str("#ccc".to_string()));
        let tmpl_id = rect.id;
        doc.insert_node(root, 1, rect);

        let data = json!({ "fill": "#ff0000", "width": "200" });
        let clone_id = instantiate_template(&mut doc, tmpl_id, &data).unwrap();

        assert_ne!(clone_id, tmpl_id);
        let clone = doc.get(clone_id).unwrap();
        // Width should be overwritten by data
        assert_eq!(clone.get_f32(&AttrKey::Width), 200.0);
    }

    #[test]
    fn repeat_template_grid() {
        let mut doc = Document::new();
        let root = doc.root;

        let mut rect = Node::new(SvgTag::Rect);
        rect.set_attr(AttrKey::X, AttrValue::F32(0.0));
        rect.set_attr(AttrKey::Y, AttrValue::F32(0.0));
        rect.set_attr(AttrKey::Width, AttrValue::F32(50.0));
        rect.set_attr(AttrKey::Height, AttrValue::F32(50.0));
        let tmpl_id = rect.id;
        doc.insert_node(root, 1, rect);

        let rows = vec![
            json!({"fill": "red"}),
            json!({"fill": "green"}),
            json!({"fill": "blue"}),
            json!({"fill": "yellow"}),
        ];

        let created = repeat_template(&mut doc, tmpl_id, &rows, 2, (10.0, 10.0));
        assert_eq!(created.len(), 4);

        // Check grid positioning
        let c0 = doc.get(created[0]).unwrap();
        let c1 = doc.get(created[1]).unwrap();
        let c2 = doc.get(created[2]).unwrap();

        assert_eq!(c0.get_f32(&AttrKey::X), 0.0);
        assert_eq!(c1.get_f32(&AttrKey::X), 60.0); // 50 + 10
        assert_eq!(c2.get_f32(&AttrKey::X), 0.0);  // Wraps to next row
        assert_eq!(c2.get_f32(&AttrKey::Y), 60.0);
    }
}
