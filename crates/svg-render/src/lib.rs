//! svg-render: Diff engine that compares dirty nodes to last-rendered state
//! and emits minimal SVG DOM mutation operations.
//!
//! The TypeScript bridge applies these ops to the real `<svg>` element.
//! This is NOT a pixel renderer — the browser's native SVG engine does the painting.

use svg_doc::{Document, NodeId, Node, SvgTag, AttrKey};
use serde::{Serialize, Deserialize};
use std::collections::HashMap;

/// A single DOM mutation operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op")]
pub enum SvgDomOp {
    /// Create a new SVG element.
    CreateElement {
        id: String,
        tag: String,
        parent: String,
        index: u32,
    },
    /// Remove an SVG element.
    RemoveElement {
        id: String,
    },
    /// Set an attribute on an element.
    SetAttribute {
        id: String,
        key: String,
        value: String,
    },
    /// Remove an attribute from an element.
    RemoveAttribute {
        id: String,
        key: String,
    },
    /// Reorder children of an element.
    ReorderChildren {
        parent: String,
        order: Vec<String>,
    },
    /// Set text content of an element (for <text>, <tspan>).
    SetTextContent {
        id: String,
        text: String,
    },
}

/// Snapshot of a rendered node's state (for diffing).
#[derive(Debug, Clone)]
struct RenderedSnapshot {
    tag: SvgTag,
    attrs: HashMap<AttrKey, String>,
    children: Vec<NodeId>,
    text_content: Option<String>,
}

impl RenderedSnapshot {
    fn from_node(node: &Node) -> Self {
        let mut attrs = HashMap::new();
        for (key, value) in &node.attrs {
            if matches!(key, AttrKey::TextContent) {
                continue;
            }
            let svg_str = value.to_svg_string();
            if !svg_str.is_empty() {
                attrs.insert(*key, svg_str);
            }
        }

        let text_content = node.get_string(&AttrKey::TextContent).map(|s| s.to_string());

        Self {
            tag: node.tag,
            attrs,
            children: node.children.clone(),
            text_content,
        }
    }
}

/// The diff engine: tracks last-rendered state, emits minimal DOM ops.
pub struct DiffEngine {
    last_rendered: HashMap<NodeId, RenderedSnapshot>,
}

impl DiffEngine {
    pub fn new() -> Self {
        Self {
            last_rendered: HashMap::new(),
        }
    }

    /// Number of nodes in the last-rendered snapshot.
    pub fn last_rendered_count(&self) -> usize {
        self.last_rendered.len()
    }

    /// Generate DOM ops for a full initial render of the entire document.
    pub fn full_render(&mut self, doc: &Document) -> Vec<SvgDomOp> {
        let mut ops = Vec::new();
        self.last_rendered.clear();
        self.render_subtree(doc, doc.root, None, 0, &mut ops);
        ops
    }

    /// Generate DOM ops for only dirty/removed nodes.
    pub fn diff(&mut self, doc: &mut Document) -> Vec<SvgDomOp> {
        let mut ops = Vec::new();

        // Handle removals first
        let removed = doc.take_removed();
        for id in removed {
            if self.last_rendered.remove(&id).is_some() {
                ops.push(SvgDomOp::RemoveElement {
                    id: id.to_string(),
                });
            }
        }

        // Handle dirty nodes
        let dirty = doc.take_dirty();
        for id in &dirty {
            if let Some(node) = doc.get(*id) {
                if let Some(last) = self.last_rendered.get(id) {
                    // Node existed before — diff attributes
                    let current = RenderedSnapshot::from_node(node);

                    // Find changed/added attrs
                    for (key, value) in &current.attrs {
                        let changed = match last.attrs.get(key) {
                            Some(old_val) => old_val != value,
                            None => true,
                        };
                        if changed {
                            ops.push(SvgDomOp::SetAttribute {
                                id: id.to_string(),
                                key: key.as_name().to_string(),
                                value: value.clone(),
                            });
                        }
                    }

                    // Find removed attrs
                    for key in last.attrs.keys() {
                        if !current.attrs.contains_key(key) {
                            ops.push(SvgDomOp::RemoveAttribute {
                                id: id.to_string(),
                                key: key.as_name().to_string(),
                            });
                        }
                    }

                    // Check text content changes
                    if current.text_content != last.text_content {
                        if let Some(ref text) = current.text_content {
                            ops.push(SvgDomOp::SetTextContent {
                                id: id.to_string(),
                                text: text.clone(),
                            });
                        }
                    }

                    // Check child order changes
                    if current.children != last.children {
                        ops.push(SvgDomOp::ReorderChildren {
                            parent: id.to_string(),
                            order: current.children.iter().map(|c| c.to_string()).collect(),
                        });
                    }

                    self.last_rendered.insert(*id, current);
                } else {
                    // New node — create it
                    let parent_id = node.parent.map(|p| p.to_string()).unwrap_or_default();
                    let index = node.parent
                        .and_then(|p| doc.get(p))
                        .map(|p| p.children.iter().position(|c| c == id).unwrap_or(0) as u32)
                        .unwrap_or(0);

                    ops.push(SvgDomOp::CreateElement {
                        id: id.to_string(),
                        tag: node.tag.as_name().to_string(),
                        parent: parent_id,
                        index,
                    });

                    // Set all attributes
                    let snapshot = RenderedSnapshot::from_node(node);
                    for (key, value) in &snapshot.attrs {
                        ops.push(SvgDomOp::SetAttribute {
                            id: id.to_string(),
                            key: key.as_name().to_string(),
                            value: value.clone(),
                        });
                    }

                    if let Some(ref text) = snapshot.text_content {
                        ops.push(SvgDomOp::SetTextContent {
                            id: id.to_string(),
                            text: text.clone(),
                        });
                    }

                    self.last_rendered.insert(*id, snapshot);
                }
            }
        }

        ops
    }

    /// Recursively render a subtree (used for full_render).
    fn render_subtree(
        &mut self,
        doc: &Document,
        id: NodeId,
        parent: Option<NodeId>,
        index: u32,
        ops: &mut Vec<SvgDomOp>,
    ) {
        let node = match doc.get(id) {
            Some(n) => n,
            None => return,
        };

        ops.push(SvgDomOp::CreateElement {
            id: id.to_string(),
            tag: node.tag.as_name().to_string(),
            parent: parent.map(|p| p.to_string()).unwrap_or_default(),
            index,
        });

        let snapshot = RenderedSnapshot::from_node(node);

        for (key, value) in &snapshot.attrs {
            ops.push(SvgDomOp::SetAttribute {
                id: id.to_string(),
                key: key.as_name().to_string(),
                value: value.clone(),
            });
        }

        if let Some(ref text) = snapshot.text_content {
            ops.push(SvgDomOp::SetTextContent {
                id: id.to_string(),
                text: text.clone(),
            });
        }

        let children = node.children.clone();
        self.last_rendered.insert(id, snapshot);

        for (i, child_id) in children.iter().enumerate() {
            self.render_subtree(doc, *child_id, Some(id), i as u32, ops);
        }
    }
}

impl Default for DiffEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use svg_doc::*;

    #[test]
    fn full_render_empty_doc() {
        let doc = Document::new();
        let mut engine = DiffEngine::new();
        let ops = engine.full_render(&doc);

        // Should have CreateElement for svg and defs, plus SetAttribute ops
        let creates: Vec<_> = ops.iter().filter(|op| matches!(op, SvgDomOp::CreateElement { .. })).collect();
        assert_eq!(creates.len(), 2); // svg + defs
    }

    #[test]
    fn diff_detects_new_node() {
        let mut doc = Document::new();
        let mut engine = DiffEngine::new();

        // Full render first
        engine.full_render(&doc);

        // Clear dirty
        doc.take_dirty();
        doc.take_removed();

        // Add a rect
        let root = doc.root;
        let rect = Node::new(SvgTag::Rect);
        doc.insert_node(root, 1, rect);

        let ops = engine.diff(&mut doc);
        let creates: Vec<_> = ops.iter().filter(|op| matches!(op, SvgDomOp::CreateElement { .. })).collect();
        assert!(!creates.is_empty());
    }

    #[test]
    fn diff_detects_attr_change() {
        let mut doc = Document::new();
        let root = doc.root;
        let mut rect = Node::new(SvgTag::Rect);
        rect.set_attr(AttrKey::Fill, AttrValue::Str("#ff0000".to_string()));
        let rect_id = rect.id;
        doc.insert_node(root, 1, rect);

        let mut engine = DiffEngine::new();
        engine.full_render(&doc);
        doc.take_dirty();

        // Change fill
        doc.set_attr(rect_id, AttrKey::Fill, AttrValue::Str("#00ff00".to_string()));
        let ops = engine.diff(&mut doc);

        let sets: Vec<_> = ops.iter().filter(|op| matches!(op, SvgDomOp::SetAttribute { key, .. } if key == "fill")).collect();
        assert!(!sets.is_empty());
    }

    #[test]
    fn diff_detects_removal() {
        let mut doc = Document::new();
        let root = doc.root;
        let rect = Node::new(SvgTag::Rect);
        let rect_id = rect.id;
        doc.insert_node(root, 1, rect);

        let mut engine = DiffEngine::new();
        engine.full_render(&doc);
        doc.take_dirty();

        doc.remove_subtree(rect_id);
        let ops = engine.diff(&mut doc);

        let removes: Vec<_> = ops.iter().filter(|op| matches!(op, SvgDomOp::RemoveElement { .. })).collect();
        assert!(!removes.is_empty());
    }
}
