//! svg-layout: Constraint solver for SVG documents.
//!
//! Declarative constraints that resolve node positions/sizes.
//! Inspired by Clay's multi-pass layout algorithm:
//! 1. Collect constraints and build dependency graph
//! 2. Topological sort by dependency
//! 3. Solve in order, writing computed positions back to Document
//! 4. Mark solved nodes as dirty for re-render

mod connector;
pub use connector::*;

pub mod graph_layout;
pub use graph_layout::*;

use forge_math::Rect;
use svg_doc::{Document, NodeId, SvgTag, AttrKey, AttrValue};
use svg_text::TextMeasure;
use serde::{Serialize, Deserialize};

/// Anchor point on a node's bounding box.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Anchor {
    TopLeft,
    TopCenter,
    TopRight,
    CenterLeft,
    Center,
    CenterRight,
    BottomLeft,
    BottomCenter,
    BottomRight,
}

impl Anchor {
    /// Get the anchor point as a fraction of (width, height).
    pub fn as_fraction(&self) -> (f32, f32) {
        match self {
            Self::TopLeft => (0.0, 0.0),
            Self::TopCenter => (0.5, 0.0),
            Self::TopRight => (1.0, 0.0),
            Self::CenterLeft => (0.0, 0.5),
            Self::Center => (0.5, 0.5),
            Self::CenterRight => (1.0, 0.5),
            Self::BottomLeft => (0.0, 1.0),
            Self::BottomCenter => (0.5, 1.0),
            Self::BottomRight => (1.0, 1.0),
        }
    }
}

/// Layout axis.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Axis {
    X,
    Y,
    Both,
}

/// Alignment options.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Alignment {
    Start,
    Center,
    End,
}

/// A layout constraint that binds node positions/sizes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Constraint {
    /// Pin a node's anchor to another node's anchor with an offset.
    Pin {
        node: NodeId,
        to: NodeId,
        anchor: Anchor,
        target_anchor: Anchor,
        offset: (f32, f32),
    },
    /// Distribute children of a group evenly along an axis.
    Distribute {
        group: NodeId,
        axis: Axis,
        gap: f32,
    },
    /// Auto-resize a node to fit its content.
    AutoResize {
        node: NodeId,
        axis: Axis,
        min: f32,
        max: f32,
        padding: f32,
    },
    /// Lock a node's aspect ratio.
    AspectLock {
        node: NodeId,
        ratio: (u32, u32),
    },
    /// Repeat a template in a grid layout.
    RepeatGrid {
        template: NodeId,
        count: usize,
        columns: u32,
        gap: (f32, f32),
    },
    /// Align a node to a target.
    AlignTo {
        node: NodeId,
        target: NodeId,
        axis: Axis,
        alignment: Alignment,
    },
}

impl Constraint {
    /// Get the node this constraint primarily affects.
    pub fn target_node(&self) -> NodeId {
        match self {
            Self::Pin { node, .. } => *node,
            Self::Distribute { group, .. } => *group,
            Self::AutoResize { node, .. } => *node,
            Self::AspectLock { node, .. } => *node,
            Self::RepeatGrid { template, .. } => *template,
            Self::AlignTo { node, .. } => *node,
        }
    }

    /// Get all nodes this constraint depends on (reads from).
    pub fn dependencies(&self) -> Vec<NodeId> {
        match self {
            Self::Pin { to, .. } => vec![*to],
            Self::AlignTo { target, .. } => vec![*target],
            _ => vec![],
        }
    }
}

/// The constraint store: holds all active constraints and solves them.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ConstraintStore {
    constraints: Vec<Constraint>,
}

impl ConstraintStore {
    pub fn new() -> Self {
        Self {
            constraints: Vec::new(),
        }
    }

    pub fn add(&mut self, constraint: Constraint) {
        self.constraints.push(constraint);
    }

    pub fn remove_for_node(&mut self, node: NodeId) {
        self.constraints.retain(|c| c.target_node() != node);
    }

    pub fn constraints(&self) -> &[Constraint] {
        &self.constraints
    }

    pub fn len(&self) -> usize {
        self.constraints.len()
    }

    pub fn is_empty(&self) -> bool {
        self.constraints.is_empty()
    }

    /// Solve all constraints against the document.
    ///
    /// Uses a simple iterative approach:
    /// 1. Sort constraints so dependencies are resolved first
    /// 2. Apply each constraint, writing positions/sizes back to the doc
    /// 3. Mark affected nodes as dirty
    pub fn solve(&self, doc: &mut Document, _viewport: Rect, measurer: Option<&dyn TextMeasure>) {
        // Simple topological ordering: constraints with no dependencies first
        let mut ordered: Vec<&Constraint> = Vec::new();
        let mut deferred: Vec<&Constraint> = Vec::new();

        for c in &self.constraints {
            if c.dependencies().is_empty() {
                ordered.push(c);
            } else {
                deferred.push(c);
            }
        }
        ordered.extend(deferred);

        for constraint in ordered {
            match constraint {
                Constraint::Pin { node, to, anchor, target_anchor, offset } => {
                    self.solve_pin(doc, *node, *to, *anchor, *target_anchor, *offset);
                }
                Constraint::Distribute { group, axis, gap } => {
                    self.solve_distribute(doc, *group, *axis, *gap);
                }
                Constraint::AlignTo { node, target, axis, alignment } => {
                    self.solve_align(doc, *node, *target, *axis, *alignment);
                }
                Constraint::AspectLock { node, ratio } => {
                    self.solve_aspect_lock(doc, *node, *ratio);
                }
                Constraint::RepeatGrid { template, count, columns, gap } => {
                    self.solve_repeat_grid(doc, *template, *count, *columns, *gap);
                }
                Constraint::AutoResize { node, axis, min, max, padding } => {
                    if let Some(m) = measurer {
                        self.solve_auto_resize(doc, *node, *axis, *min, *max, *padding, m);
                    }
                }
            }
        }
    }

    fn get_node_rect(&self, doc: &Document, id: NodeId) -> Rect {
        let node = match doc.get(id) {
            Some(n) => n,
            None => return Rect::ZERO,
        };
        let x = node.get_f32(&AttrKey::X);
        let y = node.get_f32(&AttrKey::Y);
        let w = node.get_f32(&AttrKey::Width);
        let h = node.get_f32(&AttrKey::Height);
        Rect::new(x, y, w, h)
    }

    fn solve_pin(
        &self,
        doc: &mut Document,
        node: NodeId,
        to: NodeId,
        anchor: Anchor,
        target_anchor: Anchor,
        offset: (f32, f32),
    ) {
        let target_rect = self.get_node_rect(doc, to);
        let node_rect = self.get_node_rect(doc, node);

        let (ta_fx, ta_fy) = target_anchor.as_fraction();
        let target_point = (
            target_rect.origin.x + target_rect.size.x * ta_fx,
            target_rect.origin.y + target_rect.size.y * ta_fy,
        );

        let (a_fx, a_fy) = anchor.as_fraction();
        let new_x = target_point.0 + offset.0 - node_rect.size.x * a_fx;
        let new_y = target_point.1 + offset.1 - node_rect.size.y * a_fy;

        doc.set_attr(node, AttrKey::X, AttrValue::F32(new_x));
        doc.set_attr(node, AttrKey::Y, AttrValue::F32(new_y));
    }

    fn solve_distribute(&self, doc: &mut Document, group: NodeId, axis: Axis, gap: f32) {
        let children = doc.children(group);
        if children.len() < 2 {
            return;
        }

        // Get parent position as starting point
        let parent_rect = self.get_node_rect(doc, group);
        let mut cursor_x = parent_rect.origin.x;
        let mut cursor_y = parent_rect.origin.y;

        for child_id in &children {
            let child_rect = self.get_node_rect(doc, *child_id);

            match axis {
                Axis::X | Axis::Both => {
                    doc.set_attr(*child_id, AttrKey::X, AttrValue::F32(cursor_x));
                    cursor_x += child_rect.size.x + gap;
                }
                Axis::Y => {}
            }

            match axis {
                Axis::Y | Axis::Both => {
                    doc.set_attr(*child_id, AttrKey::Y, AttrValue::F32(cursor_y));
                    cursor_y += child_rect.size.y + gap;
                }
                Axis::X => {}
            }
        }
    }

    fn solve_align(
        &self,
        doc: &mut Document,
        node: NodeId,
        target: NodeId,
        axis: Axis,
        alignment: Alignment,
    ) {
        let target_rect = self.get_node_rect(doc, target);
        let node_rect = self.get_node_rect(doc, node);

        match axis {
            Axis::X | Axis::Both => {
                let new_x = match alignment {
                    Alignment::Start => target_rect.origin.x,
                    Alignment::Center => target_rect.center().x - node_rect.size.x / 2.0,
                    Alignment::End => target_rect.origin.x + target_rect.size.x - node_rect.size.x,
                };
                doc.set_attr(node, AttrKey::X, AttrValue::F32(new_x));
            }
            Axis::Y => {}
        }

        match axis {
            Axis::Y | Axis::Both => {
                let new_y = match alignment {
                    Alignment::Start => target_rect.origin.y,
                    Alignment::Center => target_rect.center().y - node_rect.size.y / 2.0,
                    Alignment::End => target_rect.origin.y + target_rect.size.y - node_rect.size.y,
                };
                doc.set_attr(node, AttrKey::Y, AttrValue::F32(new_y));
            }
            Axis::X => {}
        }
    }

    fn solve_aspect_lock(&self, doc: &mut Document, node: NodeId, ratio: (u32, u32)) {
        let rect = self.get_node_rect(doc, node);
        let target_ratio = ratio.0 as f32 / ratio.1 as f32;
        let current_ratio = rect.size.x / rect.size.y.max(0.001);

        if (current_ratio - target_ratio).abs() > 0.01 {
            // Adjust height to match ratio
            let new_height = rect.size.x / target_ratio;
            doc.set_attr(node, AttrKey::Height, AttrValue::F32(new_height));
        }
    }

    fn solve_repeat_grid(
        &self,
        doc: &mut Document,
        template: NodeId,
        count: usize,
        columns: u32,
        gap: (f32, f32),
    ) {
        let template_rect = self.get_node_rect(doc, template);
        let parent = doc.get(template).and_then(|n| n.parent).unwrap_or(doc.root);
        let cell_w = template_rect.size.x;
        let cell_h = template_rect.size.y;

        // Clone template `count - 1` times and position in grid
        for i in 1..count {
            let col = (i as u32) % columns;
            let row = (i as u32) / columns;

            if let Some(clone_id) = doc.clone_subtree(template) {
                let x = template_rect.origin.x + col as f32 * (cell_w + gap.0);
                let y = template_rect.origin.y + row as f32 * (cell_h + gap.1);

                doc.set_attr(clone_id, AttrKey::X, AttrValue::F32(x));
                doc.set_attr(clone_id, AttrKey::Y, AttrValue::F32(y));

                // Add to parent
                if let Some(clone_node) = doc.get_mut(clone_id) {
                    clone_node.parent = Some(parent);
                }
                if let Some(parent_node) = doc.get_mut(parent) {
                    parent_node.children.push(clone_id);
                }
            }
        }
    }

    fn solve_auto_resize(
        &self,
        doc: &mut Document,
        node: NodeId,
        axis: Axis,
        min: f32,
        max: f32,
        padding: f32,
        measurer: &dyn TextMeasure,
    ) {
        let children = doc.children(node);
        let text_children: Vec<NodeId> = children
            .iter()
            .filter(|c| doc.get(**c).map(|n| n.tag == SvgTag::Text).unwrap_or(false))
            .copied()
            .collect();

        if text_children.is_empty() {
            return;
        }

        let container_rect = self.get_node_rect(doc, node);
        let mut total_text_height: f32 = 0.0;
        let mut max_text_width: f32 = 0.0;

        for text_id in &text_children {
            let runs = svg_doc::extract_text_runs(doc, *text_id);
            if runs.is_empty() {
                continue;
            }

            let available_width = if container_rect.size.x > padding * 2.0 {
                container_rect.size.x - padding * 2.0
            } else {
                f32::INFINITY
            };

            let config = svg_text::paragraph::ParagraphConfig {
                max_width: available_width,
                ..Default::default()
            };
            let layout = svg_text::paragraph::layout_paragraphs(&runs, &config, measurer);

            // Emit tspan structure into the document
            svg_text::emit::emit_layout(&layout, *text_id, doc);

            total_text_height += layout.height;
            max_text_width = max_text_width.max(layout.width);
        }

        // Resize container
        let new_width = (max_text_width + padding * 2.0).clamp(min, max);
        let new_height = (total_text_height + padding * 2.0).clamp(min, max);

        match axis {
            Axis::X | Axis::Both => {
                doc.set_attr(node, AttrKey::Width, AttrValue::F32(new_width));
            }
            _ => {}
        }
        match axis {
            Axis::Y | Axis::Both => {
                doc.set_attr(node, AttrKey::Height, AttrValue::F32(new_height));
            }
            _ => {}
        }

        // Also resize sibling <rect> background to match
        let children = doc.children(node);
        for child_id in &children {
            if let Some(child) = doc.get(*child_id) {
                if child.tag == SvgTag::Rect {
                    match axis {
                        Axis::X | Axis::Both => {
                            doc.set_attr(*child_id, AttrKey::Width, AttrValue::F32(new_width));
                        }
                        _ => {}
                    }
                    match axis {
                        Axis::Y | Axis::Both => {
                            doc.set_attr(*child_id, AttrKey::Height, AttrValue::F32(new_height));
                        }
                        _ => {}
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use svg_doc::{Node, SvgTag};

    fn make_doc_with_rects() -> (Document, NodeId, NodeId) {
        let mut doc = Document::new();
        let root = doc.root;

        let mut r1 = Node::new(SvgTag::Rect);
        r1.set_attr(AttrKey::X, AttrValue::F32(0.0));
        r1.set_attr(AttrKey::Y, AttrValue::F32(0.0));
        r1.set_attr(AttrKey::Width, AttrValue::F32(100.0));
        r1.set_attr(AttrKey::Height, AttrValue::F32(50.0));
        let r1_id = r1.id;
        doc.insert_node(root, 1, r1);

        let mut r2 = Node::new(SvgTag::Rect);
        r2.set_attr(AttrKey::X, AttrValue::F32(0.0));
        r2.set_attr(AttrKey::Y, AttrValue::F32(0.0));
        r2.set_attr(AttrKey::Width, AttrValue::F32(80.0));
        r2.set_attr(AttrKey::Height, AttrValue::F32(40.0));
        let r2_id = r2.id;
        doc.insert_node(root, 2, r2);

        (doc, r1_id, r2_id)
    }

    #[test]
    fn pin_constraint() {
        let (mut doc, r1, r2) = make_doc_with_rects();
        let viewport = Rect::new(0.0, 0.0, 800.0, 600.0);

        let mut store = ConstraintStore::new();
        store.add(Constraint::Pin {
            node: r2,
            to: r1,
            anchor: Anchor::TopLeft,
            target_anchor: Anchor::TopRight,
            offset: (10.0, 0.0),
        });

        store.solve(&mut doc, viewport, None);

        // r2 should be at r1.right + 10 = 110
        let r2_x = doc.get(r2).unwrap().get_f32(&AttrKey::X);
        assert!((r2_x - 110.0).abs() < 0.01);
    }

    #[test]
    fn distribute_constraint() {
        let mut doc = Document::new();
        let root = doc.root;

        let mut group = Node::new(SvgTag::G);
        group.set_attr(AttrKey::X, AttrValue::F32(0.0));
        group.set_attr(AttrKey::Y, AttrValue::F32(0.0));
        let group_id = group.id;
        doc.insert_node(root, 1, group);

        for i in 0..3 {
            let mut r = Node::new(SvgTag::Rect);
            r.set_attr(AttrKey::Width, AttrValue::F32(50.0));
            r.set_attr(AttrKey::Height, AttrValue::F32(50.0));
            doc.insert_node(group_id, i, r);
        }

        let mut store = ConstraintStore::new();
        store.add(Constraint::Distribute {
            group: group_id,
            axis: Axis::X,
            gap: 10.0,
        });

        let viewport = Rect::new(0.0, 0.0, 800.0, 600.0);
        store.solve(&mut doc, viewport, None);

        let children = doc.children(group_id);
        let x0 = doc.get(children[0]).unwrap().get_f32(&AttrKey::X);
        let x1 = doc.get(children[1]).unwrap().get_f32(&AttrKey::X);
        let x2 = doc.get(children[2]).unwrap().get_f32(&AttrKey::X);

        assert!((x0 - 0.0).abs() < 0.01);
        assert!((x1 - 60.0).abs() < 0.01);  // 50 + 10
        assert!((x2 - 120.0).abs() < 0.01); // 50 + 10 + 50 + 10
    }

    #[test]
    fn align_center() {
        let (mut doc, r1, r2) = make_doc_with_rects();
        let viewport = Rect::new(0.0, 0.0, 800.0, 600.0);

        let mut store = ConstraintStore::new();
        store.add(Constraint::AlignTo {
            node: r2,
            target: r1,
            axis: Axis::X,
            alignment: Alignment::Center,
        });

        store.solve(&mut doc, viewport, None);

        // r1 is 100px wide at x=0, center = 50
        // r2 is 80px wide, so x should be 50 - 40 = 10
        let r2_x = doc.get(r2).unwrap().get_f32(&AttrKey::X);
        assert!((r2_x - 10.0).abs() < 0.01);
    }

    #[test]
    fn aspect_lock_adjusts_height() {
        let mut doc = Document::new();
        let root = doc.root;

        let mut rect = Node::new(SvgTag::Rect);
        rect.set_attr(AttrKey::X, AttrValue::F32(0.0));
        rect.set_attr(AttrKey::Y, AttrValue::F32(0.0));
        rect.set_attr(AttrKey::Width, AttrValue::F32(200.0));
        rect.set_attr(AttrKey::Height, AttrValue::F32(100.0)); // Current ratio 2:1
        let rect_id = rect.id;
        doc.insert_node(root, 1, rect);

        let mut store = ConstraintStore::new();
        store.add(Constraint::AspectLock {
            node: rect_id,
            ratio: (16, 9), // Target 16:9
        });

        let viewport = Rect::new(0.0, 0.0, 800.0, 600.0);
        store.solve(&mut doc, viewport, None);

        // Width stays 200, height should become 200 / (16/9) = 112.5
        let h = doc.get(rect_id).unwrap().get_f32(&AttrKey::Height);
        assert!((h - 112.5).abs() < 0.1, "Expected height ~112.5, got {}", h);
    }

    #[test]
    fn repeat_grid_positions_clones() {
        let mut doc = Document::new();
        let root = doc.root;

        let mut tmpl = Node::new(SvgTag::Rect);
        tmpl.set_attr(AttrKey::X, AttrValue::F32(0.0));
        tmpl.set_attr(AttrKey::Y, AttrValue::F32(0.0));
        tmpl.set_attr(AttrKey::Width, AttrValue::F32(50.0));
        tmpl.set_attr(AttrKey::Height, AttrValue::F32(30.0));
        let tmpl_id = tmpl.id;
        doc.insert_node(root, 1, tmpl);

        let mut store = ConstraintStore::new();
        store.add(Constraint::RepeatGrid {
            template: tmpl_id,
            count: 4,
            columns: 2,
            gap: (10.0, 10.0),
        });

        let viewport = Rect::new(0.0, 0.0, 800.0, 600.0);
        store.solve(&mut doc, viewport, None);

        // Should have created 3 clones (count - 1) + original = 4 rects total
        let children = doc.children(root);
        // defs + original + 3 clones = 5
        assert!(children.len() >= 4, "Expected at least 4 children of root, got {}", children.len());
    }

    #[test]
    fn distribute_along_y_axis() {
        let mut doc = Document::new();
        let root = doc.root;

        let mut group = Node::new(SvgTag::G);
        group.set_attr(AttrKey::X, AttrValue::F32(10.0));
        group.set_attr(AttrKey::Y, AttrValue::F32(10.0));
        let group_id = group.id;
        doc.insert_node(root, 1, group);

        for _i in 0..3 {
            let mut r = Node::new(SvgTag::Rect);
            r.set_attr(AttrKey::Width, AttrValue::F32(40.0));
            r.set_attr(AttrKey::Height, AttrValue::F32(30.0));
            let idx = doc.children(group_id).len();
            doc.insert_node(group_id, idx, r);
        }

        let mut store = ConstraintStore::new();
        store.add(Constraint::Distribute {
            group: group_id,
            axis: Axis::Y,
            gap: 5.0,
        });

        let viewport = Rect::new(0.0, 0.0, 800.0, 600.0);
        store.solve(&mut doc, viewport, None);

        let children = doc.children(group_id);
        let y0 = doc.get(children[0]).unwrap().get_f32(&AttrKey::Y);
        let y1 = doc.get(children[1]).unwrap().get_f32(&AttrKey::Y);
        let y2 = doc.get(children[2]).unwrap().get_f32(&AttrKey::Y);

        assert!((y0 - 10.0).abs() < 0.01, "y0={}", y0);
        assert!((y1 - 45.0).abs() < 0.01, "y1={} expected 45", y1); // 10 + 30 + 5
        assert!((y2 - 80.0).abs() < 0.01, "y2={} expected 80", y2); // 45 + 30 + 5
    }

    #[test]
    fn pin_with_center_anchor() {
        let (mut doc, r1, r2) = make_doc_with_rects();
        let viewport = Rect::new(0.0, 0.0, 800.0, 600.0);

        let mut store = ConstraintStore::new();
        store.add(Constraint::Pin {
            node: r2,
            to: r1,
            anchor: Anchor::Center,        // r2's center
            target_anchor: Anchor::Center,  // r1's center
            offset: (0.0, 0.0),
        });

        store.solve(&mut doc, viewport, None);

        // r1 center = (50, 25), r2 is 80x40
        // r2 center at (50, 25) means r2 x = 50 - 40 = 10, y = 25 - 20 = 5
        let r2_x = doc.get(r2).unwrap().get_f32(&AttrKey::X);
        let r2_y = doc.get(r2).unwrap().get_f32(&AttrKey::Y);
        assert!((r2_x - 10.0).abs() < 0.01, "r2_x={}", r2_x);
        assert!((r2_y - 5.0).abs() < 0.01, "r2_y={}", r2_y);
    }

    #[test]
    fn multiple_constraints_on_same_node() {
        let mut doc = Document::new();
        let root = doc.root;

        let mut anchor = Node::new(SvgTag::Rect);
        anchor.set_attr(AttrKey::X, AttrValue::F32(100.0));
        anchor.set_attr(AttrKey::Y, AttrValue::F32(100.0));
        anchor.set_attr(AttrKey::Width, AttrValue::F32(100.0));
        anchor.set_attr(AttrKey::Height, AttrValue::F32(100.0));
        let anchor_id = anchor.id;
        doc.insert_node(root, 1, anchor);

        let mut target = Node::new(SvgTag::Rect);
        target.set_attr(AttrKey::Width, AttrValue::F32(200.0));
        target.set_attr(AttrKey::Height, AttrValue::F32(100.0));
        let target_id = target.id;
        doc.insert_node(root, 2, target);

        let mut store = ConstraintStore::new();
        // First: align X center
        store.add(Constraint::AlignTo {
            node: target_id,
            target: anchor_id,
            axis: Axis::X,
            alignment: Alignment::Center,
        });
        // Then: lock aspect ratio to 16:9
        store.add(Constraint::AspectLock {
            node: target_id,
            ratio: (16, 9),
        });

        let viewport = Rect::new(0.0, 0.0, 800.0, 600.0);
        store.solve(&mut doc, viewport, None);

        // Align center: anchor center X = 150, target width = 200 → x = 50
        let target_x = doc.get(target_id).unwrap().get_f32(&AttrKey::X);
        assert!((target_x - 50.0).abs() < 0.01, "target_x={}", target_x);

        // Aspect lock: width=200, ratio=16:9 → height = 200 / (16/9) = 112.5
        let target_h = doc.get(target_id).unwrap().get_f32(&AttrKey::Height);
        assert!((target_h - 112.5).abs() < 0.1, "target_h={}", target_h);
    }

    #[test]
    fn auto_resize_fits_text() {
        let mut doc = Document::new();
        let root = doc.root;

        // Create group container with rect + text
        let mut group = Node::new(SvgTag::G);
        group.set_attr(AttrKey::X, AttrValue::F32(10.0));
        group.set_attr(AttrKey::Y, AttrValue::F32(10.0));
        group.set_attr(AttrKey::Width, AttrValue::F32(200.0));
        group.set_attr(AttrKey::Height, AttrValue::F32(50.0));
        let group_id = group.id;
        doc.insert_node(root, 1, group);

        let mut rect = Node::new(SvgTag::Rect);
        rect.set_attr(AttrKey::Width, AttrValue::F32(200.0));
        rect.set_attr(AttrKey::Height, AttrValue::F32(50.0));
        let rect_id = rect.id;
        doc.insert_node(group_id, 0, rect);

        let mut text = Node::new(SvgTag::Text);
        text.set_attr(AttrKey::FontSize, AttrValue::F32(10.0));
        text.set_attr(AttrKey::TextContent, AttrValue::Str("Hello".into()));
        let text_id = text.id;
        doc.insert_node(group_id, 1, text);

        // Add AutoResize constraint
        let mut store = ConstraintStore::new();
        store.add(Constraint::AutoResize {
            node: group_id,
            axis: Axis::Both,
            min: 20.0,
            max: 500.0,
            padding: 10.0,
        });

        let measurer = svg_text::MockTextMeasure::new(10.0);
        let viewport = Rect::new(0.0, 0.0, 800.0, 600.0);
        store.solve(&mut doc, viewport, Some(&measurer));

        // "Hello" = 5 chars * 6.0 = 30.0 width, + 20 padding = 50.0
        // Height = 10.0 (ascent 8 + descent 2), + 20 padding = 30.0
        let group_w = doc.get(group_id).unwrap().get_f32(&AttrKey::Width);
        let group_h = doc.get(group_id).unwrap().get_f32(&AttrKey::Height);
        assert!((group_w - 50.0).abs() < 1.0, "group_w={}", group_w);
        assert!((group_h - 30.0).abs() < 1.0, "group_h={}", group_h);

        // Rect should also be resized
        let rect_w = doc.get(rect_id).unwrap().get_f32(&AttrKey::Width);
        let rect_h = doc.get(rect_id).unwrap().get_f32(&AttrKey::Height);
        assert!((rect_w - group_w).abs() < 0.01);
        assert!((rect_h - group_h).abs() < 0.01);

        // Text node should have tspan children (emitter ran)
        let text_children = doc.children(text_id);
        let tspan_count = text_children.iter()
            .filter(|c| doc.get(**c).map(|n| n.tag == SvgTag::TSpan).unwrap_or(false))
            .count();
        assert!(tspan_count >= 1, "Expected tspan children, got {}", tspan_count);
    }

    #[test]
    fn auto_resize_respects_min_max() {
        let mut doc = Document::new();
        let root = doc.root;

        let mut group = Node::new(SvgTag::G);
        group.set_attr(AttrKey::Width, AttrValue::F32(200.0));
        group.set_attr(AttrKey::Height, AttrValue::F32(200.0));
        let group_id = group.id;
        doc.insert_node(root, 1, group);

        // Very short text
        let mut text = Node::new(SvgTag::Text);
        text.set_attr(AttrKey::FontSize, AttrValue::F32(10.0));
        text.set_attr(AttrKey::TextContent, AttrValue::Str("Hi".into()));
        doc.insert_node(group_id, 0, text);

        let mut store = ConstraintStore::new();
        store.add(Constraint::AutoResize {
            node: group_id,
            axis: Axis::Both,
            min: 100.0,  // min bigger than text needs
            max: 500.0,
            padding: 5.0,
        });

        let measurer = svg_text::MockTextMeasure::new(10.0);
        store.solve(&mut doc, Rect::new(0.0, 0.0, 800.0, 600.0), Some(&measurer));

        // "Hi" = 2 * 6.0 = 12.0 + 10 padding = 22.0, but min is 100
        let w = doc.get(group_id).unwrap().get_f32(&AttrKey::Width);
        let h = doc.get(group_id).unwrap().get_f32(&AttrKey::Height);
        assert!((w - 100.0).abs() < 0.01, "w={}", w);
        assert!((h - 100.0).abs() < 0.01, "h={}", h);
    }

    #[test]
    fn auto_resize_without_measurer_is_noop() {
        let mut doc = Document::new();
        let root = doc.root;

        let mut group = Node::new(SvgTag::G);
        group.set_attr(AttrKey::Width, AttrValue::F32(200.0));
        group.set_attr(AttrKey::Height, AttrValue::F32(100.0));
        let group_id = group.id;
        doc.insert_node(root, 1, group);

        let mut store = ConstraintStore::new();
        store.add(Constraint::AutoResize {
            node: group_id,
            axis: Axis::Both,
            min: 20.0,
            max: 500.0,
            padding: 10.0,
        });

        // Solve without measurer — AutoResize should be skipped
        store.solve(&mut doc, Rect::new(0.0, 0.0, 800.0, 600.0), None);

        // Dimensions unchanged
        assert_eq!(doc.get(group_id).unwrap().get_f32(&AttrKey::Width), 200.0);
        assert_eq!(doc.get(group_id).unwrap().get_f32(&AttrKey::Height), 100.0);
    }
}
