//! Document: the SVG node tree container.

use crate::node::{Node, NodeId};
use crate::tag::SvgTag;
use crate::attr::{AttrKey, AttrValue};
use crate::command::SvgCommand;
use forge_math::Rect;
use serde::{Serialize, Deserialize};
use std::collections::{HashMap, HashSet};

/// The SVG document — a tree of nodes with a single root `<svg>` element.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    /// All nodes by ID.
    pub nodes: HashMap<NodeId, Node>,
    /// Root `<svg>` element.
    pub root: NodeId,
    /// `<defs>` container (child of root).
    pub defs: NodeId,
    /// Nodes modified since last render diff.
    pub dirty: HashSet<NodeId>,
    /// Nodes that were removed since last render diff.
    pub removed: Vec<NodeId>,
}

impl Document {
    /// Create a new empty SVG document with default viewport.
    pub fn new() -> Self {
        let mut root = Node::new(SvgTag::Svg);
        root.set_attr(AttrKey::Width, AttrValue::F32(800.0));
        root.set_attr(AttrKey::Height, AttrValue::F32(600.0));
        root.set_attr(
            AttrKey::ViewBox,
            AttrValue::ViewBox(Rect::new(0.0, 0.0, 800.0, 600.0)),
        );

        let defs = Node::new(SvgTag::Defs);
        let defs_id = defs.id;
        let root_id = root.id;

        root.children.push(defs_id);

        let mut nodes = HashMap::new();
        let mut defs_node = defs;
        defs_node.parent = Some(root_id);
        nodes.insert(root_id, root);
        nodes.insert(defs_id, defs_node);

        let mut dirty = HashSet::new();
        dirty.insert(root_id);
        dirty.insert(defs_id);

        Self {
            nodes,
            root: root_id,
            defs: defs_id,
            dirty,
            removed: Vec::new(),
        }
    }

    /// Get a node by ID.
    pub fn get(&self, id: NodeId) -> Option<&Node> {
        self.nodes.get(&id)
    }

    /// Get a mutable node by ID.
    pub fn get_mut(&mut self, id: NodeId) -> Option<&mut Node> {
        self.nodes.get_mut(&id)
    }

    /// Number of nodes in the document.
    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }

    /// Insert a node as a child of `parent` at position `index`.
    /// Returns the new node's ID.
    pub fn insert_node(
        &mut self,
        parent: NodeId,
        index: usize,
        node: Node,
    ) -> NodeId {
        let id = node.id;
        let mut node = node;
        node.parent = Some(parent);

        if let Some(parent_node) = self.nodes.get_mut(&parent) {
            let idx = index.min(parent_node.children.len());
            parent_node.children.insert(idx, id);
        }

        self.nodes.insert(id, node);
        self.mark_dirty(id);
        self.mark_dirty(parent);
        id
    }

    /// Insert an entire subtree (list of nodes in pre-order).
    /// The first node is inserted as a child of `parent` at `index`.
    /// Subsequent nodes are re-inserted by their stored parent references.
    pub fn insert_subtree(
        &mut self,
        parent: NodeId,
        index: usize,
        nodes: Vec<Node>,
    ) {
        if nodes.is_empty() {
            return;
        }

        // First node: attach to the specified parent
        let mut root = nodes[0].clone();
        let root_id = root.id;
        root.parent = Some(parent);
        root.children.clear();

        if let Some(parent_node) = self.nodes.get_mut(&parent) {
            let idx = index.min(parent_node.children.len());
            parent_node.children.insert(idx, root_id);
        }
        self.nodes.insert(root_id, root);
        self.mark_dirty(root_id);
        self.mark_dirty(parent);

        // Remaining nodes: insert using their stored parent references
        for node in nodes.into_iter().skip(1) {
            let id = node.id;
            let node_parent = node.parent.unwrap_or(root_id);
            let mut node = node;
            node.children.clear();
            node.parent = Some(node_parent);

            if let Some(p) = self.nodes.get_mut(&node_parent) {
                p.children.push(id);
            }
            self.nodes.insert(id, node);
            self.mark_dirty(id);
        }
    }

    /// Remove a node and its entire subtree.
    /// Returns all removed nodes (for undo).
    pub fn remove_subtree(&mut self, id: NodeId) -> Vec<Node> {
        let mut removed = Vec::new();
        self.collect_subtree(id, &mut removed);

        // Remove from parent's children list
        if let Some(node) = self.nodes.get(&id) {
            if let Some(parent_id) = node.parent {
                if let Some(parent) = self.nodes.get_mut(&parent_id) {
                    parent.children.retain(|c| *c != id);
                    self.dirty.insert(parent_id);
                }
            }
        }

        // Remove all nodes in subtree
        for node in &removed {
            self.nodes.remove(&node.id);
            self.dirty.remove(&node.id);
            self.removed.push(node.id);
        }

        removed
    }

    /// Collect all nodes in a subtree (pre-order).
    fn collect_subtree(&self, id: NodeId, out: &mut Vec<Node>) {
        if let Some(node) = self.nodes.get(&id) {
            let children = node.children.clone();
            out.push(node.clone());
            for child in children {
                self.collect_subtree(child, out);
            }
        }
    }

    /// Set an attribute on a node.
    pub fn set_attr(&mut self, id: NodeId, key: AttrKey, value: AttrValue) {
        if let Some(node) = self.nodes.get_mut(&id) {
            node.set_attr(key, value);
            self.dirty.insert(id);
        }
    }

    /// Remove an attribute from a node.
    pub fn remove_attr(&mut self, id: NodeId, key: &AttrKey) -> Option<AttrValue> {
        let val = self.nodes.get_mut(&id).and_then(|n| n.remove_attr(key));
        if val.is_some() {
            self.dirty.insert(id);
        }
        val
    }

    /// Move a node to a new parent.
    pub fn reparent(&mut self, id: NodeId, new_parent: NodeId, index: usize) {
        // Remove from old parent
        if let Some(node) = self.nodes.get(&id) {
            if let Some(old_parent_id) = node.parent {
                if let Some(old_parent) = self.nodes.get_mut(&old_parent_id) {
                    old_parent.children.retain(|c| *c != id);
                    self.dirty.insert(old_parent_id);
                }
            }
        }

        // Add to new parent
        if let Some(parent) = self.nodes.get_mut(&new_parent) {
            let idx = index.min(parent.children.len());
            parent.children.insert(idx, id);
            self.dirty.insert(new_parent);
        }

        // Update node's parent ref
        if let Some(node) = self.nodes.get_mut(&id) {
            node.parent = Some(new_parent);
            self.dirty.insert(id);
        }
    }

    /// Reorder children of a parent node.
    pub fn reorder_children(&mut self, parent: NodeId, new_order: Vec<NodeId>) {
        if let Some(parent_node) = self.nodes.get_mut(&parent) {
            parent_node.children = new_order;
            self.dirty.insert(parent);
        }
    }

    /// Deep-clone a subtree, assigning new UUIDs to all nodes.
    pub fn clone_subtree(&mut self, id: NodeId) -> Option<NodeId> {
        let node = self.nodes.get(&id)?.clone();
        let mut new_node = Node::new(node.tag);
        new_node.attrs = node.attrs.clone();
        new_node.name = node.name.clone();
        new_node.visible = node.visible;
        new_node.locked = node.locked;

        let new_id = new_node.id;

        // Recursively clone children
        let child_ids: Vec<NodeId> = node.children.clone();
        let mut new_children = Vec::new();
        // Insert the new node first (without children, to avoid borrow issues)
        self.nodes.insert(new_id, new_node);

        for child_id in child_ids {
            if let Some(new_child_id) = self.clone_subtree(child_id) {
                if let Some(child) = self.nodes.get_mut(&new_child_id) {
                    child.parent = Some(new_id);
                }
                new_children.push(new_child_id);
            }
        }

        if let Some(n) = self.nodes.get_mut(&new_id) {
            n.children = new_children;
        }

        self.dirty.insert(new_id);
        Some(new_id)
    }

    /// Find a node by its `id` attribute (SVG id, not NodeId).
    pub fn find_by_svg_id(&self, svg_id: &str) -> Option<NodeId> {
        self.nodes.values().find_map(|n| {
            if n.get_string(&AttrKey::Id) == Some(svg_id) {
                Some(n.id)
            } else {
                None
            }
        })
    }

    /// Mark a node as dirty (needs re-render).
    pub fn mark_dirty(&mut self, id: NodeId) {
        self.dirty.insert(id);
    }

    /// Take and clear the dirty set.
    pub fn take_dirty(&mut self) -> HashSet<NodeId> {
        std::mem::take(&mut self.dirty)
    }

    /// Take and clear the removed list.
    pub fn take_removed(&mut self) -> Vec<NodeId> {
        std::mem::take(&mut self.removed)
    }

    /// Iterate children of a node.
    pub fn children(&self, id: NodeId) -> Vec<NodeId> {
        self.nodes
            .get(&id)
            .map(|n| n.children.clone())
            .unwrap_or_default()
    }

    /// Walk the tree depth-first (pre-order), calling `f` for each node.
    pub fn walk<F: FnMut(&Node)>(&self, root: NodeId, f: &mut F) {
        if let Some(node) = self.nodes.get(&root) {
            f(node);
            let children = node.children.clone();
            for child in children {
                self.walk(child, f);
            }
        }
    }

    /// Execute a command against this document (without recording for undo).
    pub fn execute(&mut self, cmd: &SvgCommand) -> Result<(), crate::command::CommandError> {
        cmd.apply(self)
    }
}

impl Default for Document {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_document_has_root_and_defs() {
        let doc = Document::new();
        assert!(doc.get(doc.root).is_some());
        assert!(doc.get(doc.defs).is_some());
        assert_eq!(doc.get(doc.root).unwrap().tag, SvgTag::Svg);
        assert_eq!(doc.get(doc.defs).unwrap().tag, SvgTag::Defs);
    }

    #[test]
    fn insert_and_remove_node() {
        let mut doc = Document::new();
        let rect = Node::new(SvgTag::Rect);
        let rect_id = rect.id;
        doc.insert_node(doc.root, 1, rect); // After defs

        assert_eq!(doc.node_count(), 3); // svg + defs + rect
        assert!(doc.get(rect_id).is_some());

        let removed = doc.remove_subtree(rect_id);
        assert_eq!(removed.len(), 1);
        assert_eq!(doc.node_count(), 2);
    }

    #[test]
    fn reparent_node() {
        let mut doc = Document::new();
        let group = Node::new(SvgTag::G);
        let group_id = group.id;
        doc.insert_node(doc.root, 1, group);

        let rect = Node::new(SvgTag::Rect);
        let rect_id = rect.id;
        doc.insert_node(doc.root, 2, rect);

        // Move rect into group
        doc.reparent(rect_id, group_id, 0);

        let group_node = doc.get(group_id).unwrap();
        assert_eq!(group_node.children.len(), 1);
        assert_eq!(group_node.children[0], rect_id);
    }

    #[test]
    fn clone_subtree() {
        let mut doc = Document::new();
        let group = Node::new(SvgTag::G);
        let group_id = group.id;
        doc.insert_node(doc.root, 1, group);

        let rect = Node::new(SvgTag::Rect);
        doc.insert_node(group_id, 0, rect);

        let cloned_id = doc.clone_subtree(group_id).unwrap();
        assert_ne!(cloned_id, group_id);

        // Cloned group should have one child
        let cloned = doc.get(cloned_id).unwrap();
        assert_eq!(cloned.children.len(), 1);
        assert_ne!(cloned.children[0], doc.get(group_id).unwrap().children[0]);
    }
}
