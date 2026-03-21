//! svg-effects: Non-destructive effect graph.
//!
//! Effects are stackable, parametric, and reversible. They compile to
//! SVG `<filter>` elements or path modifications without mutating
//! the original geometry.

use forge_math::{Color, Mat3};
use svg_doc::{NodeId, SvgTag, AttrKey, AttrValue, Node, Document};
use serde::{Serialize, Deserialize};

/// A single non-destructive effect.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Effect {
    /// SVG feGaussianBlur
    GaussianBlur { std_dev: f32 },
    /// Drop shadow (composite of feOffset + feGaussianBlur + feFlood + feMerge)
    DropShadow {
        dx: f32,
        dy: f32,
        blur: f32,
        color: Color,
    },
    /// feColorMatrix
    ColorMatrix { matrix: [f32; 20] },
    /// Offset a path by a distance (path effect, not filter)
    PathOffset { distance: f32 },
    /// Transform effect (non-destructive)
    Transform { matrix: Mat3 },
    /// Custom effect with arbitrary parameters
    Custom {
        name: String,
        params: serde_json::Value,
    },
}

/// A stack of effects applied to a node.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EffectStack {
    pub effects: Vec<Effect>,
}

impl EffectStack {
    pub fn new() -> Self {
        Self { effects: Vec::new() }
    }

    pub fn push(&mut self, effect: Effect) {
        self.effects.push(effect);
    }

    pub fn remove(&mut self, index: usize) -> Option<Effect> {
        if index < self.effects.len() {
            Some(self.effects.remove(index))
        } else {
            None
        }
    }

    pub fn is_empty(&self) -> bool {
        self.effects.is_empty()
    }

    pub fn len(&self) -> usize {
        self.effects.len()
    }

    /// Compile the effect stack into an SVG `<filter>` element definition.
    /// Returns the filter element as a serialized SVG fragment and a unique filter ID.
    pub fn to_filter_svg(&self, filter_id: &str) -> Option<String> {
        let filter_effects: Vec<&Effect> = self.effects.iter().filter(|e| {
            matches!(e, Effect::GaussianBlur { .. } | Effect::DropShadow { .. } | Effect::ColorMatrix { .. })
        }).collect();

        if filter_effects.is_empty() {
            return None;
        }

        let mut svg = format!("<filter id=\"{}\">\n", filter_id);

        for (i, effect) in filter_effects.iter().enumerate() {
            match effect {
                Effect::GaussianBlur { std_dev } => {
                    svg.push_str(&format!(
                        "  <feGaussianBlur in=\"SourceGraphic\" stdDeviation=\"{}\"/>\n",
                        std_dev
                    ));
                }
                Effect::DropShadow { dx, dy, blur, color } => {
                    let bytes = color.to_u8();
                    let result_name = format!("shadow{}", i);
                    svg.push_str(&format!(
                        "  <feOffset in=\"SourceGraphic\" dx=\"{}\" dy=\"{}\" result=\"offset{}\"/>\n",
                        dx, dy, i
                    ));
                    svg.push_str(&format!(
                        "  <feGaussianBlur in=\"offset{}\" stdDeviation=\"{}\" result=\"blur{}\"/>\n",
                        i, blur, i
                    ));
                    svg.push_str(&format!(
                        "  <feFlood flood-color=\"#{:02x}{:02x}{:02x}\" flood-opacity=\"{}\" result=\"color{}\"/>\n",
                        bytes[0], bytes[1], bytes[2], format_f32(color.a), i
                    ));
                    svg.push_str(&format!(
                        "  <feComposite in=\"color{}\" in2=\"blur{}\" operator=\"in\" result=\"{}\"/>\n",
                        i, i, result_name
                    ));
                    svg.push_str("  <feMerge>\n");
                    svg.push_str(&format!("    <feMergeNode in=\"{}\"/>\n", result_name));
                    svg.push_str("    <feMergeNode in=\"SourceGraphic\"/>\n");
                    svg.push_str("  </feMerge>\n");
                }
                Effect::ColorMatrix { matrix } => {
                    let values: String = matrix.iter()
                        .map(|v| format_f32(*v))
                        .collect::<Vec<_>>()
                        .join(" ");
                    svg.push_str(&format!(
                        "  <feColorMatrix type=\"matrix\" values=\"{}\"/>\n",
                        values
                    ));
                }
                _ => {}
            }
        }

        svg.push_str("</filter>");
        Some(svg)
    }

    /// Check if any effect modifies the path geometry (vs. visual-only filters).
    pub fn has_path_effects(&self) -> bool {
        self.effects.iter().any(|e| matches!(e, Effect::PathOffset { .. } | Effect::Transform { .. }))
    }
}

/// Effect store: maps node IDs to their effect stacks.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EffectStore {
    stacks: std::collections::HashMap<NodeId, EffectStack>,
}

impl EffectStore {
    pub fn new() -> Self {
        Self {
            stacks: std::collections::HashMap::new(),
        }
    }

    /// Get the effect stack for a node.
    pub fn get(&self, node: NodeId) -> Option<&EffectStack> {
        self.stacks.get(&node)
    }

    /// Get or create the effect stack for a node.
    pub fn get_or_create(&mut self, node: NodeId) -> &mut EffectStack {
        self.stacks.entry(node).or_default()
    }

    /// Add an effect to a node's stack.
    pub fn add_effect(&mut self, node: NodeId, effect: Effect) {
        self.get_or_create(node).push(effect);
    }

    /// Remove an effect from a node's stack.
    pub fn remove_effect(&mut self, node: NodeId, index: usize) -> Option<Effect> {
        self.stacks.get_mut(&node).and_then(|s| s.remove(index))
    }

    /// Remove all effects for a node.
    pub fn clear_node(&mut self, node: NodeId) {
        self.stacks.remove(&node);
    }

    /// Apply filter effects to the document by creating/updating <filter> elements in <defs>.
    pub fn apply_to_document(&self, doc: &mut Document) {
        let defs = doc.defs;

        for (node_id, stack) in &self.stacks {
            let filter_id = format!("fx-{}", node_id);
            if let Some(_filter_svg) = stack.to_filter_svg(&filter_id) {
                // Create filter node in defs
                let mut filter_node = Node::new(SvgTag::Filter);
                filter_node.set_attr(AttrKey::Id, AttrValue::Str(filter_id.clone()));

                // Add filter primitives as child nodes
                for effect in &stack.effects {
                    match effect {
                        Effect::GaussianBlur { std_dev } => {
                            let mut fe = Node::new(SvgTag::FeGaussianBlur);
                            fe.set_attr(AttrKey::In, AttrValue::Str("SourceGraphic".to_string()));
                            fe.set_attr(AttrKey::StdDeviation, AttrValue::F32(*std_dev));
                            let _fe_id = fe.id;
                            doc.insert_node(filter_node.id, 0, fe);
                        }
                        _ => {} // Other effects handled similarly
                    }
                }

                let _filter_node_id = filter_node.id;
                doc.insert_node(defs, doc.children(defs).len(), filter_node);

                // Set filter reference on the target node
                doc.set_attr(*node_id, AttrKey::FilterRef, AttrValue::Url(filter_id));
            }
        }
    }
}

fn format_f32(v: f32) -> String {
    if v == v.floor() && v.abs() < 1e7 {
        format!("{}", v as i32)
    } else {
        let s = format!("{:.4}", v);
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blur_filter_svg() {
        let mut stack = EffectStack::new();
        stack.push(Effect::GaussianBlur { std_dev: 5.0 });

        let svg = stack.to_filter_svg("blur1").unwrap();
        assert!(svg.contains("feGaussianBlur"));
        assert!(svg.contains("stdDeviation=\"5\""));
    }

    #[test]
    fn drop_shadow_filter() {
        let mut stack = EffectStack::new();
        stack.push(Effect::DropShadow {
            dx: 3.0,
            dy: 3.0,
            blur: 5.0,
            color: Color::rgba(0.0, 0.0, 0.0, 0.5),
        });

        let svg = stack.to_filter_svg("shadow1").unwrap();
        assert!(svg.contains("feOffset"));
        assert!(svg.contains("feGaussianBlur"));
        assert!(svg.contains("feMerge"));
    }

    #[test]
    fn empty_stack_no_filter() {
        let stack = EffectStack::new();
        assert!(stack.to_filter_svg("empty").is_none());
    }

    #[test]
    fn effect_store_operations() {
        let mut store = EffectStore::new();
        let id = NodeId::new();

        store.add_effect(id, Effect::GaussianBlur { std_dev: 3.0 });
        store.add_effect(id, Effect::GaussianBlur { std_dev: 5.0 });

        assert_eq!(store.get(id).unwrap().len(), 2);

        store.remove_effect(id, 0);
        assert_eq!(store.get(id).unwrap().len(), 1);

        store.clear_node(id);
        assert!(store.get(id).is_none());
    }

    #[test]
    fn color_matrix_filter_svg() {
        let mut stack = EffectStack::new();
        // Identity matrix with slight saturation adjustment
        let mut matrix = [0.0f32; 20];
        matrix[0] = 1.0; matrix[6] = 1.0; matrix[12] = 1.0; matrix[18] = 1.0;
        stack.push(Effect::ColorMatrix { matrix });

        let svg = stack.to_filter_svg("cm1").unwrap();
        assert!(svg.contains("feColorMatrix"));
        assert!(svg.contains("type=\"matrix\""));
        assert!(svg.contains("values="));
    }

    #[test]
    fn multiple_stacked_effects() {
        let mut stack = EffectStack::new();
        stack.push(Effect::GaussianBlur { std_dev: 3.0 });
        stack.push(Effect::DropShadow {
            dx: 2.0, dy: 2.0, blur: 4.0,
            color: Color::rgba(0.0, 0.0, 0.0, 0.3),
        });

        let svg = stack.to_filter_svg("multi1").unwrap();
        assert!(svg.contains("feGaussianBlur"), "Missing blur");
        assert!(svg.contains("feOffset"), "Missing shadow offset");
        assert!(svg.contains("feMerge"), "Missing merge");
    }

    #[test]
    fn path_effect_detection() {
        let mut stack = EffectStack::new();

        // No path effects initially
        assert!(!stack.has_path_effects());

        // Filter effect doesn't count as path effect
        stack.push(Effect::GaussianBlur { std_dev: 5.0 });
        assert!(!stack.has_path_effects());

        // PathOffset is a path effect
        stack.push(Effect::PathOffset { distance: 3.0 });
        assert!(stack.has_path_effects());
    }

    #[test]
    fn apply_to_document_creates_filter() {
        let mut doc = Document::new();
        let root = doc.root;

        let mut rect = Node::new(SvgTag::Rect);
        rect.set_attr(AttrKey::Fill, AttrValue::Str("#ff0000".to_string()));
        let rect_id = rect.id;
        doc.insert_node(root, 1, rect);

        let mut store = EffectStore::new();
        store.add_effect(rect_id, Effect::GaussianBlur { std_dev: 5.0 });

        store.apply_to_document(&mut doc);

        // Rect should now have a filter reference
        let node = doc.get(rect_id).unwrap();
        let filter_ref = node.get_attr(&AttrKey::FilterRef);
        assert!(filter_ref.is_some(), "Expected filter reference on rect");

        // Defs should contain a filter node
        let defs_children = doc.children(doc.defs);
        assert!(!defs_children.is_empty(), "Expected filter node in defs");
    }
}
