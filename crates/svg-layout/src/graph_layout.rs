//! Sugiyama layered graph layout algorithm.
//!
//! Given a directed graph of nodes + edges, computes positions using
//! the classic 4-phase approach:
//! 1. Cycle removal (DFS, reverse back-edges)
//! 2. Layer assignment (longest path from sources)
//! 3. Crossing minimization (barycenter heuristic, 2 passes)
//! 4. Coordinate assignment (center within layers)
//!
//! Optimized for small diagrams (<50 nodes). No external dependencies.

use svg_doc::NodeId;
use std::collections::{HashMap, HashSet, VecDeque};
use serde::{Serialize, Deserialize};

/// Input graph for the layout algorithm.
pub struct DiagramGraph {
    pub nodes: Vec<NodeId>,
    pub edges: Vec<(NodeId, NodeId)>,
    pub node_sizes: HashMap<NodeId, (f32, f32)>,
}

/// Computed positions for each node.
pub struct LayoutResult {
    pub positions: HashMap<NodeId, (f32, f32)>,
}

/// Layout direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LayoutDirection {
    TopToBottom,
    LeftToRight,
}

/// Configuration for the layered layout.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayeredLayoutConfig {
    pub direction: LayoutDirection,
    pub node_gap: f32,
    pub layer_gap: f32,
    pub margin: (f32, f32),
}

impl Default for LayeredLayoutConfig {
    fn default() -> Self {
        Self {
            direction: LayoutDirection::TopToBottom,
            node_gap: 40.0,
            layer_gap: 80.0,
            margin: (40.0, 40.0),
        }
    }
}

/// Run the Sugiyama layered layout on a directed graph.
pub fn layered_layout(graph: &DiagramGraph, config: &LayeredLayoutConfig) -> LayoutResult {
    if graph.nodes.is_empty() {
        return LayoutResult { positions: HashMap::new() };
    }

    // Build adjacency lists
    let mut adj: HashMap<NodeId, Vec<NodeId>> = HashMap::new();
    let mut in_degree: HashMap<NodeId, usize> = HashMap::new();
    for &n in &graph.nodes {
        adj.entry(n).or_default();
        in_degree.entry(n).or_insert(0);
    }

    // Phase 1: Cycle removal — identify and reverse back-edges
    let forward_edges = remove_cycles(&graph.nodes, &graph.edges);

    for &(from, to) in &forward_edges {
        adj.entry(from).or_default().push(to);
        *in_degree.entry(to).or_insert(0) += 1;
    }

    // Phase 2: Layer assignment — longest path from sources (BFS)
    let layers = assign_layers(&graph.nodes, &forward_edges, &in_degree);

    // Phase 3: Crossing minimization — barycenter heuristic
    let ordered_layers = minimize_crossings(&layers, &forward_edges);

    // Phase 4: Coordinate assignment
    compute_positions(graph, config, &ordered_layers)
}

// ── Phase 1: Cycle Removal ──────────────────────────────────────────────────

/// Remove cycles by reversing back-edges found via DFS.
fn remove_cycles(nodes: &[NodeId], edges: &[(NodeId, NodeId)]) -> Vec<(NodeId, NodeId)> {
    let mut adj: HashMap<NodeId, Vec<NodeId>> = HashMap::new();
    for &n in nodes {
        adj.entry(n).or_default();
    }
    for &(from, to) in edges {
        adj.entry(from).or_default().push(to);
    }

    let mut visited = HashSet::new();
    let mut in_stack = HashSet::new();
    let mut back_edges = HashSet::new();

    for &node in nodes {
        if !visited.contains(&node) {
            dfs_find_back_edges(node, &adj, &mut visited, &mut in_stack, &mut back_edges);
        }
    }

    // Return edges with back-edges reversed
    edges
        .iter()
        .map(|&(from, to)| {
            if back_edges.contains(&(from, to)) {
                (to, from) // reverse
            } else {
                (from, to)
            }
        })
        .collect()
}

fn dfs_find_back_edges(
    node: NodeId,
    adj: &HashMap<NodeId, Vec<NodeId>>,
    visited: &mut HashSet<NodeId>,
    in_stack: &mut HashSet<NodeId>,
    back_edges: &mut HashSet<(NodeId, NodeId)>,
) {
    visited.insert(node);
    in_stack.insert(node);

    if let Some(neighbors) = adj.get(&node) {
        for &next in neighbors {
            if !visited.contains(&next) {
                dfs_find_back_edges(next, adj, visited, in_stack, back_edges);
            } else if in_stack.contains(&next) {
                back_edges.insert((node, next));
            }
        }
    }

    in_stack.remove(&node);
}

// ── Phase 2: Layer Assignment ───────────────────────────────────────────────

/// Assign each node to a layer using longest-path from sources.
fn assign_layers(
    nodes: &[NodeId],
    edges: &[(NodeId, NodeId)],
    in_degree: &HashMap<NodeId, usize>,
) -> Vec<Vec<NodeId>> {
    let mut layer_of: HashMap<NodeId, usize> = HashMap::new();

    // Build reverse adjacency for computing longest path
    let mut rev_adj: HashMap<NodeId, Vec<NodeId>> = HashMap::new();
    for &n in nodes {
        rev_adj.entry(n).or_default();
    }
    for &(from, to) in edges {
        rev_adj.entry(to).or_default().push(from);
    }

    // BFS from sources (in_degree == 0)
    let mut queue: VecDeque<NodeId> = VecDeque::new();
    for &n in nodes {
        if *in_degree.get(&n).unwrap_or(&0) == 0 {
            layer_of.insert(n, 0);
            queue.push_back(n);
        }
    }

    // If no sources (fully cyclic), start from first node
    if queue.is_empty() && !nodes.is_empty() {
        layer_of.insert(nodes[0], 0);
        queue.push_back(nodes[0]);
    }

    // Forward pass: each node's layer = max(predecessor layers) + 1
    let mut adj: HashMap<NodeId, Vec<NodeId>> = HashMap::new();
    for &(from, to) in edges {
        adj.entry(from).or_default().push(to);
    }

    while let Some(node) = queue.pop_front() {
        let node_layer = *layer_of.get(&node).unwrap_or(&0);
        if let Some(neighbors) = adj.get(&node) {
            for &next in neighbors {
                let new_layer = node_layer + 1;
                let current = layer_of.get(&next).copied().unwrap_or(0);
                if new_layer > current || !layer_of.contains_key(&next) {
                    layer_of.insert(next, new_layer);
                    queue.push_back(next);
                }
            }
        }
    }

    // Any unassigned nodes go to layer 0
    for &n in nodes {
        layer_of.entry(n).or_insert(0);
    }

    // Group by layer
    let max_layer = layer_of.values().copied().max().unwrap_or(0);
    let mut layers: Vec<Vec<NodeId>> = vec![Vec::new(); max_layer + 1];
    for &n in nodes {
        let layer = *layer_of.get(&n).unwrap_or(&0);
        layers[layer].push(n);
    }

    layers
}

// ── Phase 3: Crossing Minimization ──────────────────────────────────────────

/// Minimize edge crossings using barycenter heuristic (2 passes: down + up).
fn minimize_crossings(
    layers: &[Vec<NodeId>],
    edges: &[(NodeId, NodeId)],
) -> Vec<Vec<NodeId>> {
    let mut result: Vec<Vec<NodeId>> = layers.to_vec();

    // Build adjacency for barycenter computation
    let mut adj_down: HashMap<NodeId, Vec<NodeId>> = HashMap::new();
    let mut adj_up: HashMap<NodeId, Vec<NodeId>> = HashMap::new();
    for &(from, to) in edges {
        adj_down.entry(from).or_default().push(to);
        adj_up.entry(to).or_default().push(from);
    }

    // Down pass: fix layer i, reorder layer i+1
    for i in 0..result.len().saturating_sub(1) {
        let fixed = &result[i];
        let pos_in_fixed: HashMap<NodeId, usize> = fixed
            .iter()
            .enumerate()
            .map(|(idx, &n)| (n, idx))
            .collect();

        let movable = &mut result[i + 1];
        let mut barycenters: Vec<(NodeId, f64)> = movable
            .iter()
            .map(|&n| {
                let parents = adj_up.get(&n).map(|v| v.as_slice()).unwrap_or(&[]);
                let bc = if parents.is_empty() {
                    0.0
                } else {
                    let sum: f64 = parents
                        .iter()
                        .filter_map(|p| pos_in_fixed.get(p))
                        .map(|&idx| idx as f64)
                        .sum();
                    let count = parents.iter().filter(|p| pos_in_fixed.contains_key(p)).count();
                    if count > 0 { sum / count as f64 } else { 0.0 }
                };
                (n, bc)
            })
            .collect();

        barycenters.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
        *movable = barycenters.into_iter().map(|(n, _)| n).collect();
    }

    // Up pass: fix layer i+1, reorder layer i
    for i in (1..result.len()).rev() {
        let fixed = &result[i];
        let pos_in_fixed: HashMap<NodeId, usize> = fixed
            .iter()
            .enumerate()
            .map(|(idx, &n)| (n, idx))
            .collect();

        let movable = &mut result[i - 1];
        let mut barycenters: Vec<(NodeId, f64)> = movable
            .iter()
            .map(|&n| {
                let children = adj_down.get(&n).map(|v| v.as_slice()).unwrap_or(&[]);
                let bc = if children.is_empty() {
                    0.0
                } else {
                    let sum: f64 = children
                        .iter()
                        .filter_map(|c| pos_in_fixed.get(c))
                        .map(|&idx| idx as f64)
                        .sum();
                    let count = children.iter().filter(|c| pos_in_fixed.contains_key(c)).count();
                    if count > 0 { sum / count as f64 } else { 0.0 }
                };
                (n, bc)
            })
            .collect();

        barycenters.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
        *movable = barycenters.into_iter().map(|(n, _)| n).collect();
    }

    result
}

// ── Phase 4: Coordinate Assignment ──────────────────────────────────────────

fn compute_positions(
    graph: &DiagramGraph,
    config: &LayeredLayoutConfig,
    layers: &[Vec<NodeId>],
) -> LayoutResult {
    let mut positions = HashMap::new();
    let default_size = (160.0f32, 80.0f32);

    match config.direction {
        LayoutDirection::TopToBottom => {
            let mut y = config.margin.1;
            for layer in layers {
                // Compute total width of this layer
                let total_width: f32 = layer
                    .iter()
                    .map(|n| graph.node_sizes.get(n).unwrap_or(&default_size).0)
                    .sum::<f32>()
                    + config.node_gap * (layer.len().saturating_sub(1)) as f32;

                let max_height = layer
                    .iter()
                    .map(|n| graph.node_sizes.get(n).unwrap_or(&default_size).1)
                    .fold(0.0f32, f32::max);

                // Center the layer
                let start_x = config.margin.0 + (0.0f32).max(0.0); // left-aligned from margin
                let mut x = start_x - total_width / 2.0 + 400.0; // center around x=400

                for &node in layer {
                    let (w, _h) = graph.node_sizes.get(&node).copied().unwrap_or(default_size);
                    positions.insert(node, (x, y));
                    x += w + config.node_gap;
                }

                y += max_height + config.layer_gap;
            }
        }
        LayoutDirection::LeftToRight => {
            let mut x = config.margin.0;
            for layer in layers {
                let max_width = layer
                    .iter()
                    .map(|n| graph.node_sizes.get(n).unwrap_or(&default_size).0)
                    .fold(0.0f32, f32::max);

                let total_height: f32 = layer
                    .iter()
                    .map(|n| graph.node_sizes.get(n).unwrap_or(&default_size).1)
                    .sum::<f32>()
                    + config.node_gap * (layer.len().saturating_sub(1)) as f32;

                let mut y = config.margin.1 - total_height / 2.0 + 300.0; // center around y=300

                for &node in layer {
                    let (_w, h) = graph.node_sizes.get(&node).copied().unwrap_or(default_size);
                    positions.insert(node, (x, y));
                    y += h + config.node_gap;
                }

                x += max_width + config.layer_gap;
            }
        }
    }

    LayoutResult { positions }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_ids(count: usize) -> Vec<NodeId> {
        (0..count).map(|_| NodeId::new()).collect()
    }

    #[test]
    fn linear_chain_layout() {
        let ids = make_ids(3);
        let (a, b, c) = (ids[0], ids[1], ids[2]);

        let graph = DiagramGraph {
            nodes: vec![a, b, c],
            edges: vec![(a, b), (b, c)],
            node_sizes: [(a, (160.0, 80.0)), (b, (160.0, 80.0)), (c, (160.0, 80.0))]
                .into_iter().collect(),
        };

        let result = layered_layout(&graph, &LayeredLayoutConfig::default());

        let ay = result.positions[&a].1;
        let by = result.positions[&b].1;
        let cy = result.positions[&c].1;

        assert!(ay < by, "A ({}) should be above B ({})", ay, by);
        assert!(by < cy, "B ({}) should be above C ({})", by, cy);
    }

    #[test]
    fn diamond_layout() {
        let ids = make_ids(4);
        let (a, b, c, d) = (ids[0], ids[1], ids[2], ids[3]);

        let graph = DiagramGraph {
            nodes: vec![a, b, c, d],
            edges: vec![(a, b), (a, c), (b, d), (c, d)],
            node_sizes: [(a, (160.0, 80.0)), (b, (160.0, 80.0)), (c, (160.0, 80.0)), (d, (160.0, 80.0))]
                .into_iter().collect(),
        };

        let result = layered_layout(&graph, &LayeredLayoutConfig::default());

        let ay = result.positions[&a].1;
        let by = result.positions[&b].1;
        let cy = result.positions[&c].1;
        let dy = result.positions[&d].1;

        assert!(ay < by, "A should be above B");
        assert!((by - cy).abs() < 0.1, "B and C should be on same layer");
        assert!(by < dy, "B should be above D");
    }

    #[test]
    fn handles_cycle() {
        let ids = make_ids(3);
        let (a, b, c) = (ids[0], ids[1], ids[2]);

        let graph = DiagramGraph {
            nodes: vec![a, b, c],
            edges: vec![(a, b), (b, c), (c, a)],
            node_sizes: [(a, (160.0, 80.0)), (b, (160.0, 80.0)), (c, (160.0, 80.0))]
                .into_iter().collect(),
        };

        let result = layered_layout(&graph, &LayeredLayoutConfig::default());
        assert_eq!(result.positions.len(), 3);
    }

    #[test]
    fn left_to_right_direction() {
        let ids = make_ids(2);
        let (a, b) = (ids[0], ids[1]);

        let graph = DiagramGraph {
            nodes: vec![a, b],
            edges: vec![(a, b)],
            node_sizes: [(a, (160.0, 80.0)), (b, (160.0, 80.0))]
                .into_iter().collect(),
        };

        let config = LayeredLayoutConfig {
            direction: LayoutDirection::LeftToRight,
            ..Default::default()
        };
        let result = layered_layout(&graph, &config);

        let ax = result.positions[&a].0;
        let bx = result.positions[&b].0;
        assert!(ax < bx, "A ({}) should be left of B ({})", ax, bx);
    }
}
