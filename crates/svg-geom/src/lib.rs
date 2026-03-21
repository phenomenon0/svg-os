//! svg-geom: Bezier math, path data, transforms.
//!
//! Thin wrapper over `kurbo` with SVG-specific parsing and serialization.
//! Bridges to `forge-math` types (Mat3, Vec2) where needed.

mod path;
pub mod transform;
mod stroke;

pub use path::{PathData, SvgArc, PathSeg, path_parse, path_serialize, path_bounds};
pub use transform::{affine_from_mat3, mat3_from_affine, transform_path};
pub use stroke::{StrokeStyle, LineCap, LineJoin, stroke_to_path, path_fit};

// Re-export kurbo types we use extensively
pub use kurbo::{Affine, BezPath, Point, Rect as KurboRect, Shape, Vec2 as KurboVec2};
