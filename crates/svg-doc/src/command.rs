//! SvgCommand: all document mutations flow through commands for undo/redo.

use crate::node::{Node, NodeId};
use crate::tag::SvgTag;
use crate::attr::{AttrKey, AttrValue};
use crate::document::Document;
use serde::{Serialize, Deserialize};

/// Errors from command execution.
#[derive(Debug, Clone)]
pub enum CommandError {
    /// Target node does not exist in the document.
    NodeNotFound(NodeId),
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NodeNotFound(id) => write!(f, "node not found: {}", id),
        }
    }
}

impl std::error::Error for CommandError {}

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
    /// Re-insert an entire subtree (used as undo for RemoveNode).
    InsertSubtree {
        nodes: Vec<Node>,
        parent: NodeId,
        index: usize,
    },
    /// Batch of commands executed atomically.
    Batch {
        commands: Vec<SvgCommand>,
    },
}

impl SvgCommand {
    /// Apply this command to a document, filling in "old" fields for undo.
    pub fn apply(&self, doc: &mut Document) -> Result<(), CommandError> {
        match self {
            Self::InsertNode { node, parent, index } => {
                if doc.get(*parent).is_none() {
                    return Err(CommandError::NodeNotFound(*parent));
                }
                doc.insert_node(*parent, *index, node.clone());
            }
            Self::RemoveNode { id, .. } => {
                if doc.get(*id).is_none() {
                    return Err(CommandError::NodeNotFound(*id));
                }
                doc.remove_subtree(*id);
            }
            Self::SetAttr { id, key, value, .. } => {
                if doc.get(*id).is_none() {
                    return Err(CommandError::NodeNotFound(*id));
                }
                doc.set_attr(*id, *key, value.clone());
            }
            Self::RemoveAttr { id, key, .. } => {
                if doc.get(*id).is_none() {
                    return Err(CommandError::NodeNotFound(*id));
                }
                doc.remove_attr(*id, key);
            }
            Self::InsertSubtree { nodes, parent, index } => {
                if doc.get(*parent).is_none() {
                    return Err(CommandError::NodeNotFound(*parent));
                }
                doc.insert_subtree(*parent, *index, nodes.clone());
            }
            Self::Reparent { id, new_parent, index, .. } => {
                if doc.get(*id).is_none() {
                    return Err(CommandError::NodeNotFound(*id));
                }
                if doc.get(*new_parent).is_none() {
                    return Err(CommandError::NodeNotFound(*new_parent));
                }
                doc.reparent(*id, *new_parent, *index);
            }
            Self::Reorder { parent, new_order, .. } => {
                if doc.get(*parent).is_none() {
                    return Err(CommandError::NodeNotFound(*parent));
                }
                doc.reorder_children(*parent, new_order.clone());
            }
            Self::Batch { commands } => {
                for cmd in commands {
                    cmd.apply(doc)?;
                }
            }
        }
        Ok(())
    }

    /// Execute the command, capturing state needed for undo, and return the inverse.
    pub fn execute(self, doc: &mut Document) -> Result<SvgCommand, CommandError> {
        match self {
            Self::InsertNode { node, parent, index } => {
                if doc.get(parent).is_none() {
                    return Err(CommandError::NodeNotFound(parent));
                }
                let id = node.id;
                doc.insert_node(parent, index, node.clone());
                Ok(SvgCommand::RemoveNode {
                    id,
                    removed_nodes: vec![node],
                    parent: Some(parent),
                    index,
                })
            }
            Self::RemoveNode { id, .. } => {
                let (parent, index) = doc.get(id)
                    .and_then(|n| {
                        n.parent.and_then(|pid| {
                            doc.get(pid).map(|p| {
                                let idx = p.children.iter().position(|c| *c == id).unwrap_or(0);
                                (pid, idx)
                            })
                        })
                    })
                    .ok_or(CommandError::NodeNotFound(id))?;

                let removed = doc.remove_subtree(id);

                Ok(SvgCommand::InsertSubtree {
                    nodes: removed,
                    parent,
                    index,
                })
            }
            Self::InsertSubtree { nodes, parent, index } => {
                if doc.get(parent).is_none() {
                    return Err(CommandError::NodeNotFound(parent));
                }
                if let Some(first) = nodes.first() {
                    let id = first.id;
                    doc.insert_subtree(parent, index, nodes.clone());
                    Ok(SvgCommand::RemoveNode {
                        id,
                        removed_nodes: nodes,
                        parent: Some(parent),
                        index,
                    })
                } else {
                    Ok(SvgCommand::Batch { commands: vec![] })
                }
            }
            Self::SetAttr { id, key, value, .. } => {
                if doc.get(id).is_none() {
                    return Err(CommandError::NodeNotFound(id));
                }
                let old_value = doc.get(id).and_then(|n| n.get_attr(&key).cloned());
                doc.set_attr(id, key, value.clone());
                Ok(match old_value {
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
                })
            }
            Self::RemoveAttr { id, key, .. } => {
                if doc.get(id).is_none() {
                    return Err(CommandError::NodeNotFound(id));
                }
                let old_value = doc.remove_attr(id, &key);
                Ok(match old_value {
                    Some(old) => SvgCommand::SetAttr {
                        id,
                        key,
                        value: old,
                        old_value: None,
                    },
                    None => SvgCommand::Batch { commands: vec![] },
                })
            }
            Self::Reparent { id, new_parent, index, .. } => {
                if doc.get(id).is_none() {
                    return Err(CommandError::NodeNotFound(id));
                }
                if doc.get(new_parent).is_none() {
                    return Err(CommandError::NodeNotFound(new_parent));
                }
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

                Ok(SvgCommand::Reparent {
                    id,
                    new_parent: old_parent,
                    index: old_index,
                    old_parent: Some(new_parent),
                    old_index: index,
                })
            }
            Self::Reorder { parent, new_order, .. } => {
                if doc.get(parent).is_none() {
                    return Err(CommandError::NodeNotFound(parent));
                }
                let old_order = doc.children(parent);
                doc.reorder_children(parent, new_order.clone());
                Ok(SvgCommand::Reorder {
                    parent,
                    new_order: old_order,
                    old_order: new_order,
                })
            }
            Self::Batch { commands } => {
                let mut inverses = Vec::new();
                for cmd in commands {
                    inverses.push(cmd.execute(doc)?);
                }
                Ok(SvgCommand::Batch {
                    commands: inverses.into_iter().rev().collect(),
                })
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
        let _rect_id = node.id;
        let cmd = SvgCommand::InsertNode {
            node,
            parent: root,
            index: 1,
        };

        // Execute
        let undo_cmd = cmd.execute(&mut doc).unwrap();
        assert_eq!(doc.node_count(), 3); // svg + defs + rect

        // Undo
        let _redo_cmd = undo_cmd.execute(&mut doc).unwrap();
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
        let undo = cmd.execute(&mut doc).unwrap();

        assert_eq!(
            doc.get(rect_id).unwrap().get_attr(&AttrKey::Fill),
            Some(&AttrValue::Str("red".to_string()))
        );

        // Undo — should remove the attr since it didn't exist before
        undo.execute(&mut doc).unwrap();
        assert!(doc.get(rect_id).unwrap().get_attr(&AttrKey::Fill).is_none());
    }

    #[test]
    fn remove_subtree_undo_restores_children() {
        let mut doc = Document::new();
        let root = doc.root;

        // Create group with two children
        let group = Node::new(SvgTag::G);
        let group_id = group.id;
        doc.insert_node(root, 1, group);

        let rect = Node::new(SvgTag::Rect);
        let rect_id = rect.id;
        doc.insert_node(group_id, 0, rect);

        let circle = Node::new(SvgTag::Circle);
        let circle_id = circle.id;
        doc.insert_node(group_id, 1, circle);

        assert_eq!(doc.node_count(), 5); // svg + defs + group + rect + circle

        // Remove the group (and its subtree)
        let cmd = SvgCommand::RemoveNode {
            id: group_id,
            removed_nodes: vec![],
            parent: None,
            index: 0,
        };
        let undo_cmd = cmd.execute(&mut doc).unwrap();
        assert_eq!(doc.node_count(), 2); // svg + defs

        // Undo — should restore group AND both children
        let _redo_cmd = undo_cmd.execute(&mut doc).unwrap();
        assert_eq!(doc.node_count(), 5);
        assert!(doc.get(group_id).is_some());
        assert!(doc.get(rect_id).is_some());
        assert!(doc.get(circle_id).is_some());

        // Verify parent-child relationships restored
        let group_node = doc.get(group_id).unwrap();
        assert_eq!(group_node.children.len(), 2);
        assert!(group_node.children.contains(&rect_id));
        assert!(group_node.children.contains(&circle_id));
    }

    #[test]
    fn batch_undo() {
        let mut doc = Document::new();
        let root = doc.root;

        let n1 = Node::new(SvgTag::Rect);
        let n2 = Node::new(SvgTag::Circle);
        let _id1 = n1.id;
        let _id2 = n2.id;

        let batch = SvgCommand::Batch {
            commands: vec![
                SvgCommand::InsertNode { node: n1, parent: root, index: 1 },
                SvgCommand::InsertNode { node: n2, parent: root, index: 2 },
            ],
        };

        let undo = batch.execute(&mut doc).unwrap();
        assert_eq!(doc.node_count(), 4);

        undo.execute(&mut doc).unwrap();
        assert_eq!(doc.node_count(), 2);
    }
}
