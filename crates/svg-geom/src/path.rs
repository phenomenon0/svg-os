//! SVG path data: parsing `d` attributes, serialization, bounding boxes.

use kurbo::{Arc as KurboArc, BezPath, PathEl, Point, Shape, SvgArc as KurboSvgArc};
use serde::{Serialize, Deserialize};
use std::fmt;

/// Wraps `kurbo::BezPath` with SVG-specific convenience methods.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathData {
    /// The raw path segments stored as SVG `d` string for serde round-tripping.
    /// The BezPath is the canonical in-memory representation.
    #[serde(skip)]
    bez: BezPath,
    /// Cached SVG `d` string — updated lazily.
    d: String,
}

impl PathData {
    /// Create from a kurbo BezPath.
    pub fn from_bez(bez: BezPath) -> Self {
        let d = serialize_bezpath(&bez);
        Self { bez, d }
    }

    /// Create an empty path.
    pub fn empty() -> Self {
        Self {
            bez: BezPath::new(),
            d: String::new(),
        }
    }

    /// Access the underlying kurbo BezPath.
    pub fn bez(&self) -> &BezPath {
        &self.bez
    }

    /// Consume and return the inner BezPath.
    pub fn into_bez(self) -> BezPath {
        self.bez
    }

    /// Get the cached `d` attribute string.
    pub fn as_d(&self) -> &str {
        &self.d
    }

    /// Number of path elements.
    pub fn element_count(&self) -> usize {
        self.bez.elements().len()
    }

    /// Whether the path is empty.
    pub fn is_empty(&self) -> bool {
        self.bez.elements().is_empty()
    }
}

impl PartialEq for PathData {
    fn eq(&self, other: &Self) -> bool {
        self.d == other.d
    }
}

impl fmt::Display for PathData {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.d)
    }
}

/// SVG arc parameters (endpoint parameterization).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct SvgArc {
    pub from: (f64, f64),
    pub to: (f64, f64),
    pub radii: (f64, f64),
    pub x_rotation: f64,
    pub large_arc: bool,
    pub sweep: bool,
}

impl SvgArc {
    /// Convert to kurbo arc segments appended to a BezPath.
    pub fn to_bez_path(&self, path: &mut BezPath) {
        let arc = KurboSvgArc {
            from: Point::new(self.from.0, self.from.1),
            to: Point::new(self.to.0, self.to.1),
            radii: kurbo::Vec2::new(self.radii.0, self.radii.1),
            x_rotation: self.x_rotation,
            large_arc: self.large_arc,
            sweep: self.sweep,
        };
        // Convert SVG arc to cubic bezier segments
        if let Some(arc) = KurboArc::from_svg_arc(&arc) {
            arc.to_cubic_beziers(0.1, |p1, p2, p| {
                path.curve_to(p1, p2, p);
            });
        } else {
            // Degenerate arc — treat as line
            path.line_to(Point::new(self.to.0, self.to.1));
        }
    }
}

/// Individual path segment for higher-level manipulation.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum PathSeg {
    MoveTo(f64, f64),
    LineTo(f64, f64),
    QuadTo(f64, f64, f64, f64),
    CubicTo(f64, f64, f64, f64, f64, f64),
    Close,
}

/// Parse an SVG `d` attribute string into a PathData.
///
/// Supports the full SVG path command set: M/m, L/l, H/h, V/v,
/// C/c, S/s, Q/q, T/t, A/a, Z/z.
pub fn path_parse(d: &str) -> PathData {
    let bez = parse_svg_path(d);
    PathData {
        d: d.to_string(),
        bez,
    }
}

/// Serialize a PathData back to an SVG `d` attribute string.
pub fn path_serialize(path: &PathData) -> String {
    serialize_bezpath(&path.bez)
}

/// Compute the tight bounding box of a path.
pub fn path_bounds(path: &PathData) -> forge_math::Rect {
    let bb = path.bez.bounding_box();
    forge_math::Rect::new(
        bb.x0 as f32,
        bb.y0 as f32,
        (bb.x1 - bb.x0) as f32,
        (bb.y1 - bb.y0) as f32,
    )
}

// ── SVG Path Parser ─────────────────────────────────────────────────────────

/// Parse SVG path `d` string into a kurbo BezPath.
///
/// This is a hand-rolled parser that handles the full SVG path spec:
/// absolute and relative commands, implicit lineto after moveto,
/// comma/whitespace flexibility, and arc conversion.
fn parse_svg_path(d: &str) -> BezPath {
    let mut path = BezPath::new();
    let mut chars = d.chars().peekable();
    let mut current = Point::new(0.0, 0.0);
    let mut start = Point::new(0.0, 0.0);
    let mut last_control: Option<Point> = None;
    let mut last_cmd = ' ';

    // Skip whitespace and commas
    fn skip_ws(chars: &mut std::iter::Peekable<std::str::Chars>) {
        while let Some(&c) = chars.peek() {
            if c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == ',' {
                chars.next();
            } else {
                break;
            }
        }
    }

    // Parse a floating-point number
    fn parse_number(chars: &mut std::iter::Peekable<std::str::Chars>) -> Option<f64> {
        skip_ws(chars);
        let mut s = String::new();

        // Optional sign
        if let Some(&c) = chars.peek() {
            if c == '-' || c == '+' {
                s.push(c);
                chars.next();
            }
        }

        let mut has_dot = false;
        let mut has_digit = false;

        while let Some(&c) = chars.peek() {
            if c.is_ascii_digit() {
                s.push(c);
                chars.next();
                has_digit = true;
            } else if c == '.' && !has_dot {
                s.push(c);
                chars.next();
                has_dot = true;
            } else if (c == 'e' || c == 'E') && has_digit {
                s.push(c);
                chars.next();
                // Optional exponent sign
                if let Some(&ec) = chars.peek() {
                    if ec == '-' || ec == '+' {
                        s.push(ec);
                        chars.next();
                    }
                }
                while let Some(&dc) = chars.peek() {
                    if dc.is_ascii_digit() {
                        s.push(dc);
                        chars.next();
                    } else {
                        break;
                    }
                }
                break;
            } else {
                break;
            }
        }

        if has_digit || has_dot {
            s.parse::<f64>().ok()
        } else {
            None
        }
    }

    fn parse_flag(chars: &mut std::iter::Peekable<std::str::Chars>) -> Option<bool> {
        skip_ws(chars);
        match chars.peek() {
            Some(&'0') => { chars.next(); Some(false) }
            Some(&'1') => { chars.next(); Some(true) }
            _ => None,
        }
    }

    while chars.peek().is_some() {
        skip_ws(&mut chars);

        let cmd = match chars.peek() {
            Some(&c) if c.is_ascii_alphabetic() => {
                chars.next();
                c
            }
            Some(_) => last_cmd,
            None => break,
        };

        match cmd {
            'M' | 'm' => {
                let rel = cmd == 'm';
                let mut first = true;
                while let Some(x) = parse_number(&mut chars) {
                    let y = parse_number(&mut chars).unwrap_or(0.0);
                    let pt = if rel {
                        Point::new(current.x + x, current.y + y)
                    } else {
                        Point::new(x, y)
                    };

                    if first {
                        path.move_to(pt);
                        start = pt;
                        first = false;
                    } else {
                        // Implicit lineto after initial moveto
                        path.line_to(pt);
                    }
                    current = pt;
                    last_control = None;
                    skip_ws(&mut chars);
                }
                last_cmd = if rel { 'l' } else { 'L' };
            }
            'L' | 'l' => {
                let rel = cmd == 'l';
                while let Some(x) = parse_number(&mut chars) {
                    let y = parse_number(&mut chars).unwrap_or(0.0);
                    let pt = if rel {
                        Point::new(current.x + x, current.y + y)
                    } else {
                        Point::new(x, y)
                    };
                    path.line_to(pt);
                    current = pt;
                    last_control = None;
                    skip_ws(&mut chars);
                }
                last_cmd = cmd;
            }
            'H' | 'h' => {
                let rel = cmd == 'h';
                while let Some(x) = parse_number(&mut chars) {
                    let nx = if rel { current.x + x } else { x };
                    let pt = Point::new(nx, current.y);
                    path.line_to(pt);
                    current = pt;
                    last_control = None;
                    skip_ws(&mut chars);
                }
                last_cmd = cmd;
            }
            'V' | 'v' => {
                let rel = cmd == 'v';
                while let Some(y) = parse_number(&mut chars) {
                    let ny = if rel { current.y + y } else { y };
                    let pt = Point::new(current.x, ny);
                    path.line_to(pt);
                    current = pt;
                    last_control = None;
                    skip_ws(&mut chars);
                }
                last_cmd = cmd;
            }
            'C' | 'c' => {
                let rel = cmd == 'c';
                while let Some(x1) = parse_number(&mut chars) {
                    let y1 = parse_number(&mut chars).unwrap_or(0.0);
                    let x2 = parse_number(&mut chars).unwrap_or(0.0);
                    let y2 = parse_number(&mut chars).unwrap_or(0.0);
                    let x = parse_number(&mut chars).unwrap_or(0.0);
                    let y = parse_number(&mut chars).unwrap_or(0.0);
                    let (p1, p2, pt) = if rel {
                        (
                            Point::new(current.x + x1, current.y + y1),
                            Point::new(current.x + x2, current.y + y2),
                            Point::new(current.x + x, current.y + y),
                        )
                    } else {
                        (Point::new(x1, y1), Point::new(x2, y2), Point::new(x, y))
                    };
                    path.curve_to(p1, p2, pt);
                    last_control = Some(p2);
                    current = pt;
                    skip_ws(&mut chars);
                }
                last_cmd = cmd;
            }
            'S' | 's' => {
                let rel = cmd == 's';
                while let Some(x2) = parse_number(&mut chars) {
                    let y2 = parse_number(&mut chars).unwrap_or(0.0);
                    let x = parse_number(&mut chars).unwrap_or(0.0);
                    let y = parse_number(&mut chars).unwrap_or(0.0);
                    // Reflect last control point
                    let p1 = match last_control {
                        Some(lc) => Point::new(2.0 * current.x - lc.x, 2.0 * current.y - lc.y),
                        None => current,
                    };
                    let (p2, pt) = if rel {
                        (
                            Point::new(current.x + x2, current.y + y2),
                            Point::new(current.x + x, current.y + y),
                        )
                    } else {
                        (Point::new(x2, y2), Point::new(x, y))
                    };
                    path.curve_to(p1, p2, pt);
                    last_control = Some(p2);
                    current = pt;
                    skip_ws(&mut chars);
                }
                last_cmd = cmd;
            }
            'Q' | 'q' => {
                let rel = cmd == 'q';
                while let Some(x1) = parse_number(&mut chars) {
                    let y1 = parse_number(&mut chars).unwrap_or(0.0);
                    let x = parse_number(&mut chars).unwrap_or(0.0);
                    let y = parse_number(&mut chars).unwrap_or(0.0);
                    let (p1, pt) = if rel {
                        (
                            Point::new(current.x + x1, current.y + y1),
                            Point::new(current.x + x, current.y + y),
                        )
                    } else {
                        (Point::new(x1, y1), Point::new(x, y))
                    };
                    path.quad_to(p1, pt);
                    last_control = Some(p1);
                    current = pt;
                    skip_ws(&mut chars);
                }
                last_cmd = cmd;
            }
            'T' | 't' => {
                let rel = cmd == 't';
                while let Some(x) = parse_number(&mut chars) {
                    let y = parse_number(&mut chars).unwrap_or(0.0);
                    let p1 = match last_control {
                        Some(lc) => Point::new(2.0 * current.x - lc.x, 2.0 * current.y - lc.y),
                        None => current,
                    };
                    let pt = if rel {
                        Point::new(current.x + x, current.y + y)
                    } else {
                        Point::new(x, y)
                    };
                    path.quad_to(p1, pt);
                    last_control = Some(p1);
                    current = pt;
                    skip_ws(&mut chars);
                }
                last_cmd = cmd;
            }
            'A' | 'a' => {
                let rel = cmd == 'a';
                while let Some(rx) = parse_number(&mut chars) {
                    let ry = parse_number(&mut chars).unwrap_or(0.0);
                    let x_rot = parse_number(&mut chars).unwrap_or(0.0);
                    let large_arc = parse_flag(&mut chars).unwrap_or(false);
                    let sweep = parse_flag(&mut chars).unwrap_or(false);
                    let x = parse_number(&mut chars).unwrap_or(0.0);
                    let y = parse_number(&mut chars).unwrap_or(0.0);
                    let to = if rel {
                        Point::new(current.x + x, current.y + y)
                    } else {
                        Point::new(x, y)
                    };
                    let arc = KurboSvgArc {
                        from: current,
                        to,
                        radii: kurbo::Vec2::new(rx, ry),
                        x_rotation: x_rot.to_radians(),
                        large_arc,
                        sweep,
                    };
                    if let Some(center_arc) = KurboArc::from_svg_arc(&arc) {
                        center_arc.to_cubic_beziers(0.1, |p1, p2, p| {
                            path.curve_to(p1, p2, p);
                        });
                    } else {
                        path.line_to(to);
                    }
                    current = to;
                    last_control = None;
                    skip_ws(&mut chars);
                }
                last_cmd = cmd;
            }
            'Z' | 'z' => {
                path.close_path();
                current = start;
                last_control = None;
                last_cmd = cmd;
            }
            _ => {
                // Unknown command — skip character
                chars.next();
            }
        }
    }

    path
}

// ── Serializer ──────────────────────────────────────────────────────────────

fn serialize_bezpath(path: &BezPath) -> String {
    let mut out = String::new();
    for el in path.elements() {
        if !out.is_empty() {
            out.push(' ');
        }
        match el {
            PathEl::MoveTo(p) => {
                out.push_str(&format!("M{},{}", fmt_f64(p.x), fmt_f64(p.y)));
            }
            PathEl::LineTo(p) => {
                out.push_str(&format!("L{},{}", fmt_f64(p.x), fmt_f64(p.y)));
            }
            PathEl::QuadTo(p1, p) => {
                out.push_str(&format!(
                    "Q{},{} {},{}",
                    fmt_f64(p1.x), fmt_f64(p1.y),
                    fmt_f64(p.x), fmt_f64(p.y)
                ));
            }
            PathEl::CurveTo(p1, p2, p) => {
                out.push_str(&format!(
                    "C{},{} {},{} {},{}",
                    fmt_f64(p1.x), fmt_f64(p1.y),
                    fmt_f64(p2.x), fmt_f64(p2.y),
                    fmt_f64(p.x), fmt_f64(p.y)
                ));
            }
            PathEl::ClosePath => {
                out.push('Z');
            }
        }
    }
    out
}

/// Format f64 with minimal decimal places (strip trailing zeros).
fn fmt_f64(v: f64) -> String {
    if v == v.floor() {
        format!("{}", v as i64)
    } else {
        let s = format!("{:.6}", v);
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_simple_rect() {
        let d = "M0,0 L100,0 L100,100 L0,100 Z";
        let path = path_parse(d);
        assert_eq!(path.element_count(), 5); // M + 3L + Z
    }

    #[test]
    fn round_trip_path() {
        let d = "M10,20 L30,40 C50,60 70,80 90,100 Z";
        let path = path_parse(d);
        let serialized = path_serialize(&path);
        let reparsed = path_parse(&serialized);
        assert_eq!(path.element_count(), reparsed.element_count());
    }

    #[test]
    fn bounding_box() {
        let d = "M0,0 L100,0 L100,50 L0,50 Z";
        let path = path_parse(d);
        let bb = path_bounds(&path);
        assert_eq!(bb.width(), 100.0);
        assert_eq!(bb.height(), 50.0);
    }

    #[test]
    fn parse_relative_commands() {
        let d = "M10,10 l20,0 l0,20 l-20,0 z";
        let path = path_parse(d);
        let bb = path_bounds(&path);
        assert!((bb.width() - 20.0).abs() < 0.01);
        assert!((bb.height() - 20.0).abs() < 0.01);
    }

    #[test]
    fn parse_arc() {
        let d = "M10,80 A25,25 0 0,1 50,80";
        let path = path_parse(d);
        assert!(path.element_count() > 1); // M + cubic approximation(s)
    }

    #[test]
    fn empty_path() {
        let path = PathData::empty();
        assert!(path.is_empty());
        assert_eq!(path.element_count(), 0);
    }

    #[test]
    fn parse_h_v_commands() {
        let d = "M0,0 H100 V50 H0 Z";
        let path = path_parse(d);
        let bb = path_bounds(&path);
        assert_eq!(bb.width(), 100.0);
        assert_eq!(bb.height(), 50.0);
    }

    #[test]
    fn parse_smooth_cubic() {
        let d = "M10,80 C40,10 65,10 95,80 S150,150 180,80";
        let path = path_parse(d);
        assert!(path.element_count() >= 3); // M + C + C(from S)
    }
}
