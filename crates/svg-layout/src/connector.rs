//! Connector store — manages diagram connectors (edges between ports).
//!
//! A connector is a logical link between two ports on two nodes.
//! It owns a `<path>` node whose `d` attribute is recomputed whenever
//! either endpoint moves. The path is a regular document node — the diff
//! engine, undo/redo, and export handle it with zero special-casing.

use svg_doc::{Document, NodeId, AttrKey, AttrValue, PortDirection};
use serde::{Serialize, Deserialize};

/// Routing style for a connector.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConnectorRouting {
    Straight,
    Orthogonal,
}

/// How data flows through a connector.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DataFlow {
    /// No data flows (visual-only, backward compat default).
    None,
    /// Pass the source node's entire bound data to the target.
    PassThrough,
    /// Pass a subset of the source node's data (dot-separated field path).
    Field(String),
    /// Evaluate an expression against source data, pass result.
    Expression(String),
}

impl Default for DataFlow {
    fn default() -> Self { Self::None }
}

/// A connector between two ports on two nodes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Connector {
    /// ID of the `<path>` node that renders this connector.
    pub path_node: NodeId,
    /// Source: (node_id, port_name).
    pub from: (NodeId, String),
    /// Target: (node_id, port_name).
    pub to: (NodeId, String),
    /// Routing style.
    pub routing: ConnectorRouting,
    /// Optional label text node.
    pub label: Option<NodeId>,
    /// How data flows from source to target.
    #[serde(default)]
    pub data_flow: DataFlow,
}

/// Manages all connectors and updates their paths.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ConnectorStore {
    connectors: Vec<Connector>,
}

impl ConnectorStore {
    pub fn new() -> Self {
        Self { connectors: Vec::new() }
    }

    pub fn add(&mut self, connector: Connector) {
        self.connectors.push(connector);
    }

    /// Remove all connectors that reference the given node (as source or target).
    pub fn remove_for_node(&mut self, node: NodeId) -> Vec<NodeId> {
        let mut removed_paths = Vec::new();
        self.connectors.retain(|c| {
            if c.from.0 == node || c.to.0 == node {
                removed_paths.push(c.path_node);
                false
            } else {
                true
            }
        });
        removed_paths
    }

    /// Remove a connector by its path node ID.
    pub fn remove_by_path(&mut self, path_node: NodeId) -> bool {
        let len = self.connectors.len();
        self.connectors.retain(|c| c.path_node != path_node);
        self.connectors.len() < len
    }

    pub fn connectors(&self) -> &[Connector] {
        &self.connectors
    }

    pub fn len(&self) -> usize {
        self.connectors.len()
    }

    pub fn is_empty(&self) -> bool {
        self.connectors.is_empty()
    }

    /// Find all connectors flowing INTO a node.
    pub fn incoming(&self, node_id: NodeId) -> Vec<&Connector> {
        self.connectors.iter().filter(|c| c.to.0 == node_id).collect()
    }

    /// Find all connectors flowing FROM a node.
    pub fn outgoing(&self, node_id: NodeId) -> Vec<&Connector> {
        self.connectors.iter().filter(|c| c.from.0 == node_id).collect()
    }

    /// Topological order of nodes based on connector graph (Kahn's algorithm).
    /// Upstream nodes (no incoming data-flow connectors) come first.
    /// Nodes not in the graph are appended at the end.
    pub fn topological_order(&self, all_nodes: &[NodeId]) -> Vec<NodeId> {
        use std::collections::{HashMap, HashSet, VecDeque};

        // Build adjacency and in-degree from data-flow connectors only
        let mut in_degree: HashMap<NodeId, usize> = HashMap::new();
        let mut adj: HashMap<NodeId, Vec<NodeId>> = HashMap::new();

        for nid in all_nodes {
            in_degree.entry(*nid).or_insert(0);
            adj.entry(*nid).or_default();
        }

        for conn in &self.connectors {
            if matches!(conn.data_flow, DataFlow::None) {
                continue;
            }
            *in_degree.entry(conn.to.0).or_insert(0) += 1;
            adj.entry(conn.from.0).or_default().push(conn.to.0);
        }

        // Kahn's algorithm
        let mut queue: VecDeque<NodeId> = in_degree.iter()
            .filter(|(_, deg)| **deg == 0)
            .map(|(id, _)| *id)
            .collect();

        let mut result = Vec::with_capacity(all_nodes.len());
        let mut in_result: HashSet<NodeId> = HashSet::with_capacity(all_nodes.len());
        while let Some(node) = queue.pop_front() {
            result.push(node);
            in_result.insert(node);
            if let Some(neighbors) = adj.get(&node) {
                for next in neighbors {
                    if let Some(deg) = in_degree.get_mut(next) {
                        *deg = deg.saturating_sub(1);
                        if *deg == 0 {
                            queue.push_back(*next);
                        }
                    }
                }
            }
        }

        // Append any nodes not reached (cycles or disconnected)
        for nid in all_nodes {
            if !in_result.contains(nid) {
                result.push(*nid);
            }
        }

        result
    }

    /// Recompute all connector paths based on current node positions/ports.
    pub fn update_paths(&self, doc: &mut Document) {
        for conn in &self.connectors {
            let from_result = self.resolve_port(doc, conn.from.0, &conn.from.1);
            let to_result = self.resolve_port(doc, conn.to.0, &conn.to.1);

            if let (Some((fp, from_dir)), Some((tp, to_dir))) = (from_result, to_result) {
                let d = match conn.routing {
                    ConnectorRouting::Straight => {
                        format!("M{:.1},{:.1} L{:.1},{:.1}", fp.0, fp.1, tp.0, tp.1)
                    }
                    ConnectorRouting::Orthogonal => {
                        // Orthogonal routing with clean bends
                        let waypoints = orthogonal_route(fp, from_dir, tp, to_dir, 20.0);
                        waypoints_to_path(&waypoints)
                    }
                };
                doc.set_attr(conn.path_node, AttrKey::D, AttrValue::parse(&AttrKey::D, &d));
            }
        }
    }

    /// Resolve a port name to absolute (x, y) coordinates and direction.
    fn resolve_port(
        &self,
        doc: &Document,
        node_id: NodeId,
        port_name: &str,
    ) -> Option<((f32, f32), PortDirection)> {
        let node = doc.get(node_id)?;
        let port = node.ports.iter().find(|p| p.name == port_name)?;

        // Get node bounds — works for rect, ellipse (cx/cy/rx/ry), groups
        let (x, y, w, h) = get_node_bounds(node);

        Some((
            (x + port.position.0 * w, y + port.position.1 * h),
            port.direction,
        ))
    }
}

/// Get the bounding box of a node from its attributes.
fn get_node_bounds(node: &svg_doc::Node) -> (f32, f32, f32, f32) {
    let x = node.get_f32(&AttrKey::X);
    let y = node.get_f32(&AttrKey::Y);
    let w = node.get_f32(&AttrKey::Width);
    let h = node.get_f32(&AttrKey::Height);

    if w > 0.0 || h > 0.0 {
        return (x, y, w, h);
    }

    // Fallback for circle/ellipse
    let cx = node.get_f32(&AttrKey::Cx);
    let cy = node.get_f32(&AttrKey::Cy);
    let rx = node.get_f32(&AttrKey::Rx);
    let ry = node.get_f32(&AttrKey::Ry);
    let r = node.get_f32(&AttrKey::R);

    if r > 0.0 {
        (cx - r, cy - r, r * 2.0, r * 2.0)
    } else if rx > 0.0 || ry > 0.0 {
        (cx - rx, cy - ry, rx * 2.0, ry * 2.0)
    } else {
        (x, y, 0.0, 0.0)
    }
}

/// Simple orthogonal routing with clean bends (no obstacle avoidance).
fn orthogonal_route(
    from: (f32, f32),
    from_dir: PortDirection,
    to: (f32, f32),
    to_dir: PortDirection,
    margin: f32,
) -> Vec<(f32, f32)> {
    let exit = exit_point(from, from_dir, margin);
    let enter = exit_point(to, to_dir, margin);

    let mut points = vec![from, exit];

    // Determine midpoint routing based on directions
    match (from_dir, to_dir) {
        // Vertical flow (top→bottom or bottom→top)
        (PortDirection::Down, PortDirection::Up)
        | (PortDirection::Up, PortDirection::Down) => {
            let mid_y = (exit.1 + enter.1) / 2.0;
            points.push((exit.0, mid_y));
            points.push((enter.0, mid_y));
        }
        // Horizontal flow (left→right or right→left)
        (PortDirection::Right, PortDirection::Left)
        | (PortDirection::Left, PortDirection::Right) => {
            let mid_x = (exit.0 + enter.0) / 2.0;
            points.push((mid_x, exit.1));
            points.push((mid_x, enter.1));
        }
        // Same direction — need S-curve
        _ => {
            // Use a simple L-bend via the midpoint
            if is_vertical(from_dir) {
                points.push((exit.0, enter.1));
            } else {
                points.push((enter.0, exit.1));
            }
        }
    }

    points.push(enter);
    points.push(to);
    points
}

fn exit_point(pos: (f32, f32), dir: PortDirection, margin: f32) -> (f32, f32) {
    match dir {
        PortDirection::Up => (pos.0, pos.1 - margin),
        PortDirection::Down => (pos.0, pos.1 + margin),
        PortDirection::Left => (pos.0 - margin, pos.1),
        PortDirection::Right => (pos.0 + margin, pos.1),
    }
}

fn is_vertical(dir: PortDirection) -> bool {
    matches!(dir, PortDirection::Up | PortDirection::Down)
}

fn waypoints_to_path(points: &[(f32, f32)]) -> String {
    if points.is_empty() {
        return String::new();
    }
    let mut d = format!("M{:.1},{:.1}", points[0].0, points[0].1);
    for p in &points[1..] {
        d.push_str(&format!(" L{:.1},{:.1}", p.0, p.1));
    }
    d
}

#[cfg(test)]
mod tests {
    use super::*;
    use svg_doc::{Node, SvgTag};

    #[test]
    fn resolve_port_position() {
        let mut doc = Document::new();
        let root = doc.root;

        let mut rect = Node::new(SvgTag::Rect);
        rect.set_attr(AttrKey::X, AttrValue::F32(100.0));
        rect.set_attr(AttrKey::Y, AttrValue::F32(200.0));
        rect.set_attr(AttrKey::Width, AttrValue::F32(160.0));
        rect.set_attr(AttrKey::Height, AttrValue::F32(80.0));
        rect.add_default_ports();
        let rect_id = rect.id;
        doc.insert_node(root, 1, rect);

        let store = ConnectorStore::new();

        // Bottom port should be at center-bottom: (100+80, 200+80) = (180, 280)
        let result = store.resolve_port(&doc, rect_id, "bottom");
        assert!(result.is_some());
        let ((x, y), dir) = result.unwrap();
        assert!((x - 180.0).abs() < 0.1, "x={}", x);
        assert!((y - 280.0).abs() < 0.1, "y={}", y);
        assert_eq!(dir, PortDirection::Down);

        // Right port: (100+160, 200+40) = (260, 240)
        let ((x, y), _) = store.resolve_port(&doc, rect_id, "right").unwrap();
        assert!((x - 260.0).abs() < 0.1, "x={}", x);
        assert!((y - 240.0).abs() < 0.1, "y={}", y);
    }

    #[test]
    fn straight_connector_path() {
        let mut doc = Document::new();
        let root = doc.root;

        // Node A at (0, 0) 100x50
        let mut a = Node::new(SvgTag::Rect);
        a.set_attr(AttrKey::X, AttrValue::F32(0.0));
        a.set_attr(AttrKey::Y, AttrValue::F32(0.0));
        a.set_attr(AttrKey::Width, AttrValue::F32(100.0));
        a.set_attr(AttrKey::Height, AttrValue::F32(50.0));
        a.add_default_ports();
        let a_id = a.id;
        doc.insert_node(root, 1, a);

        // Node B at (0, 150) 100x50
        let mut b = Node::new(SvgTag::Rect);
        b.set_attr(AttrKey::X, AttrValue::F32(0.0));
        b.set_attr(AttrKey::Y, AttrValue::F32(150.0));
        b.set_attr(AttrKey::Width, AttrValue::F32(100.0));
        b.set_attr(AttrKey::Height, AttrValue::F32(50.0));
        b.add_default_ports();
        let b_id = b.id;
        doc.insert_node(root, 2, b);

        // Create path node
        let path = Node::new(SvgTag::Path);
        let path_id = path.id;
        doc.insert_node(root, 3, path);

        let mut store = ConnectorStore::new();
        store.add(Connector {
            path_node: path_id,
            from: (a_id, "bottom".into()),
            to: (b_id, "top".into()),
            routing: ConnectorRouting::Straight,
            label: None,
            data_flow: DataFlow::None,
        });

        store.update_paths(&mut doc);

        // Path should go from A's bottom (50, 50) to B's top (50, 150)
        let path_node = doc.get(path_id).unwrap();
        let d_attr = path_node.get_attr(&AttrKey::D);
        assert!(d_attr.is_some(), "Path should have d attribute");
        let d_str = d_attr.unwrap().to_svg_string();
        assert!(d_str.contains("M50"), "d should start near M50, got: {}", d_str);
        assert!(d_str.contains("50") && d_str.contains("150"), "d={}", d_str);
    }

    #[test]
    fn remove_connectors_for_node() {
        let mut store = ConnectorStore::new();
        let a = NodeId::new();
        let b = NodeId::new();
        let c = NodeId::new();
        let p1 = NodeId::new();
        let p2 = NodeId::new();

        store.add(Connector {
            path_node: p1,
            from: (a, "bottom".into()),
            to: (b, "top".into()),
            routing: ConnectorRouting::Straight,
            label: None,
            data_flow: DataFlow::None,
        });
        store.add(Connector {
            path_node: p2,
            from: (b, "bottom".into()),
            to: (c, "top".into()),
            routing: ConnectorRouting::Straight,
            label: None,
            data_flow: DataFlow::None,
        });

        assert_eq!(store.len(), 2);
        let removed = store.remove_for_node(b);
        assert_eq!(removed.len(), 2); // both reference b
        assert_eq!(store.len(), 0);
    }
}
