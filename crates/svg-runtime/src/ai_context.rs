//! AI context layer: graph manifest, per-node context, connection suggestions.
//!
//! Provides structured, queryable views of the document graph for AI consumption.
//! Everything here is a derived view — computed on demand, never stored.

use svg_doc::{Document, NodeId, NodeRole, AttrKey};
use svg_layout::{ConnectorStore, DataFlow};
use serde::{Serialize, Deserialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet, VecDeque};

use crate::binding::BindingEngine;
use crate::node_type::{NodeTypeRegistry, SlotDef};

// ── Graph Manifest ──────────────────────────────────────────────────────────

/// Compact semantic map of the entire document graph.
/// AI reads this first to orient before drilling into individual nodes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphManifest {
    pub nodes: Vec<ManifestNode>,
    pub edges: Vec<ManifestEdge>,
    pub summary: GraphSummary,
}

/// Lightweight node entry in the manifest (no geometry, no full SVG).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestNode {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub role: NodeRole,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_type_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub slots: Vec<SlotDef>,
    pub output_fields: Vec<String>,
    pub has_data: bool,
    pub position: (f32, f32),
}

/// Edge entry in the manifest.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestEdge {
    pub from_node: String,
    pub from_port: String,
    pub to_node: String,
    pub to_port: String,
    pub data_flow: DataFlow,
    pub connector_id: String,
}

/// Summary counts for the graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphSummary {
    pub total_nodes: usize,
    pub source_count: usize,
    pub view_count: usize,
    pub transform_count: usize,
    pub container_count: usize,
    pub element_count: usize,
    pub edge_count: usize,
    pub data_flow_edge_count: usize,
}

// ── Node Context ────────────────────────────────────────────────────────────

/// Focused context for a single node — what AI sees when drilling in.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeContext {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub role: NodeRole,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_type_id: Option<String>,
    pub input_slots: Vec<SlotDef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_shape: Option<Value>,
    pub incoming: Vec<ConnectionInfo>,
    pub outgoing: Vec<ConnectionInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_data: Option<Value>,
    pub depth: usize,
    pub upstream_count: usize,
    pub downstream_count: usize,
}

/// Info about a connection to/from a node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionInfo {
    pub node_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_name: Option<String>,
    pub port: String,
    pub data_flow: DataFlow,
}

// ── Connection Suggestion ───────────────────────────────────────────────────

/// AI-computed suggestion for how to connect two nodes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionSuggestion {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_output: Option<Value>,
    pub target_slots: Vec<SlotDef>,
    pub suggested_mappings: Vec<SuggestedMapping>,
    pub suggested_data_flow: DataFlow,
}

/// A single field-to-slot mapping suggestion.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuggestedMapping {
    pub source_field: String,
    pub target_slot: String,
    pub confidence: f32,
    pub reason: String,
}

// ── Builders ────────────────────────────────────────────────────────────────

/// Build a graph manifest from current engine state.
pub fn build_manifest(
    doc: &Document,
    connectors: &ConnectorStore,
    bindings: &BindingEngine,
    registry: &NodeTypeRegistry,
) -> GraphManifest {
    let mut nodes = Vec::new();
    let mut role_counts = HashMap::new();

    // Collect nodes that have ports or a role != Element (graph-relevant nodes).
    // Also include nodes that are targets of bindings.
    let bound_nodes: HashSet<NodeId> = bindings.bound_node_ids();
    let connected_nodes: HashSet<NodeId> = connectors.connected_node_ids();

    for (nid, node) in doc.nodes.iter() {
        // Skip structural SVG nodes (root svg, defs, individual filter elements, etc.)
        if node.parent.is_none() && node.tag == svg_doc::SvgTag::Svg {
            continue;
        }
        if node.tag == svg_doc::SvgTag::Defs {
            continue;
        }

        // Only include nodes that are graph-relevant:
        // - have a role other than Element
        // - have ports
        // - are connected
        // - are bound
        // - are top-level children of root (diagram nodes are typically groups at root level)
        let is_top_level = node.parent == Some(doc.root);
        let is_relevant = node.role != NodeRole::Element
            || !node.ports.is_empty()
            || connected_nodes.contains(nid)
            || bound_nodes.contains(nid)
            || is_top_level;

        if !is_relevant {
            continue;
        }

        // Extract node type ID from Custom(0) attr (set during instantiation)
        let type_id = node.get_string(&AttrKey::Custom(0)).map(|s| s.to_string());
        let category = type_id.as_ref()
            .and_then(|tid| registry.get(tid))
            .map(|nt| nt.category.clone());
        let slots = type_id.as_ref()
            .and_then(|tid| registry.get(tid))
            .map(|nt| nt.slots.clone())
            .unwrap_or_default();

        // Infer output fields from node_data
        let output_fields = bindings.get_node_data(*nid)
            .and_then(|v| v.as_object())
            .map(|obj| obj.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        let has_data = bindings.get_node_data(*nid).is_some();

        let x = node.get_f32(&AttrKey::X);
        let y = node.get_f32(&AttrKey::Y);

        *role_counts.entry(node.role).or_insert(0usize) += 1;

        nodes.push(ManifestNode {
            id: nid.to_string(),
            name: node.name.clone(),
            role: node.role,
            node_type_id: type_id,
            category,
            slots,
            output_fields,
            has_data,
            position: (x, y),
        });
    }

    // Build edges from connectors
    let mut edges = Vec::new();
    let mut data_flow_count = 0;
    for conn in connectors.connectors() {
        if !matches!(conn.data_flow, DataFlow::None) {
            data_flow_count += 1;
        }
        edges.push(ManifestEdge {
            from_node: conn.from.0.to_string(),
            from_port: conn.from.1.clone(),
            to_node: conn.to.0.to_string(),
            to_port: conn.to.1.clone(),
            data_flow: conn.data_flow.clone(),
            connector_id: conn.path_node.to_string(),
        });
    }

    let summary = GraphSummary {
        total_nodes: nodes.len(),
        source_count: *role_counts.get(&NodeRole::Source).unwrap_or(&0),
        view_count: *role_counts.get(&NodeRole::View).unwrap_or(&0),
        transform_count: *role_counts.get(&NodeRole::Transform).unwrap_or(&0),
        container_count: *role_counts.get(&NodeRole::Container).unwrap_or(&0),
        element_count: *role_counts.get(&NodeRole::Element).unwrap_or(&0),
        edge_count: edges.len(),
        data_flow_edge_count: data_flow_count,
    };

    GraphManifest { nodes, edges, summary }
}

/// Build focused context for a single node.
pub fn build_node_context(
    node_id: NodeId,
    doc: &Document,
    connectors: &ConnectorStore,
    bindings: &BindingEngine,
    registry: &NodeTypeRegistry,
) -> Option<NodeContext> {
    let node = doc.get(node_id)?;

    let type_id = node.get_string(&AttrKey::Custom(0)).map(|s| s.to_string());
    let input_slots = type_id.as_ref()
        .and_then(|tid| registry.get(tid))
        .map(|nt| nt.slots.clone())
        .unwrap_or_default();

    // Build incoming connections
    let incoming: Vec<ConnectionInfo> = connectors.incoming(node_id)
        .into_iter()
        .map(|c| {
            let src_name = doc.get(c.from.0).and_then(|n| n.name.clone());
            ConnectionInfo {
                node_id: c.from.0.to_string(),
                node_name: src_name,
                port: c.from.1.clone(),
                data_flow: c.data_flow.clone(),
            }
        })
        .collect();

    // Build outgoing connections
    let outgoing: Vec<ConnectionInfo> = connectors.outgoing(node_id)
        .into_iter()
        .map(|c| {
            let tgt_name = doc.get(c.to.0).and_then(|n| n.name.clone());
            ConnectionInfo {
                node_id: c.to.0.to_string(),
                node_name: tgt_name,
                port: c.to.1.clone(),
                data_flow: c.data_flow.clone(),
            }
        })
        .collect();

    // Current data from binding engine
    let current_data = bindings.get_node_data(node_id).cloned();

    // Output shape: infer from current data keys
    let output_shape = current_data.as_ref()
        .and_then(|v| v.as_object())
        .map(|obj| {
            let schema: serde_json::Map<String, Value> = obj.iter()
                .map(|(k, v)| {
                    let type_name = match v {
                        Value::String(_) => "string",
                        Value::Number(_) => "number",
                        Value::Bool(_) => "boolean",
                        Value::Array(_) => "array",
                        Value::Object(_) => "object",
                        Value::Null => "null",
                    };
                    (k.clone(), Value::String(type_name.to_string()))
                })
                .collect();
            Value::Object(schema)
        });

    // Compute depth: BFS backwards from this node through incoming connectors
    let depth = compute_depth(node_id, connectors);

    // Count upstream/downstream
    let upstream_count = count_reachable(node_id, connectors, true);
    let downstream_count = count_reachable(node_id, connectors, false);

    Some(NodeContext {
        id: node_id.to_string(),
        name: node.name.clone(),
        role: node.role,
        node_type_id: type_id,
        input_slots,
        output_shape,
        incoming,
        outgoing,
        current_data,
        depth,
        upstream_count,
        downstream_count,
    })
}

/// Compute suggestions for connecting source → target.
pub fn suggest_connection(
    from_id: NodeId,
    to_id: NodeId,
    doc: &Document,
    connectors: &ConnectorStore,
    bindings: &BindingEngine,
    registry: &NodeTypeRegistry,
) -> ConnectionSuggestion {
    // Get source output
    let source_output = bindings.get_node_data(from_id).cloned();

    // Get target slots
    let to_node = doc.get(to_id);
    let type_id = to_node.and_then(|n| n.get_string(&AttrKey::Custom(0)).map(|s| s.to_string()));
    let target_slots = type_id.as_ref()
        .and_then(|tid| registry.get(tid))
        .map(|nt| nt.slots.clone())
        .unwrap_or_default();

    // Generate field-to-slot suggestions
    let mut suggested_mappings = Vec::new();

    if let Some(ref output) = source_output {
        if let Some(obj) = output.as_object() {
            let source_fields: Vec<&String> = obj.keys().collect();

            for slot in &target_slots {
                // Try exact name match
                if let Some(field) = source_fields.iter().find(|f| **f == &slot.field) {
                    suggested_mappings.push(SuggestedMapping {
                        source_field: field.to_string(),
                        target_slot: slot.field.clone(),
                        confidence: 1.0,
                        reason: "exact name match".into(),
                    });
                    continue;
                }

                // Try case-insensitive match
                if let Some(field) = source_fields.iter().find(|f| f.eq_ignore_ascii_case(&slot.field)) {
                    suggested_mappings.push(SuggestedMapping {
                        source_field: field.to_string(),
                        target_slot: slot.field.clone(),
                        confidence: 0.8,
                        reason: "case-insensitive name match".into(),
                    });
                    continue;
                }

                // Try type-based match (color fields → fill/stroke slots)
                if slot.bind_type == "color" {
                    if let Some(field) = source_fields.iter().find(|f| {
                        let fl = f.to_lowercase();
                        fl.contains("color") || fl.contains("colour") || fl.contains("fill") || fl.contains("stroke")
                    }) {
                        suggested_mappings.push(SuggestedMapping {
                            source_field: field.to_string(),
                            target_slot: slot.field.clone(),
                            confidence: 0.6,
                            reason: "type-compatible: color field → color slot".into(),
                        });
                        continue;
                    }
                }

                // Try substring match
                if let Some(field) = source_fields.iter().find(|f| {
                    f.to_lowercase().contains(&slot.field.to_lowercase())
                    || slot.field.to_lowercase().contains(&f.to_lowercase())
                }) {
                    suggested_mappings.push(SuggestedMapping {
                        source_field: field.to_string(),
                        target_slot: slot.field.clone(),
                        confidence: 0.5,
                        reason: "partial name match".into(),
                    });
                }
            }
        }
    }

    // Suggest data flow type based on whether we have mappings
    let suggested_data_flow = if suggested_mappings.is_empty() {
        DataFlow::PassThrough
    } else if suggested_mappings.len() == 1 {
        DataFlow::Field(suggested_mappings[0].source_field.clone())
    } else {
        DataFlow::PassThrough
    };

    ConnectionSuggestion {
        source_output,
        target_slots,
        suggested_mappings,
        suggested_data_flow,
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/// Compute depth of a node (distance from nearest source via incoming data-flow edges).
fn compute_depth(node_id: NodeId, connectors: &ConnectorStore) -> usize {
    let mut visited = HashSet::new();
    let mut queue = VecDeque::new();
    queue.push_back((node_id, 0usize));
    visited.insert(node_id);
    let mut max_depth = 0;

    while let Some((nid, depth)) = queue.pop_front() {
        let incoming = connectors.incoming(nid);
        let has_data_incoming = incoming.iter().any(|c| !matches!(c.data_flow, DataFlow::None));
        if !has_data_incoming {
            max_depth = max_depth.max(depth);
        }
        for conn in incoming {
            if matches!(conn.data_flow, DataFlow::None) {
                continue;
            }
            if visited.insert(conn.from.0) {
                queue.push_back((conn.from.0, depth + 1));
            }
        }
    }
    max_depth
}

/// Count reachable nodes upstream (incoming) or downstream (outgoing).
fn count_reachable(node_id: NodeId, connectors: &ConnectorStore, upstream: bool) -> usize {
    let mut visited = HashSet::new();
    let mut queue = VecDeque::new();
    queue.push_back(node_id);
    visited.insert(node_id);

    while let Some(nid) = queue.pop_front() {
        let neighbors = if upstream {
            connectors.incoming(nid)
                .into_iter()
                .filter(|c| !matches!(c.data_flow, DataFlow::None))
                .map(|c| c.from.0)
                .collect::<Vec<_>>()
        } else {
            connectors.outgoing(nid)
                .into_iter()
                .filter(|c| !matches!(c.data_flow, DataFlow::None))
                .map(|c| c.to.0)
                .collect::<Vec<_>>()
        };

        for next in neighbors {
            if visited.insert(next) {
                queue.push_back(next);
            }
        }
    }

    // Subtract 1 to exclude the node itself
    visited.len().saturating_sub(1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use svg_doc::{Node, SvgTag};
    use svg_layout::Connector;

    fn make_test_graph() -> (Document, ConnectorStore, BindingEngine, NodeTypeRegistry) {
        let mut doc = Document::new();
        let root = doc.root;

        // Source node
        let mut src = Node::new(SvgTag::G);
        src.role = NodeRole::Source;
        src.name = Some("Data Source".into());
        src.set_attr(AttrKey::X, svg_doc::AttrValue::F32(0.0));
        src.set_attr(AttrKey::Y, svg_doc::AttrValue::F32(0.0));
        src.set_attr(AttrKey::Width, svg_doc::AttrValue::F32(160.0));
        src.set_attr(AttrKey::Height, svg_doc::AttrValue::F32(80.0));
        src.add_default_ports();
        let src_id = src.id;
        doc.insert_node(root, 1, src);

        // Transform node
        let mut tfm = Node::new(SvgTag::G);
        tfm.role = NodeRole::Transform;
        tfm.name = Some("Filter".into());
        tfm.set_attr(AttrKey::X, svg_doc::AttrValue::F32(0.0));
        tfm.set_attr(AttrKey::Y, svg_doc::AttrValue::F32(150.0));
        tfm.set_attr(AttrKey::Width, svg_doc::AttrValue::F32(160.0));
        tfm.set_attr(AttrKey::Height, svg_doc::AttrValue::F32(80.0));
        tfm.add_default_ports();
        let tfm_id = tfm.id;
        doc.insert_node(root, 2, tfm);

        // View node
        let mut view = Node::new(SvgTag::G);
        view.role = NodeRole::View;
        view.name = Some("Dashboard".into());
        view.set_attr(AttrKey::X, svg_doc::AttrValue::F32(0.0));
        view.set_attr(AttrKey::Y, svg_doc::AttrValue::F32(300.0));
        view.set_attr(AttrKey::Width, svg_doc::AttrValue::F32(160.0));
        view.set_attr(AttrKey::Height, svg_doc::AttrValue::F32(80.0));
        view.add_default_ports();
        let view_id = view.id;
        doc.insert_node(root, 3, view);

        // Connector path nodes
        let path1 = Node::new(SvgTag::Path);
        let p1_id = path1.id;
        doc.insert_node(root, 4, path1);

        let path2 = Node::new(SvgTag::Path);
        let p2_id = path2.id;
        doc.insert_node(root, 5, path2);

        // Connectors
        let mut connectors = ConnectorStore::new();
        connectors.add(Connector {
            path_node: p1_id,
            from: (src_id, "bottom".into()),
            to: (tfm_id, "top".into()),
            routing: svg_layout::ConnectorRouting::Straight,
            label: None,
            data_flow: DataFlow::PassThrough,
        });
        connectors.add(Connector {
            path_node: p2_id,
            from: (tfm_id, "bottom".into()),
            to: (view_id, "top".into()),
            routing: svg_layout::ConnectorRouting::Straight,
            label: None,
            data_flow: DataFlow::Field("filtered".into()),
        });

        let bindings = BindingEngine::new();
        let registry = NodeTypeRegistry::new();

        (doc, connectors, bindings, registry)
    }

    #[test]
    fn manifest_has_correct_counts() {
        let (doc, connectors, bindings, registry) = make_test_graph();
        let manifest = build_manifest(&doc, &connectors, &bindings, &registry);

        assert_eq!(manifest.summary.source_count, 1);
        assert_eq!(manifest.summary.transform_count, 1);
        assert_eq!(manifest.summary.view_count, 1);
        assert_eq!(manifest.summary.edge_count, 2);
        assert_eq!(manifest.summary.data_flow_edge_count, 2);
    }

    #[test]
    fn node_context_has_connections() {
        let (doc, connectors, bindings, registry) = make_test_graph();

        // Find transform node (has both incoming and outgoing)
        let tfm_id = doc.nodes.iter()
            .find(|(_, n)| n.role == NodeRole::Transform)
            .map(|(id, _)| *id)
            .unwrap();

        let ctx = build_node_context(tfm_id, &doc, &connectors, &bindings, &registry).unwrap();
        assert_eq!(ctx.role, NodeRole::Transform);
        assert_eq!(ctx.incoming.len(), 1);
        assert_eq!(ctx.outgoing.len(), 1);
        assert_eq!(ctx.depth, 1); // one hop from source
        assert_eq!(ctx.upstream_count, 1);
        assert_eq!(ctx.downstream_count, 1);
    }

    #[test]
    fn node_context_source_has_zero_depth() {
        let (doc, connectors, bindings, registry) = make_test_graph();

        let src_id = doc.nodes.iter()
            .find(|(_, n)| n.role == NodeRole::Source)
            .map(|(id, _)| *id)
            .unwrap();

        let ctx = build_node_context(src_id, &doc, &connectors, &bindings, &registry).unwrap();
        assert_eq!(ctx.depth, 0);
        assert_eq!(ctx.upstream_count, 0);
        assert_eq!(ctx.downstream_count, 2);
    }

    #[test]
    fn view_node_has_depth_two() {
        let (doc, connectors, bindings, registry) = make_test_graph();

        let view_id = doc.nodes.iter()
            .find(|(_, n)| n.role == NodeRole::View)
            .map(|(id, _)| *id)
            .unwrap();

        let ctx = build_node_context(view_id, &doc, &connectors, &bindings, &registry).unwrap();
        assert_eq!(ctx.depth, 2);
        assert_eq!(ctx.upstream_count, 2);
        assert_eq!(ctx.downstream_count, 0);
    }

    #[test]
    fn manifest_serializes_to_json() {
        let (doc, connectors, bindings, registry) = make_test_graph();
        let manifest = build_manifest(&doc, &connectors, &bindings, &registry);
        let json = serde_json::to_string(&manifest).unwrap();
        assert!(json.contains("Source"));
        assert!(json.contains("Transform"));
        assert!(json.contains("View"));
    }
}
