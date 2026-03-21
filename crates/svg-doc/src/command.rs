//! SvgCommand: all document mutations flow through commands for undo/redo.

use crate::node::{Node, NodeId};
use crate::tag::SvgTag;
use crate::attr::{AttrKey, AttrValue};
use crate::document::Document;
use serde::{Serialize, Deserialize};

/// A reversible command that mutates the SVG document.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SvgCommand {
    /// Insert a node as child of parent at index.
    InsertNode {
        node: Node,
        parent: NodeId,
        index: usize,
    },
    /// Remove a node (and its subtree). Stores the removed subtree for undo.
    RemoveNode {
        id: NodeId,
        /// Stored on execution for undo — the removed nodes.
        #[serde(default)]
        removed_nodes: Vec<Node>,
        /// Parent and index, filled during execution for undo.
        #[serde(default)]
        parent: Option<NodeId>,
        #[serde(default)]
        index: usize,
    },
    /// Set an attribute on a node.
    SetAttr {
        id: NodeId,
        key: AttrKey,
        value: AttrValue,
        /// Previous value, filled during execution for undo.
        #[serde(default)]
        old_value: Option<AttrValue>,
    },
    /// Remove an attribute from a node.
    RemoveAttr {
        id: NodeId,
        key: AttrKey,
        /// Previous value, filled during execution for undo.
        #[serde(default)]
        old_value: Option<AttrValue>,
    },
    /// Move a node to a new parent at index.
    Reparent {
        id: NodeId,
        new_parent: NodeId,
        index: usize,
        /// Old parent and index, filled during execution.
        #[serde(default)]
        old_parent: Option<NodeId>,
        #[serde(default)]
        old_index: usize,
    },
    /// Reorder children of a parent.
    Reorder {
        parent: NodeId,
        new_order: Vec<NodeId>,
        /// Previous order, filled during execution.
        #[serde(default)]
        old_order: Vec<NodeId>,
    },
    /// Batch of commands executed atomically.
    Batch {
        commands: Vec<SvgCommand>,
    },
}

impl SvgCommand {
    /// Apply this command to a document, filling in "old" fields for undo.
    pub fn apply(&self, doc: &mut Document) {
        match self {
            Self::InsertNode { node, parent, index } => {
                doc.insert_node(*parent, *index, node.clone());
            }
            Self::RemoveNode { id, .. } => {
                doc.remove_subtree(*id);
            }
            Self::SetAttr { id, key, value, .. } => {
                doc.set_attr(*id, *key, value.clone());
            }
            Self::RemoveAttr { id, key, .. } => {
                doc.remove_attr(*id, key);
            }
            Self::Reparent { id, new_parent, index, .. } => {
                doc.reparent(*id, *new_parent, *index);
            }
            Self::Reorder { parent, new_order, .. } => {
                doc.reorder_children(*parent, new_order.clone());
            }
            Self::Batch { commands } => {
                for cmd in commands {
                    cmd.apply(doc);
                }
            }
        }
    }

    /// Execute the command, capturing state needed for undo, and return the inverse.
    pub fn execute(self, doc: &mut Document) -> SvgCommand {
        match self {
            Self::InsertNode { node, parent, index } => {
                let id = node.id;
                doc.insert_node(parent, index, node.clone());
                SvgCommand::RemoveNode {
                    id,
                    removed_nodes: vec![node],
                    parent: Some(parent),
                    index,
                }
            }
            Self::RemoveNode { id, .. } => {
                // Capture parent info before removal
                let (parent, index) = doc.get(id)
                    .and_then(|n| {
                        n.parent.and_then(|pid| {
                            doc.get(pid).map(|p| {
                                let idx = p.children.iter().position(|c| *c == id).unwrap_or(0);
                                (pid, idx)
                            })
                        })
                    })
                    .unwrap_or((doc.root, 0));

                let removed = doc.remove_subtree(id);

                // Inverse: re-insert all nodes
                if let Some(root_node) = removed.first() {
                    SvgCommand::InsertNode {
                        node: root_node.clone(),
                        parent,
                        index,
                    }
                } else {
                    SvgCommand::Batch { commands: vec![] }
                }
            }
            Self::SetAttr { id, key, value, .. } => {
                let old_value = doc.get(id).and_then(|n| n.get_attr(&key).cloned());
                doc.set_attr(id, key, value.clone());
                match old_value {
                    Some(old) => SvgCommand::SetAttr {
                        id,
                        key,
                        value: old,
                        old_value: Some(value),
                    },
                    None => SvgCommand::RemoveAttr {
                        id,
                        key,
                        old_value: Some(value),
                    },
                }
            }
            Self::RemoveAttr { id, key, .. } => {
                let old_value = doc.remove_attr(id, &key);
                match old_value {
                    Some(old) => SvgCommand::SetAttr {
                        id,
                        key,
                        value: old,
                        old_value: None,
                    },
                    None => SvgCommand::Batch { commands: vec![] },
                }
            }
            Self::Reparent { id, new_parent, index, .. } => {
                let (old_parent, old_index) = doc.get(id)
                    .and_then(|n| {
                        n.parent.and_then(|pid| {
                            doc.get(pid).map(|p| {
                                let idx = p.children.iter().position(|c| *c == id).unwrap_or(0);
                                (pid, idx)
                            })
                        })
                    })
                    .unwrap_or((doc.root, 0));

                doc.reparent(id, new_parent, index);

                SvgCommand::Reparent {
                    id,
                    new_parent: old_parent,
                    index: old_index,
                    old_parent: Some(new_parent),
                    old_index: index,
                }
            }
            Self::Reorder { parent, new_order, .. } => {
                let old_order = doc.children(parent);
                doc.reorder_children(parent, new_order.clone());
                SvgCommand::Reorder {
                    parent,
                    new_order: old_order,
                    old_order: new_order,
                }
            }
            Self::Batch { commands } => {
                let inverses: Vec<SvgCommand> = commands
                    .into_iter()
                    .map(|cmd| cmd.execute(doc))
                    .collect();
                SvgCommand::Batch {
                    commands: inverses.into_iter().rev().collect(),
                }
            }
        }
    }

    /// Create a command to insert a new shape node.
    pub fn create_shape(parent: NodeId, index: usize, tag: SvgTag) -> (Self, NodeId) {
        let node = Node::new(tag);
        let id = node.id;
        (
            Self::InsertNode { node, parent, index },
            id,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_undo() {
        let mut doc = Document::new();
        let root = doc.root;

        let node = Node::new(SvgTag::Rect);
        let rect_id = node.id;
        let cmd = SvgCommand::InsertNode {
            node,
            parent: root,
            index: 1,
        };

        // Execute
        let undo_cmd = cmd.execute(&mut doc);
        assert_eq!(doc.node_count(), 3); // svg + defs + rect

        // Undo
        let _redo_cmd = undo_cmd.execute(&mut doc);
        assert_eq!(doc.node_count(), 2); // svg + defs
    }

    #[test]
    fn set_attr_undo() {
        let mut doc = Document::new();
        let root = doc.root;

        let node = Node::new(SvgTag::Rect);
        let rect_id = node.id;
        doc.insert_node(root, 1, node);

        // Set fill
        let cmd = SvgCommand::SetAttr {
            id: rect_id,
            key: AttrKey::Fill,
            value: AttrValue::Str("red".to_string()),
            old_value: None,
        };
        let undo = cmd.execute(&mut doc);

        assert_eq!(
            doc.get(rect_id).unwrap().get_attr(&AttrKey::Fill),
            Some(&AttrValue::Str("red".to_string()))
        );

        // Undo — should remove the attr since it didn't exist before
        undo.execute(&mut doc);
        assert!(doc.get(rect_id).unwrap().get_attr(&AttrKey::Fill).is_none());
    }

    #[test]
    fn batch_undo() {
        let mut doc = Document::new();
        let root = doc.root;

        let n1 = Node::new(SvgTag::Rect);
        let n2 = Node::new(SvgTag::Circle);
        let id1 = n1.id;
        let id2 = n2.id;

        let batch = SvgCommand::Batch {
            commands: vec![
                SvgCommand::InsertNode { node: n1, parent: root, index: 1 },
                SvgCommand::InsertNode { node: n2, parent: root, index: 2 },
            ],
        };

        let undo = batch.execute(&mut doc);
        assert_eq!(doc.node_count(), 4);

        undo.execute(&mut doc);
        assert_eq!(doc.node_count(), 2);
    }
}
