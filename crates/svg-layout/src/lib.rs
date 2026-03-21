//! svg-layout: Constraint solver for SVG documents.
//!
//! Declarative constraints that resolve node positions/sizes.
//! Inspired by Clay's multi-pass layout algorithm:
//! 1. Collect constraints and build dependency graph
//! 2. Topological sort by dependency
//! 3. Solve in order, writing computed positions back to Document
//! 4. Mark solved nodes as dirty for re-render

use forge_math::Rect;
use svg_doc::{Document, NodeId, AttrKey, AttrValue};
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
    pub fn solve(&self, doc: &mut Document, _viewport: Rect) {
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
                Constraint::AutoResize { .. } => {
                    // Requires text measurement — deferred
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

        store.solve(&mut doc, viewport);

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
        store.solve(&mut doc, viewport);

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

        store.solve(&mut doc, viewport);

        // r1 is 100px wide at x=0, center = 50
        // r2 is 80px wide, so x should be 50 - 40 = 10
        let r2_x = doc.get(r2).unwrap().get_f32(&AttrKey::X);
        assert!((r2_x - 10.0).abs() < 0.01);
    }
}
