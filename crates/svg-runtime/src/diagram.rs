//! Data-driven diagram generation.
//!
//! Given a JSON graph spec ({ nodes, edges }), generates SVG diagram nodes
//! with ports, connectors with paths, and runs Sugiyama layout — all in one call.
//! Returns a mapping from data IDs to NodeIds for subsequent data binding.

use svg_doc::{Document, Node, NodeId, SvgTag, AttrKey, AttrValue};
use svg_layout::{ConnectorStore, Connector, ConnectorRouting,
    DiagramGraph, LayeredLayoutConfig, LayoutDirection, layered_layout};
use std::collections::HashMap;

/// Result of diagram generation.
pub struct DiagramResult {
    /// Maps input data node ID → generated SVG NodeId.
    pub node_map: HashMap<String, NodeId>,
    /// Number of connectors created.
    pub connector_count: usize,
}

/// Generate a diagram from a JSON graph spec.
///
/// The JSON should have the shape:
/// ```json
/// {
///   "nodes": [{ "id": "a", "label": "API Gateway", "type": "service" }, ...],
///   "edges": [{ "from": "a", "to": "b", "label": "HTTP" }, ...]
/// }
/// ```
pub fn generate_diagram(
    doc: &mut Document,
    connectors: &mut ConnectorStore,
    graph_json: &serde_json::Value,
    config: &LayeredLayoutConfig,
) -> Result<DiagramResult, String> {
    let root = doc.root;

    // Parse nodes
    let json_nodes = graph_json.get("nodes")
        .and_then(|v| v.as_array())
        .ok_or("Missing 'nodes' array")?;

    let json_edges = graph_json.get("edges")
        .and_then(|v| v.as_array())
        .unwrap_or(&Vec::new())
        .clone();

    // Default node styling
    let node_width = 160.0f32;
    let node_height = 80.0f32;
    let node_rx = 8.0f32;

    // Style presets by node type
    let style_for_type = |t: &str| -> (&str, &str) {
        match t {
            "database" | "db" => ("#164e63", "#06b6d4"),
            "service" | "api" => ("#1e293b", "#475569"),
            "queue" | "mq" => ("#3b0764", "#a855f7"),
            "cache" => ("#713f12", "#f59e0b"),
            "client" | "user" => ("#052e16", "#22c55e"),
            "external" => ("#450a0a", "#ef4444"),
            _ => ("#1e293b", "#475569"),
        }
    };

    let mut node_map: HashMap<String, NodeId> = HashMap::new();
    let mut node_sizes: HashMap<NodeId, (f32, f32)> = HashMap::new();

    // Create diagram nodes
    for json_node in json_nodes {
        let data_id = json_node.get("id")
            .and_then(|v| v.as_str())
            .ok_or("Node missing 'id'")?
            .to_string();
        let label = json_node.get("label")
            .and_then(|v| v.as_str())
            .unwrap_or(&data_id);
        let node_type = json_node.get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("default");

        let (fill, stroke) = style_for_type(node_type);

        // Create group node with rect + text
        let mut group = Node::new(SvgTag::G);
        group.set_attr(AttrKey::X, AttrValue::F32(0.0));
        group.set_attr(AttrKey::Y, AttrValue::F32(0.0));
        group.set_attr(AttrKey::Width, AttrValue::F32(node_width));
        group.set_attr(AttrKey::Height, AttrValue::F32(node_height));
        group.add_default_ports();
        let group_id = group.id;
        let idx = doc.children(root).len();
        doc.insert_node(root, idx, group);

        // Background rect
        let mut rect = Node::new(SvgTag::Rect);
        rect.set_attr(AttrKey::X, AttrValue::F32(0.0));
        rect.set_attr(AttrKey::Y, AttrValue::F32(0.0));
        rect.set_attr(AttrKey::Width, AttrValue::F32(node_width));
        rect.set_attr(AttrKey::Height, AttrValue::F32(node_height));
        rect.set_attr(AttrKey::Rx, AttrValue::F32(node_rx));
        rect.set_attr(AttrKey::Fill, AttrValue::parse(&AttrKey::Fill, fill));
        rect.set_attr(AttrKey::Stroke, AttrValue::parse(&AttrKey::Stroke, stroke));
        rect.set_attr(AttrKey::StrokeWidth, AttrValue::F32(2.0));
        let rect_idx = doc.children(group_id).len();
        doc.insert_node(group_id, rect_idx, rect);

        // Label text
        let mut text = Node::new(SvgTag::Text);
        text.set_attr(AttrKey::X, AttrValue::F32(node_width / 2.0));
        text.set_attr(AttrKey::Y, AttrValue::F32(node_height / 2.0 + 5.0));
        text.set_attr(AttrKey::TextAnchor, AttrValue::Str("middle".into()));
        text.set_attr(AttrKey::FontFamily, AttrValue::Str("Inter, system-ui, sans-serif".into()));
        text.set_attr(AttrKey::FontSize, AttrValue::F32(14.0));
        text.set_attr(AttrKey::Fill, AttrValue::parse(&AttrKey::Fill, "#e2e8f0"));
        text.set_attr(AttrKey::TextContent, AttrValue::Str(label.into()));
        let text_idx = doc.children(group_id).len();
        doc.insert_node(group_id, text_idx, text);

        // Type badge (small text above label)
        if node_type != "default" {
            let mut badge = Node::new(SvgTag::Text);
            badge.set_attr(AttrKey::X, AttrValue::F32(node_width / 2.0));
            badge.set_attr(AttrKey::Y, AttrValue::F32(20.0));
            badge.set_attr(AttrKey::TextAnchor, AttrValue::Str("middle".into()));
            badge.set_attr(AttrKey::FontFamily, AttrValue::Str("Inter, system-ui, sans-serif".into()));
            badge.set_attr(AttrKey::FontSize, AttrValue::F32(9.0));
            badge.set_attr(AttrKey::Fill, AttrValue::parse(&AttrKey::Fill, stroke));
            badge.set_attr(AttrKey::TextContent, AttrValue::Str(node_type.to_uppercase()));
            let badge_idx = doc.children(group_id).len();
            doc.insert_node(group_id, badge_idx, badge);
        }

        node_map.insert(data_id, group_id);
        node_sizes.insert(group_id, (node_width, node_height));
    }

    // Create connectors
    let mut connector_count = 0;
    for json_edge in &json_edges {
        let from_id = json_edge.get("from").and_then(|v| v.as_str()).unwrap_or("");
        let to_id = json_edge.get("to").and_then(|v| v.as_str()).unwrap_or("");

        let from_node = match node_map.get(from_id) {
            Some(&id) => id,
            None => continue,
        };
        let to_node = match node_map.get(to_id) {
            Some(&id) => id,
            None => continue,
        };

        // Default ports based on layout direction
        let (from_port, to_port) = match config.direction {
            LayoutDirection::TopToBottom => ("bottom", "top"),
            LayoutDirection::LeftToRight => ("right", "left"),
        };

        let from_port = json_edge.get("fromPort")
            .and_then(|v| v.as_str())
            .unwrap_or(from_port);
        let to_port = json_edge.get("toPort")
            .and_then(|v| v.as_str())
            .unwrap_or(to_port);

        // Create path node
        let mut path = Node::new(SvgTag::Path);
        path.set_attr(AttrKey::Stroke, AttrValue::parse(&AttrKey::Stroke, "#64748b"));
        path.set_attr(AttrKey::Fill, AttrValue::parse(&AttrKey::Fill, "none"));
        path.set_attr(AttrKey::StrokeWidth, AttrValue::F32(2.0));
        let path_id = path.id;
        let path_idx = doc.children(root).len();
        doc.insert_node(root, path_idx, path);

        connectors.add(Connector {
            path_node: path_id,
            from: (from_node, from_port.into()),
            to: (to_node, to_port.into()),
            routing: ConnectorRouting::Orthogonal,
            label: None,
            data_flow: svg_layout::DataFlow::None,
        });

        connector_count += 1;
    }

    // Run layout
    let edges: Vec<(NodeId, NodeId)> = connectors.connectors()
        .iter()
        .filter(|c| node_sizes.contains_key(&c.from.0) && node_sizes.contains_key(&c.to.0))
        .map(|c| (c.from.0, c.to.0))
        .collect();

    let graph = DiagramGraph {
        nodes: node_map.values().copied().collect(),
        edges,
        node_sizes,
    };

    let result = layered_layout(&graph, config);

    // Apply positions
    for (node_id, (x, y)) in &result.positions {
        doc.set_attr(*node_id, AttrKey::X, AttrValue::F32(*x));
        doc.set_attr(*node_id, AttrKey::Y, AttrValue::F32(*y));
    }

    // Update connector paths
    connectors.update_paths(doc);

    Ok(DiagramResult { node_map, connector_count })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_simple_diagram() {
        let mut doc = Document::new();
        let mut connectors = ConnectorStore::new();
        let config = LayeredLayoutConfig::default();

        let json: serde_json::Value = serde_json::json!({
            "nodes": [
                { "id": "api", "label": "API Gateway", "type": "service" },
                { "id": "db", "label": "PostgreSQL", "type": "database" },
                { "id": "cache", "label": "Redis", "type": "cache" }
            ],
            "edges": [
                { "from": "api", "to": "db" },
                { "from": "api", "to": "cache" }
            ]
        });

        let result = generate_diagram(&mut doc, &mut connectors, &json, &config).unwrap();

        assert_eq!(result.node_map.len(), 3);
        assert_eq!(result.connector_count, 2);

        // API should be above DB and cache (TopToBottom layout)
        let api_y = doc.get(result.node_map["api"]).unwrap().get_f32(&AttrKey::Y);
        let db_y = doc.get(result.node_map["db"]).unwrap().get_f32(&AttrKey::Y);
        let cache_y = doc.get(result.node_map["cache"]).unwrap().get_f32(&AttrKey::Y);

        assert!(api_y < db_y, "API ({}) should be above DB ({})", api_y, db_y);
        assert!(api_y < cache_y, "API ({}) should be above Cache ({})", api_y, cache_y);
        assert!((db_y - cache_y).abs() < 0.1, "DB and Cache should be on same layer");
    }

    #[test]
    fn generate_with_missing_edge_target() {
        let mut doc = Document::new();
        let mut connectors = ConnectorStore::new();
        let config = LayeredLayoutConfig::default();

        let json = serde_json::json!({
            "nodes": [{ "id": "a", "label": "A" }],
            "edges": [{ "from": "a", "to": "nonexistent" }]
        });

        let result = generate_diagram(&mut doc, &mut connectors, &json, &config).unwrap();
        assert_eq!(result.node_map.len(), 1);
        assert_eq!(result.connector_count, 0); // edge skipped
    }
}
