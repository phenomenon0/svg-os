//! SVG element tags.

use serde::{Serialize, Deserialize};

/// All SVG element types we support.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SvgTag {
    // Structure
    Svg,
    G,
    Defs,
    Symbol,
    Use,

    // Shapes
    Rect,
    Circle,
    Ellipse,
    Line,
    Polyline,
    Polygon,
    Path,

    // Text
    Text,
    TSpan,
    TextPath,

    // Media
    Image,
    ForeignObject,

    // Paint servers
    LinearGradient,
    RadialGradient,
    Stop,
    Pattern,

    // Clipping / masking
    ClipPath,
    Mask,

    // Filters
    Filter,
    FeGaussianBlur,
    FeColorMatrix,
    FeComposite,
    FeFlood,
    FeMerge,
    FeMergeNode,
    FeOffset,
    FeBlend,

    // Catch-all for extensions
    Unknown(u16),
}

impl SvgTag {
    /// Convert an SVG tag name string to an SvgTag.
    pub fn from_name(name: &str) -> Self {
        match name {
            "svg" => Self::Svg,
            "g" => Self::G,
            "defs" => Self::Defs,
            "symbol" => Self::Symbol,
            "use" => Self::Use,
            "rect" => Self::Rect,
            "circle" => Self::Circle,
            "ellipse" => Self::Ellipse,
            "line" => Self::Line,
            "polyline" => Self::Polyline,
            "polygon" => Self::Polygon,
            "path" => Self::Path,
            "text" => Self::Text,
            "tspan" => Self::TSpan,
            "textPath" => Self::TextPath,
            "image" => Self::Image,
            "foreignObject" => Self::ForeignObject,
            "linearGradient" => Self::LinearGradient,
            "radialGradient" => Self::RadialGradient,
            "stop" => Self::Stop,
            "pattern" => Self::Pattern,
            "clipPath" => Self::ClipPath,
            "mask" => Self::Mask,
            "filter" => Self::Filter,
            "feGaussianBlur" => Self::FeGaussianBlur,
            "feColorMatrix" => Self::FeColorMatrix,
            "feComposite" => Self::FeComposite,
            "feFlood" => Self::FeFlood,
            "feMerge" => Self::FeMerge,
            "feMergeNode" => Self::FeMergeNode,
            "feOffset" => Self::FeOffset,
            "feBlend" => Self::FeBlend,
            _ => Self::Unknown(0),
        }
    }

    /// Convert to the SVG tag name string.
    pub fn as_name(&self) -> &'static str {
        match self {
            Self::Svg => "svg",
            Self::G => "g",
            Self::Defs => "defs",
            Self::Symbol => "symbol",
            Self::Use => "use",
            Self::Rect => "rect",
            Self::Circle => "circle",
            Self::Ellipse => "ellipse",
            Self::Line => "line",
            Self::Polyline => "polyline",
            Self::Polygon => "polygon",
            Self::Path => "path",
            Self::Text => "text",
            Self::TSpan => "tspan",
            Self::TextPath => "textPath",
            Self::Image => "image",
            Self::ForeignObject => "foreignObject",
            Self::LinearGradient => "linearGradient",
            Self::RadialGradient => "radialGradient",
            Self::Stop => "stop",
            Self::Pattern => "pattern",
            Self::ClipPath => "clipPath",
            Self::Mask => "mask",
            Self::Filter => "filter",
            Self::FeGaussianBlur => "feGaussianBlur",
            Self::FeColorMatrix => "feColorMatrix",
            Self::FeComposite => "feComposite",
            Self::FeFlood => "feFlood",
            Self::FeMerge => "feMerge",
            Self::FeMergeNode => "feMergeNode",
            Self::FeOffset => "feOffset",
            Self::FeBlend => "feBlend",
            Self::Unknown(_) => "unknown",
        }
    }

    /// Whether this tag belongs inside <defs>.
    pub fn is_def_element(&self) -> bool {
        matches!(
            self,
            Self::LinearGradient
                | Self::RadialGradient
                | Self::Pattern
                | Self::ClipPath
                | Self::Mask
                | Self::Filter
                | Self::Symbol
        )
    }

    /// Whether this tag is a shape element.
    pub fn is_shape(&self) -> bool {
        matches!(
            self,
            Self::Rect
                | Self::Circle
                | Self::Ellipse
                | Self::Line
                | Self::Polyline
                | Self::Polygon
                | Self::Path
        )
    }
}
