//! Node: the fundamental unit of the SVG document tree.

use crate::tag::SvgTag;
use crate::attr::{AttrKey, AttrValue};
use serde::{Serialize, Deserialize};
use std::collections::HashMap;
use uuid::Uuid;

/// Unique identifier for a node in the document tree.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct NodeId(pub Uuid);

impl NodeId {
    /// Generate a new random NodeId.
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }

    /// Create from a UUID string. Returns None if invalid.
    pub fn from_str(s: &str) -> Option<Self> {
        Uuid::parse_str(s).ok().map(Self)
    }
}

impl Default for NodeId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for NodeId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Direction hint for connector routing from a port.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PortDirection {
    Up,
    Down,
    Left,
    Right,
}

/// A port (anchor point) on a node for diagram connectors.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Port {
    /// Port identifier (unique within the node).
    pub name: String,
    /// Position as fraction of node bounds (0.0..1.0, 0.0..1.0).
    pub position: (f32, f32),
    /// Direction hint for routing (which way a connector exits).
    pub direction: PortDirection,
}

/// A single node in the SVG document tree.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    /// Unique identifier.
    pub id: NodeId,
    /// SVG element tag.
    pub tag: SvgTag,
    /// Parent node (None for root <svg>).
    pub parent: Option<NodeId>,
    /// Ordered child node IDs.
    pub children: Vec<NodeId>,
    /// Typed attribute map.
    pub attrs: HashMap<AttrKey, AttrValue>,
    /// Optional human-readable name (for layers panel, etc).
    pub name: Option<String>,
    /// Visibility flag.
    pub visible: bool,
    /// Lock flag (prevents editing).
    pub locked: bool,
    /// Diagram ports (anchor points for connectors).
    #[serde(default)]
    pub ports: Vec<Port>,
}

impl Node {
    /// Create a new node with the given tag and default attributes.
    pub fn new(tag: SvgTag) -> Self {
        Self {
            id: NodeId::new(),
            tag,
            parent: None,
            children: Vec::new(),
            attrs: HashMap::new(),
            name: None,
            visible: true,
            locked: false,
            ports: Vec::new(),
        }
    }

    /// Create a new node with a specific ID.
    pub fn with_id(id: NodeId, tag: SvgTag) -> Self {
        Self {
            id,
            tag,
            parent: None,
            children: Vec::new(),
            attrs: HashMap::new(),
            name: None,
            visible: true,
            locked: false,
            ports: Vec::new(),
        }
    }

    /// Add the four cardinal ports (top, right, bottom, left).
    pub fn add_default_ports(&mut self) {
        self.ports = vec![
            Port { name: "top".into(), position: (0.5, 0.0), direction: PortDirection::Up },
            Port { name: "right".into(), position: (1.0, 0.5), direction: PortDirection::Right },
            Port { name: "bottom".into(), position: (0.5, 1.0), direction: PortDirection::Down },
            Port { name: "left".into(), position: (0.0, 0.5), direction: PortDirection::Left },
        ];
    }

    /// Set an attribute.
    pub fn set_attr(&mut self, key: AttrKey, value: AttrValue) {
        self.attrs.insert(key, value);
    }

    /// Get an attribute.
    pub fn get_attr(&self, key: &AttrKey) -> Option<&AttrValue> {
        self.attrs.get(key)
    }

    /// Remove an attribute.
    pub fn remove_attr(&mut self, key: &AttrKey) -> Option<AttrValue> {
        self.attrs.remove(key)
    }

    /// Get a float attribute, defaulting to 0.
    pub fn get_f32(&self, key: &AttrKey) -> f32 {
        match self.attrs.get(key) {
            Some(AttrValue::F32(v)) => *v,
            _ => 0.0,
        }
    }

    /// Get a string attribute.
    pub fn get_string(&self, key: &AttrKey) -> Option<&str> {
        match self.attrs.get(key) {
            Some(AttrValue::Str(s)) => Some(s),
            _ => None,
        }
    }
}
