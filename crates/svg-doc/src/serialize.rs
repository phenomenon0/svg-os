//! SVG serialization — Document → SVG XML string.

use crate::document::Document;
use crate::node::NodeId;
use crate::tag::SvgTag;
use crate::attr::{AttrKey, AttrValue};

/// Serialize the entire document to an SVG string.
pub fn doc_to_svg_string(doc: &Document) -> String {
    let mut out = String::new();
    out.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    serialize_node(doc, doc.root, &mut out, 0);
    out
}

fn serialize_node(doc: &Document, id: NodeId, out: &mut String, depth: usize) {
    let node = match doc.get(id) {
        Some(n) => n,
        None => return,
    };

    let indent = "  ".repeat(depth);
    let tag_name = node.tag.as_name();

    out.push_str(&indent);
    out.push('<');
    out.push_str(tag_name);

    // Add xmlns for root <svg>
    if node.tag == SvgTag::Svg {
        out.push_str(" xmlns=\"http://www.w3.org/2000/svg\"");
        out.push_str(" xmlns:xlink=\"http://www.w3.org/1999/xlink\"");
    }

    // Serialize attributes in a stable order
    let mut attrs: Vec<(&AttrKey, &AttrValue)> = node.attrs.iter().collect();
    attrs.sort_by_key(|(k, _)| attr_sort_key(k));

    for (key, value) in &attrs {
        if matches!(value, AttrValue::None) {
            continue;
        }
        // Skip TextContent — it's rendered as element content, not an attribute
        if matches!(key, AttrKey::TextContent) {
            continue;
        }
        let svg_value = value.to_svg_string();
        if svg_value.is_empty() {
            continue;
        }
        out.push(' ');
        out.push_str(key.as_name());
        out.push_str("=\"");
        out.push_str(&xml_escape(&svg_value));
        out.push('"');
    }

    // Check if this is a text element with content
    let text_content = node.get_string(&AttrKey::TextContent).map(|s| s.to_string());

    if node.children.is_empty() && text_content.is_none() {
        out.push_str("/>\n");
    } else {
        out.push('>');

        if let Some(ref text) = text_content {
            if node.children.is_empty() {
                // Inline text content
                out.push_str(&xml_escape(text));
                out.push_str("</");
                out.push_str(tag_name);
                out.push_str(">\n");
                return;
            }
        }

        out.push('\n');

        // Text content before children (for mixed content)
        if let Some(ref text) = text_content {
            out.push_str(&"  ".repeat(depth + 1));
            out.push_str(&xml_escape(text));
            out.push('\n');
        }

        for child_id in &node.children {
            serialize_node(doc, *child_id, out, depth + 1);
        }

        out.push_str(&indent);
        out.push_str("</");
        out.push_str(tag_name);
        out.push_str(">\n");
    }
}

/// XML-escape a string for attribute values.
fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Sort key for consistent attribute ordering.
fn attr_sort_key(key: &AttrKey) -> u32 {
    match key {
        AttrKey::Id => 0,
        AttrKey::Class => 1,
        AttrKey::ViewBox => 2,
        AttrKey::Width => 3,
        AttrKey::Height => 4,
        AttrKey::X => 5,
        AttrKey::Y => 6,
        AttrKey::Cx => 7,
        AttrKey::Cy => 8,
        AttrKey::R => 9,
        AttrKey::Rx => 10,
        AttrKey::Ry => 11,
        AttrKey::X1 => 12,
        AttrKey::Y1 => 13,
        AttrKey::X2 => 14,
        AttrKey::Y2 => 15,
        AttrKey::D => 16,
        AttrKey::Points => 17,
        AttrKey::Transform => 20,
        AttrKey::Fill => 30,
        AttrKey::Stroke => 31,
        AttrKey::StrokeWidth => 32,
        AttrKey::Opacity => 33,
        _ => 100,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialize_empty_doc() {
        let doc = Document::new();
        let svg = doc_to_svg_string(&doc);
        assert!(svg.contains("<svg"));
        assert!(svg.contains("xmlns=\"http://www.w3.org/2000/svg\""));
        assert!(svg.contains("<defs/>"));
        assert!(svg.contains("</svg>"));
    }

    #[test]
    fn serialize_rect() {
        let mut doc = Document::new();
        let root = doc.root;
        let mut rect = crate::node::Node::new(SvgTag::Rect);
        rect.set_attr(AttrKey::X, AttrValue::F32(10.0));
        rect.set_attr(AttrKey::Y, AttrValue::F32(20.0));
        rect.set_attr(AttrKey::Width, AttrValue::F32(100.0));
        rect.set_attr(AttrKey::Height, AttrValue::F32(50.0));
        rect.set_attr(AttrKey::Fill, AttrValue::Str("#ff0000".to_string()));
        doc.insert_node(root, 1, rect);

        let svg = doc_to_svg_string(&doc);
        assert!(svg.contains("<rect"));
        assert!(svg.contains("x=\"10\""));
        assert!(svg.contains("width=\"100\""));
        assert!(svg.contains("fill=\"#ff0000\""));
    }
}
