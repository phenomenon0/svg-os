//! SVG parsing — SVG XML string → Document.

use crate::document::Document;
use crate::node::{Node, NodeId};
use crate::tag::SvgTag;
use crate::attr::{AttrKey, AttrValue};
use quick_xml::events::{Event, BytesStart};
use quick_xml::reader::Reader;
use std::collections::HashMap;

/// Parse an SVG string into a Document.
pub fn doc_from_svg_string(svg: &str) -> Result<Document, String> {
    let mut reader = Reader::from_str(svg);

    let mut doc = Document::new();
    // We'll rebuild the tree from scratch — clear the default nodes
    let old_root = doc.root;
    let old_defs = doc.defs;

    // Stack of (NodeId, is_root_svg_already_set)
    let mut stack: Vec<NodeId> = Vec::new();
    let mut root_set = false;
    // Map SVG id attrs to NodeIds for reference resolution
    let mut id_map: HashMap<String, NodeId> = HashMap::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) => {
                let tag_name = std::str::from_utf8(e.name().as_ref())
                    .unwrap_or("unknown")
                    .to_string();
                let tag = SvgTag::from_name(&tag_name);

                if !root_set && tag == SvgTag::Svg {
                    // Use the existing root node, just update its attrs
                    root_set = true;
                    parse_attrs_into(e, &mut doc, old_root);
                    stack.push(old_root);

                    // Check if svg has an id attr
                    if let Some(svg_id) = doc.get(old_root)
                        .and_then(|n| n.get_string(&AttrKey::Id))
                        .map(|s| s.to_string())
                    {
                        id_map.insert(svg_id, old_root);
                    }
                    continue;
                }

                let node = Node::new(tag);
                let node_id = node.id;

                // Parse attributes
                parse_attrs_into(e, &mut doc, node_id);
                // We need to insert the node first to make parse_attrs_into work
                // Actually, let's parse attrs onto the node directly
                let node_id = {
                    let mut node = Node::new(tag);
                    let node_id = node.id;

                    for attr in e.attributes().flatten() {
                        let key_str = std::str::from_utf8(attr.key.as_ref()).unwrap_or("");
                        let val_str = std::str::from_utf8(&attr.value).unwrap_or("");
                        let key = AttrKey::from_name(key_str);
                        if !matches!(key, AttrKey::Custom(_)) || key_str.starts_with("data-") {
                            let value = AttrValue::parse(&key, val_str);
                            node.set_attr(key, value);
                        }
                    }

                    // Track SVG id
                    if let Some(svg_id) = node.get_string(&AttrKey::Id).map(|s| s.to_string()) {
                        id_map.insert(svg_id, node_id);
                    }

                    // Handle defs specially
                    if tag == SvgTag::Defs && !stack.is_empty() {
                        // Replace the default defs node
                        if let Some(parent_id) = stack.last() {
                            // Remove old defs from parent
                            if let Some(parent) = doc.nodes.get_mut(parent_id) {
                                parent.children.retain(|c| *c != old_defs);
                            }
                            doc.nodes.remove(&old_defs);
                            node.parent = Some(*parent_id);
                            doc.defs = node_id;
                            if let Some(parent) = doc.nodes.get_mut(parent_id) {
                                parent.children.push(node_id);
                            }
                            doc.nodes.insert(node_id, node);
                        }
                    } else if let Some(&parent_id) = stack.last() {
                        node.parent = Some(parent_id);
                        doc.nodes.insert(node_id, node);
                        if let Some(parent) = doc.nodes.get_mut(&parent_id) {
                            parent.children.push(node_id);
                        }
                    } else {
                        doc.nodes.insert(node_id, node);
                    }
                    doc.dirty.insert(node_id);
                    node_id
                };

                stack.push(node_id);
            }
            Ok(Event::Empty(ref e)) => {
                // Self-closing element
                let tag_name = std::str::from_utf8(e.name().as_ref())
                    .unwrap_or("unknown")
                    .to_string();
                let tag = SvgTag::from_name(&tag_name);

                let mut node = Node::new(tag);
                let node_id = node.id;

                for attr in e.attributes().flatten() {
                    let key_str = std::str::from_utf8(attr.key.as_ref()).unwrap_or("");
                    let val_str = std::str::from_utf8(&attr.value).unwrap_or("");
                    let key = AttrKey::from_name(key_str);
                    if !matches!(key, AttrKey::Custom(_)) || key_str.starts_with("data-") {
                        let value = AttrValue::parse(&key, val_str);
                        node.set_attr(key, value);
                    }
                }

                if let Some(svg_id) = node.get_string(&AttrKey::Id).map(|s| s.to_string()) {
                    id_map.insert(svg_id, node_id);
                }

                if tag == SvgTag::Defs {
                    if let Some(&parent_id) = stack.last() {
                        if let Some(parent) = doc.nodes.get_mut(&parent_id) {
                            parent.children.retain(|c| *c != old_defs);
                        }
                        doc.nodes.remove(&old_defs);
                        node.parent = Some(parent_id);
                        doc.defs = node_id;
                        if let Some(parent) = doc.nodes.get_mut(&parent_id) {
                            parent.children.push(node_id);
                        }
                    }
                } else if let Some(&parent_id) = stack.last() {
                    node.parent = Some(parent_id);
                    if let Some(parent) = doc.nodes.get_mut(&parent_id) {
                        parent.children.push(node_id);
                    }
                }
                doc.nodes.insert(node_id, node);
                doc.dirty.insert(node_id);
            }
            Ok(Event::Text(ref e)) => {
                // Text content — attach to current element
                if let Some(&current_id) = stack.last() {
                    let text = e.unescape().unwrap_or_default().trim().to_string();
                    if !text.is_empty() {
                        doc.set_attr(current_id, AttrKey::TextContent, AttrValue::Str(text));
                    }
                }
            }
            Ok(Event::End(_)) => {
                stack.pop();
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error: {}", e)),
            _ => {} // Comments, PI, etc.
        }
    }

    Ok(doc)
}

/// Helper: parse attributes from a quick-xml element into a document node.
fn parse_attrs_into(e: &BytesStart, doc: &mut Document, node_id: NodeId) {
    for attr in e.attributes().flatten() {
        let key_str = std::str::from_utf8(attr.key.as_ref()).unwrap_or("");
        let val_str = std::str::from_utf8(&attr.value).unwrap_or("");
        let key = AttrKey::from_name(key_str);
        if !matches!(key, AttrKey::Custom(_)) || key_str.starts_with("data-") {
            let value = AttrValue::parse(&key, val_str);
            doc.set_attr(node_id, key, value);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_simple_svg() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
            <rect x="10" y="10" width="80" height="80" fill="#ff0000"/>
        </svg>"##;

        let doc = doc_from_svg_string(svg).unwrap();
        // root + defs + rect = 3 (defs may be replaced or absent)
        assert!(doc.node_count() >= 2); // At least svg + rect

        // Find the rect
        let root_children = doc.children(doc.root);
        let rect_id = root_children.iter()
            .find(|id| doc.get(**id).map(|n| n.tag) == Some(SvgTag::Rect))
            .expect("Should find rect");

        let rect = doc.get(*rect_id).unwrap();
        assert_eq!(rect.get_f32(&AttrKey::X), 10.0);
        assert_eq!(rect.get_f32(&AttrKey::Width), 80.0);
    }

    #[test]
    fn parse_with_groups() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
            <defs/>
            <g id="layer1">
                <circle cx="50" cy="50" r="25" fill="blue"/>
                <rect x="0" y="0" width="100" height="100"/>
            </g>
        </svg>"#;

        let doc = doc_from_svg_string(svg).unwrap();
        let group_id = doc.find_by_svg_id("layer1").expect("Should find group");
        let group = doc.get(group_id).unwrap();
        assert_eq!(group.tag, SvgTag::G);
        assert_eq!(group.children.len(), 2);
    }

    #[test]
    fn round_trip() {
        let svg_in = r##"<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">
            <defs/>
            <rect x="10" y="20" width="100" height="50" fill="#ff0000"/>
            <circle cx="200" cy="150" r="30" fill="#0000ff"/>
        </svg>"##;

        let doc = doc_from_svg_string(svg_in).unwrap();
        let svg_out = crate::serialize::doc_to_svg_string(&doc);

        // Re-parse and verify
        let doc2 = doc_from_svg_string(&svg_out).unwrap();
        assert_eq!(doc.node_count(), doc2.node_count());
    }

    #[test]
    fn parse_text_element() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
            <text x="10" y="50" font-size="24">Hello World</text>
        </svg>"#;

        let doc = doc_from_svg_string(svg).unwrap();
        let root_children = doc.children(doc.root);
        let text_id = root_children.iter()
            .find(|id| doc.get(**id).map(|n| n.tag) == Some(SvgTag::Text))
            .expect("Should find text");

        let text = doc.get(*text_id).unwrap();
        assert_eq!(text.get_string(&AttrKey::TextContent), Some("Hello World"));
    }
}
