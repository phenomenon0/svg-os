//! Node type registry: templates as first-class canvas node types.
//!
//! A node type wraps an SVG template with metadata (slots, category, size).
//! The registry stores parsed Document subtrees for O(1) instantiation —
//! no SVG re-parsing per node placement.

use svg_doc::{Document, Node, NodeId, SvgTag, AttrKey, AttrValue, doc_from_svg_string};
use serde::{Serialize, Deserialize};
use std::collections::HashMap;

/// A bindable slot on a node type (auto-detected from data-bind attributes).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlotDef {
    pub field: String,
    pub bind_type: String,
    pub target_attr: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_value: Option<String>,
}

/// A registered node type.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeType {
    pub id: String,
    pub name: String,
    pub category: String,
    pub template_svg: String,
    pub slots: Vec<SlotDef>,
    pub default_width: f32,
    pub default_height: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

/// Lightweight info for listing (no full SVG template).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeTypeInfo {
    pub id: String,
    pub name: String,
    pub category: String,
    pub slots: Vec<SlotDef>,
    pub default_width: f32,
    pub default_height: f32,
}

impl From<&NodeType> for NodeTypeInfo {
    fn from(t: &NodeType) -> Self {
        Self {
            id: t.id.clone(),
            name: t.name.clone(),
            category: t.category.clone(),
            slots: t.slots.clone(),
            default_width: t.default_width,
            default_height: t.default_height,
        }
    }
}

/// Registry of node types. Stores pre-parsed templates for fast instantiation.
#[derive(Debug, Clone, Default)]
pub struct NodeTypeRegistry {
    types: HashMap<String, NodeType>,
    /// Pre-parsed document for each type (for fast cloning).
    parsed: HashMap<String, Document>,
}

impl NodeTypeRegistry {
    pub fn new() -> Self {
        Self { types: HashMap::new(), parsed: HashMap::new() }
    }

    /// Register a node type. Parses the template SVG once for fast instantiation.
    pub fn register(&mut self, node_type: NodeType) {
        if let Ok(doc) = doc_from_svg_string(&node_type.template_svg) {
            self.parsed.insert(node_type.id.clone(), doc);
        }
        self.types.insert(node_type.id.clone(), node_type);
    }

    /// Get a node type by ID.
    pub fn get(&self, id: &str) -> Option<&NodeType> {
        self.types.get(id)
    }

    /// List all registered types (lightweight info, no SVG payload).
    pub fn list(&self) -> Vec<NodeTypeInfo> {
        self.types.values().map(NodeTypeInfo::from).collect()
    }

    /// List types in a category.
    pub fn list_by_category(&self, category: &str) -> Vec<NodeTypeInfo> {
        self.types.values()
            .filter(|t| t.category == category)
            .map(NodeTypeInfo::from)
            .collect()
    }

    /// Create a NodeType from a template SVG, auto-detecting slots.
    pub fn from_template_svg(id: &str, name: &str, category: &str, svg: &str) -> NodeType {
        let slots = detect_slots(svg);
        let (w, h) = detect_dimensions(svg);
        NodeType {
            id: id.to_string(),
            name: name.to_string(),
            category: category.to_string(),
            template_svg: svg.to_string(),
            slots,
            default_width: w,
            default_height: h,
            icon: None,
        }
    }

    /// Instantiate a node type into a document at position (x, y).
    /// Returns the root group NodeId of the new instance, or None if type not found.
    pub fn instantiate(
        &self,
        type_id: &str,
        doc: &mut Document,
        x: f32,
        y: f32,
    ) -> Option<NodeId> {
        let node_type = self.types.get(type_id)?;
        let source_doc = self.parsed.get(type_id)?;

        // Clone the source document's root children into the target document
        let root = doc.root;
        let source_root = source_doc.root;
        let source_children = source_doc.children(source_root);

        // Create a wrapper group for the instance
        let mut group = Node::new(SvgTag::G);
        group.set_attr(AttrKey::X, AttrValue::F32(x));
        group.set_attr(AttrKey::Y, AttrValue::F32(y));
        group.set_attr(AttrKey::Width, AttrValue::F32(node_type.default_width));
        group.set_attr(AttrKey::Height, AttrValue::F32(node_type.default_height));
        // Tag with the node type for the property panel
        group.set_attr(AttrKey::Custom(0), AttrValue::Str(type_id.to_string()));
        group.add_default_ports();
        let group_id = group.id;
        let insert_idx = doc.children(root).len();
        doc.insert_node(root, insert_idx, group);

        // Deep-copy each child from the source document's root (skip defs)
        for src_child_id in &source_children {
            if let Some(src_child) = source_doc.get(*src_child_id) {
                if src_child.tag == SvgTag::Defs {
                    continue; // Skip defs, they go in the target doc's defs
                }
                deep_copy_node(source_doc, *src_child_id, doc, group_id);
            }
        }

        Some(group_id)
    }
}

/// Deep-copy a node and its children from a source document into a target document.
fn deep_copy_node(
    src_doc: &Document,
    src_id: NodeId,
    dst_doc: &mut Document,
    dst_parent: NodeId,
) {
    let src_node = match src_doc.get(src_id) {
        Some(n) => n,
        None => return,
    };

    let mut new_node = Node::new(src_node.tag);
    // Copy all attributes
    for (key, value) in &src_node.attrs {
        new_node.set_attr(*key, value.clone());
    }
    new_node.name = src_node.name.clone();
    new_node.visible = src_node.visible;
    new_node.locked = src_node.locked;
    new_node.ports = src_node.ports.clone();

    let new_id = new_node.id;
    let insert_idx = dst_doc.children(dst_parent).len();
    dst_doc.insert_node(dst_parent, insert_idx, new_node);

    // Recurse for children
    let src_children = src_node.children.clone();
    for child_id in src_children {
        deep_copy_node(src_doc, child_id, dst_doc, new_id);
    }
}

/// Detect data-bind slots from template SVG using quick-xml.
fn detect_slots(svg: &str) -> Vec<SlotDef> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(svg);
    let mut buf = Vec::new();
    let mut slots = Vec::new();
    let mut seen = std::collections::HashSet::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) | Ok(Event::Empty(ref e)) => {
                for attr_result in e.attributes() {
                    if let Ok(attr) = attr_result {
                        let key = std::str::from_utf8(attr.key.as_ref()).unwrap_or("");
                        let val = attr.unescape_value().unwrap_or_default();

                        let slot = if key == "data-bind" {
                            Some(SlotDef {
                                field: val.to_string(),
                                bind_type: "text".into(),
                                target_attr: "text-content".into(),
                                default_value: None,
                            })
                        } else if key == "data-bind-expr" {
                            Some(SlotDef {
                                field: val.to_string(),
                                bind_type: "expression".into(),
                                target_attr: "text-content".into(),
                                default_value: None,
                            })
                        } else if key == "data-bind-fill" {
                            Some(SlotDef {
                                field: val.to_string(),
                                bind_type: "color".into(),
                                target_attr: "fill".into(),
                                default_value: None,
                            })
                        } else if key == "data-bind-stop" {
                            Some(SlotDef {
                                field: val.to_string(),
                                bind_type: "color".into(),
                                target_attr: "stop-color".into(),
                                default_value: None,
                            })
                        } else if let Some(target) = key.strip_prefix("data-bind-attr-") {
                            Some(SlotDef {
                                field: val.to_string(),
                                bind_type: "attribute".into(),
                                target_attr: target.to_string(),
                                default_value: None,
                            })
                        } else {
                            None
                        };

                        if let Some(s) = slot {
                            let dedup = format!("{}:{}", s.field, s.target_attr);
                            if seen.insert(dedup) {
                                slots.push(s);
                            }
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }

    slots
}

/// Detect width/height from SVG root element.
fn detect_dimensions(svg: &str) -> (f32, f32) {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(svg);
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) | Ok(Event::Empty(ref e)) => {
                let qname = e.name();
                let name = std::str::from_utf8(qname.as_ref()).unwrap_or("");
                if name == "svg" {
                    let mut w = 400.0f32;
                    let mut h = 300.0f32;
                    for attr in e.attributes().flatten() {
                        let key = std::str::from_utf8(attr.key.as_ref()).unwrap_or("");
                        let val = attr.unescape_value().unwrap_or_default();
                        if key == "width" {
                            w = val.parse().unwrap_or(400.0);
                        } else if key == "height" {
                            h = val.parse().unwrap_or(300.0);
                        }
                    }
                    return (w, h);
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }

    (400.0, 300.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_template_detects_slots() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200">
  <text data-bind="name">Placeholder</text>
  <rect data-bind-fill="color" fill="#ccc"/>
  <image data-bind-attr-href="avatar"/>
</svg>"##;
        let nt = NodeTypeRegistry::from_template_svg("test", "Test Card", "cards", svg);
        assert_eq!(nt.id, "test");
        assert_eq!(nt.slots.len(), 3);
        assert_eq!(nt.default_width, 300.0);
        assert_eq!(nt.default_height, 200.0);
    }

    #[test]
    fn register_and_list() {
        let mut reg = NodeTypeRegistry::new();
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80"/></svg>"#;
        let nt = NodeTypeRegistry::from_template_svg("box", "Box", "shapes", svg);
        reg.register(nt);

        assert_eq!(reg.list().len(), 1);
        assert_eq!(reg.list()[0].id, "box");
        assert!(reg.get("box").is_some());
        assert!(reg.get("missing").is_none());
    }

    #[test]
    fn instantiate_creates_group() {
        let mut reg = NodeTypeRegistry::new();
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80">
  <rect width="160" height="80" fill="#1e293b" rx="8"/>
  <text x="80" y="45" text-anchor="middle">Label</text>
</svg>"##;
        let nt = NodeTypeRegistry::from_template_svg("card", "Card", "cards", svg);
        reg.register(nt);

        let mut doc = Document::new();
        let group_id = reg.instantiate("card", &mut doc, 100.0, 200.0).unwrap();

        // Group should be positioned
        let group = doc.get(group_id).unwrap();
        assert_eq!(group.tag, SvgTag::G);
        assert_eq!(group.get_f32(&AttrKey::X), 100.0);
        assert_eq!(group.get_f32(&AttrKey::Y), 200.0);
        assert_eq!(group.get_f32(&AttrKey::Width), 160.0);

        // Should have ports
        assert!(!group.ports.is_empty());

        // Should have children (rect + text from template)
        let children = doc.children(group_id);
        assert!(children.len() >= 2, "Expected at least 2 children, got {}", children.len());
    }

    #[test]
    fn instantiate_unknown_type_returns_none() {
        let reg = NodeTypeRegistry::new();
        let mut doc = Document::new();
        assert!(reg.instantiate("nonexistent", &mut doc, 0.0, 0.0).is_none());
    }

    #[test]
    fn list_by_category() {
        let mut reg = NodeTypeRegistry::new();
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect/></svg>"#;
        reg.register(NodeTypeRegistry::from_template_svg("a", "A", "cards", svg));
        reg.register(NodeTypeRegistry::from_template_svg("b", "B", "data", svg));
        reg.register(NodeTypeRegistry::from_template_svg("c", "C", "cards", svg));

        assert_eq!(reg.list_by_category("cards").len(), 2);
        assert_eq!(reg.list_by_category("data").len(), 1);
        assert_eq!(reg.list_by_category("other").len(), 0);
    }
}
