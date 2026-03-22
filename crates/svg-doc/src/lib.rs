//! svg-doc: The SVG document kernel.
//!
//! Every SVG element is a `Node` in a tree. Nodes have typed tags,
//! typed attributes, UUID identity, parent/children relationships.
//! All mutations flow through `SvgCommand` for undo/redo.

mod node;
mod tag;
mod attr;
mod document;
mod command;
mod serialize;
mod parse;

pub use node::{Node, NodeId, Port, PortDirection};
pub use tag::SvgTag;
pub use attr::{AttrKey, AttrValue, LengthUnit};
pub use document::Document;
pub use command::SvgCommand;
pub use serialize::doc_to_svg_string;
pub use parse::doc_from_svg_string;
