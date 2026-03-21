//! SVG attribute keys and values.

use forge_math::{Color, Mat3, Rect};
use svg_geom::PathData;
use serde::{Serialize, Deserialize};

/// Typed SVG attribute keys.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum AttrKey {
    // Geometry
    X,
    Y,
    Width,
    Height,
    Rx,
    Ry,
    Cx,
    Cy,
    R,
    X1,
    Y1,
    X2,
    Y2,
    D,
    Points,
    ViewBox,

    // Transform
    Transform,

    // Presentation
    Fill,
    Stroke,
    StrokeWidth,
    StrokeLinecap,
    StrokeLinejoin,
    StrokeDasharray,
    StrokeDashoffset,
    Opacity,
    FillOpacity,
    StrokeOpacity,
    Display,
    Visibility,

    // Text
    FontFamily,
    FontSize,
    FontWeight,
    FontStyle,
    TextAnchor,
    DominantBaseline,
    TextContent,

    // References
    Href,
    ClipPathRef,
    MaskRef,
    FilterRef,

    // Identity
    Id,
    Class,

    // Gradient / pattern
    GradientUnits,
    GradientTransform,
    SpreadMethod,
    Offset,
    StopColor,
    StopOpacity,
    PatternUnits,
    PatternTransform,

    // Filter primitives
    StdDeviation,
    In,
    In2,
    Result,
    Dx,
    Dy,
    FloodColor,
    FloodOpacity,
    Mode,
    Operator,
    Values,

    // Image
    PreserveAspectRatio,

    // Catch-all for unknown/custom attributes
    Custom(u16),
}

impl AttrKey {
    /// Parse an SVG attribute name to an AttrKey.
    pub fn from_name(name: &str) -> Self {
        match name {
            "x" => Self::X,
            "y" => Self::Y,
            "width" => Self::Width,
            "height" => Self::Height,
            "rx" => Self::Rx,
            "ry" => Self::Ry,
            "cx" => Self::Cx,
            "cy" => Self::Cy,
            "r" => Self::R,
            "x1" => Self::X1,
            "y1" => Self::Y1,
            "x2" => Self::X2,
            "y2" => Self::Y2,
            "d" => Self::D,
            "points" => Self::Points,
            "viewBox" => Self::ViewBox,
            "transform" => Self::Transform,
            "fill" => Self::Fill,
            "stroke" => Self::Stroke,
            "stroke-width" => Self::StrokeWidth,
            "stroke-linecap" => Self::StrokeLinecap,
            "stroke-linejoin" => Self::StrokeLinejoin,
            "stroke-dasharray" => Self::StrokeDasharray,
            "stroke-dashoffset" => Self::StrokeDashoffset,
            "opacity" => Self::Opacity,
            "fill-opacity" => Self::FillOpacity,
            "stroke-opacity" => Self::StrokeOpacity,
            "display" => Self::Display,
            "visibility" => Self::Visibility,
            "font-family" => Self::FontFamily,
            "font-size" => Self::FontSize,
            "font-weight" => Self::FontWeight,
            "font-style" => Self::FontStyle,
            "text-anchor" => Self::TextAnchor,
            "dominant-baseline" => Self::DominantBaseline,
            "href" | "xlink:href" => Self::Href,
            "clip-path" => Self::ClipPathRef,
            "mask" => Self::MaskRef,
            "filter" => Self::FilterRef,
            "id" => Self::Id,
            "class" => Self::Class,
            "gradientUnits" => Self::GradientUnits,
            "gradientTransform" => Self::GradientTransform,
            "spreadMethod" => Self::SpreadMethod,
            "offset" => Self::Offset,
            "stop-color" => Self::StopColor,
            "stop-opacity" => Self::StopOpacity,
            "patternUnits" => Self::PatternUnits,
            "patternTransform" => Self::PatternTransform,
            "stdDeviation" => Self::StdDeviation,
            "in" => Self::In,
            "in2" => Self::In2,
            "result" => Self::Result,
            "dx" => Self::Dx,
            "dy" => Self::Dy,
            "flood-color" => Self::FloodColor,
            "flood-opacity" => Self::FloodOpacity,
            "mode" => Self::Mode,
            "operator" => Self::Operator,
            "values" => Self::Values,
            "preserveAspectRatio" => Self::PreserveAspectRatio,
            "data-text-content" => Self::TextContent,
            _ => Self::Custom(0),
        }
    }

    /// Convert to the SVG attribute name string.
    pub fn as_name(&self) -> &'static str {
        match self {
            Self::X => "x",
            Self::Y => "y",
            Self::Width => "width",
            Self::Height => "height",
            Self::Rx => "rx",
            Self::Ry => "ry",
            Self::Cx => "cx",
            Self::Cy => "cy",
            Self::R => "r",
            Self::X1 => "x1",
            Self::Y1 => "y1",
            Self::X2 => "x2",
            Self::Y2 => "y2",
            Self::D => "d",
            Self::Points => "points",
            Self::ViewBox => "viewBox",
            Self::Transform => "transform",
            Self::Fill => "fill",
            Self::Stroke => "stroke",
            Self::StrokeWidth => "stroke-width",
            Self::StrokeLinecap => "stroke-linecap",
            Self::StrokeLinejoin => "stroke-linejoin",
            Self::StrokeDasharray => "stroke-dasharray",
            Self::StrokeDashoffset => "stroke-dashoffset",
            Self::Opacity => "opacity",
            Self::FillOpacity => "fill-opacity",
            Self::StrokeOpacity => "stroke-opacity",
            Self::Display => "display",
            Self::Visibility => "visibility",
            Self::FontFamily => "font-family",
            Self::FontSize => "font-size",
            Self::FontWeight => "font-weight",
            Self::FontStyle => "font-style",
            Self::TextAnchor => "text-anchor",
            Self::DominantBaseline => "dominant-baseline",
            Self::Href => "href",
            Self::ClipPathRef => "clip-path",
            Self::MaskRef => "mask",
            Self::FilterRef => "filter",
            Self::Id => "id",
            Self::Class => "class",
            Self::GradientUnits => "gradientUnits",
            Self::GradientTransform => "gradientTransform",
            Self::SpreadMethod => "spreadMethod",
            Self::Offset => "offset",
            Self::StopColor => "stop-color",
            Self::StopOpacity => "stop-opacity",
            Self::PatternUnits => "patternUnits",
            Self::PatternTransform => "patternTransform",
            Self::StdDeviation => "stdDeviation",
            Self::In => "in",
            Self::In2 => "in2",
            Self::Result => "result",
            Self::Dx => "dx",
            Self::Dy => "dy",
            Self::FloodColor => "flood-color",
            Self::FloodOpacity => "flood-opacity",
            Self::Mode => "mode",
            Self::Operator => "operator",
            Self::Values => "values",
            Self::PreserveAspectRatio => "preserveAspectRatio",
            Self::Custom(_) => "data-custom",
            Self::TextContent => "data-text-content",
        }
    }
}

/// Length unit for SVG length values.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum LengthUnit {
    Px,
    Em,
    Rem,
    Percent,
    Pt,
    Mm,
    Cm,
    In,
}

/// Typed attribute value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AttrValue {
    /// Numeric value (unitless or px).
    F32(f32),
    /// String value.
    Str(String),
    /// RGBA color.
    Color(Color),
    /// Affine transform (stored as Mat3 for forge compat).
    Transform(Mat3),
    /// Path data.
    Path(PathData),
    /// viewBox rect.
    ViewBox(Rect),
    /// Length with unit.
    Length(f32, LengthUnit),
    /// URL reference (e.g., url(#gradient1)).
    Url(String),
    /// No value / attribute absent.
    None,
}

impl AttrValue {
    /// Serialize this value to an SVG attribute string.
    pub fn to_svg_string(&self) -> String {
        match self {
            Self::F32(v) => format_f32(*v),
            Self::Str(s) => s.clone(),
            Self::Color(c) => color_to_svg(c),
            Self::Transform(m) => {
                let affine = svg_geom::affine_from_mat3(m);
                svg_geom::transform::serialize_svg_transform(&affine)
            }
            Self::Path(p) => p.to_string(),
            Self::ViewBox(r) => format!(
                "{} {} {} {}",
                format_f32(r.origin.x),
                format_f32(r.origin.y),
                format_f32(r.size.x),
                format_f32(r.size.y)
            ),
            Self::Length(v, unit) => {
                let unit_str = match unit {
                    LengthUnit::Px => "px",
                    LengthUnit::Em => "em",
                    LengthUnit::Rem => "rem",
                    LengthUnit::Percent => "%",
                    LengthUnit::Pt => "pt",
                    LengthUnit::Mm => "mm",
                    LengthUnit::Cm => "cm",
                    LengthUnit::In => "in",
                };
                format!("{}{}", format_f32(*v), unit_str)
            }
            Self::Url(id) => format!("url(#{})", id),
            Self::None => String::new(),
        }
    }

    /// Parse from an SVG attribute string, given the attribute key for context.
    pub fn parse(key: &AttrKey, value: &str) -> Self {
        let value = value.trim();
        if value.is_empty() {
            return Self::None;
        }

        match key {
            AttrKey::X | AttrKey::Y | AttrKey::Width | AttrKey::Height
            | AttrKey::Rx | AttrKey::Ry | AttrKey::Cx | AttrKey::Cy | AttrKey::R
            | AttrKey::X1 | AttrKey::Y1 | AttrKey::X2 | AttrKey::Y2
            | AttrKey::StrokeWidth | AttrKey::Opacity | AttrKey::FillOpacity
            | AttrKey::StrokeOpacity | AttrKey::StopOpacity | AttrKey::FloodOpacity
            | AttrKey::StrokeDashoffset | AttrKey::StdDeviation
            | AttrKey::Dx | AttrKey::Dy => {
                parse_length_or_f32(value)
            }

            AttrKey::Offset => {
                if value.ends_with('%') {
                    if let Ok(v) = value.trim_end_matches('%').parse::<f32>() {
                        return Self::Length(v, LengthUnit::Percent);
                    }
                }
                value.parse::<f32>().map(Self::F32).unwrap_or(Self::Str(value.to_string()))
            }

            AttrKey::FontSize => parse_length_or_f32(value),

            AttrKey::D => {
                let path = svg_geom::path_parse(value);
                Self::Path(path)
            }

            AttrKey::ViewBox => {
                let parts: Vec<f32> = value
                    .split(|c: char| c == ',' || c.is_whitespace())
                    .filter(|s| !s.is_empty())
                    .filter_map(|s| s.parse().ok())
                    .collect();
                if parts.len() == 4 {
                    Self::ViewBox(Rect::new(parts[0], parts[1], parts[2], parts[3]))
                } else {
                    Self::Str(value.to_string())
                }
            }

            AttrKey::Transform | AttrKey::GradientTransform | AttrKey::PatternTransform => {
                let affine = svg_geom::transform::parse_svg_transform(value);
                let mat = svg_geom::mat3_from_affine(&affine);
                Self::Transform(mat)
            }

            AttrKey::Fill | AttrKey::Stroke | AttrKey::StopColor | AttrKey::FloodColor => {
                if value.starts_with("url(") {
                    let id = value
                        .trim_start_matches("url(#")
                        .trim_end_matches(')')
                        .to_string();
                    Self::Url(id)
                } else if value == "none" {
                    Self::Str("none".to_string())
                } else {
                    parse_color(value)
                        .map(Self::Color)
                        .unwrap_or(Self::Str(value.to_string()))
                }
            }

            AttrKey::ClipPathRef | AttrKey::MaskRef | AttrKey::FilterRef => {
                if value.starts_with("url(") {
                    let id = value
                        .trim_start_matches("url(#")
                        .trim_end_matches(')')
                        .to_string();
                    Self::Url(id)
                } else {
                    Self::Str(value.to_string())
                }
            }

            _ => Self::Str(value.to_string()),
        }
    }
}

fn format_f32(v: f32) -> String {
    if v == v.floor() && v.abs() < 1e7 {
        format!("{}", v as i32)
    } else {
        let s = format!("{:.4}", v);
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}

fn parse_length_or_f32(value: &str) -> AttrValue {
    // Try plain float first
    if let Ok(v) = value.parse::<f32>() {
        return AttrValue::F32(v);
    }
    // Try with unit suffix
    let units = [
        ("px", LengthUnit::Px),
        ("em", LengthUnit::Em),
        ("rem", LengthUnit::Rem),
        ("%", LengthUnit::Percent),
        ("pt", LengthUnit::Pt),
        ("mm", LengthUnit::Mm),
        ("cm", LengthUnit::Cm),
        ("in", LengthUnit::In),
    ];
    for (suffix, unit) in &units {
        if value.ends_with(suffix) {
            if let Ok(v) = value[..value.len() - suffix.len()].parse::<f32>() {
                return AttrValue::Length(v, *unit);
            }
        }
    }
    AttrValue::Str(value.to_string())
}

/// Parse a CSS/SVG color string.
fn parse_color(s: &str) -> Option<Color> {
    let s = s.trim();
    if s.starts_with('#') {
        let hex = &s[1..];
        match hex.len() {
            3 => {
                let r = u8::from_str_radix(&hex[0..1].repeat(2), 16).ok()?;
                let g = u8::from_str_radix(&hex[1..2].repeat(2), 16).ok()?;
                let b = u8::from_str_radix(&hex[2..3].repeat(2), 16).ok()?;
                Some(Color::from_u8(r, g, b, 255))
            }
            6 => {
                let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
                let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
                let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
                Some(Color::from_u8(r, g, b, 255))
            }
            8 => {
                let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
                let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
                let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
                let a = u8::from_str_radix(&hex[6..8], 16).ok()?;
                Some(Color::from_u8(r, g, b, a))
            }
            _ => None,
        }
    } else if s.starts_with("rgb") {
        // Basic rgb(r, g, b) / rgba(r, g, b, a) parsing
        let inner = s
            .trim_start_matches("rgba(")
            .trim_start_matches("rgb(")
            .trim_end_matches(')');
        let parts: Vec<&str> = inner.split(',').collect();
        if parts.len() >= 3 {
            let r = parts[0].trim().parse::<u8>().ok()?;
            let g = parts[1].trim().parse::<u8>().ok()?;
            let b = parts[2].trim().parse::<u8>().ok()?;
            let a = parts.get(3).and_then(|s| s.trim().parse::<f32>().ok()).unwrap_or(1.0);
            Some(Color::from_u8(r, g, b, (a * 255.0) as u8))
        } else {
            None
        }
    } else {
        // Named colors (subset)
        match s {
            "black" => Some(Color::BLACK),
            "white" => Some(Color::WHITE),
            "red" => Some(Color::RED),
            "green" => Some(Color::GREEN),
            "blue" => Some(Color::BLUE),
            "transparent" => Some(Color::TRANSPARENT),
            _ => None,
        }
    }
}

fn color_to_svg(c: &Color) -> String {
    let bytes = c.to_u8();
    if bytes[3] == 255 {
        format!("#{:02x}{:02x}{:02x}", bytes[0], bytes[1], bytes[2])
    } else {
        format!("rgba({},{},{},{})", bytes[0], bytes[1], bytes[2],
            format_f32(c.a))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_hex_color() {
        let c = parse_color("#ff0000").unwrap();
        assert_eq!(c.to_u8()[0], 255);
        assert_eq!(c.to_u8()[1], 0);
    }

    #[test]
    fn parse_short_hex() {
        let c = parse_color("#f00").unwrap();
        assert_eq!(c.to_u8()[0], 255);
    }

    #[test]
    fn attr_value_round_trip() {
        let val = AttrValue::F32(42.5);
        assert_eq!(val.to_svg_string(), "42.5");
    }

    #[test]
    fn parse_viewbox() {
        let val = AttrValue::parse(&AttrKey::ViewBox, "0 0 800 600");
        match val {
            AttrValue::ViewBox(r) => {
                assert_eq!(r.width(), 800.0);
                assert_eq!(r.height(), 600.0);
            }
            _ => panic!("Expected ViewBox"),
        }
    }
}
