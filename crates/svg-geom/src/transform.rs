//! Transform bridge between kurbo::Affine and forge_math::Mat3.

use forge_math::Mat3;
use kurbo::Affine;
use crate::path::PathData;

/// Convert a `forge_math::Mat3` to a `kurbo::Affine`.
///
/// Mat3 is column-major [m00, m10, m20, m01, m11, m21, m02, m12, m22].
/// Affine stores [a, b, c, d, e, f] as:
///   | a c e |
///   | b d f |
///   | 0 0 1 |
pub fn affine_from_mat3(m: &Mat3) -> Affine {
    Affine::new([
        m.m[0] as f64, // a = m00
        m.m[1] as f64, // b = m10
        m.m[3] as f64, // c = m01
        m.m[4] as f64, // d = m11
        m.m[6] as f64, // e = m02 (tx)
        m.m[7] as f64, // f = m12 (ty)
    ])
}

/// Convert a `kurbo::Affine` to a `forge_math::Mat3`.
pub fn mat3_from_affine(a: &Affine) -> Mat3 {
    let c = a.as_coeffs();
    Mat3 {
        m: [
            c[0] as f32, c[1] as f32, 0.0, // col 0: a, b, 0
            c[2] as f32, c[3] as f32, 0.0, // col 1: c, d, 0
            c[4] as f32, c[5] as f32, 1.0, // col 2: e, f, 1
        ],
    }
}

/// Apply an affine transform to every point in a PathData.
pub fn transform_path(path: &PathData, affine: &Affine) -> PathData {
    use kurbo::{PathEl, BezPath};

    let mut new_path = BezPath::new();
    for el in path.bez().elements() {
        match el {
            PathEl::MoveTo(p) => new_path.move_to(*affine * *p),
            PathEl::LineTo(p) => new_path.line_to(*affine * *p),
            PathEl::QuadTo(p1, p) => new_path.quad_to(*affine * *p1, *affine * *p),
            PathEl::CurveTo(p1, p2, p) => {
                new_path.curve_to(*affine * *p1, *affine * *p2, *affine * *p)
            }
            PathEl::ClosePath => new_path.close_path(),
        }
    }
    PathData::from_bez(new_path)
}

/// Parse an SVG `transform` attribute string into an Affine.
///
/// Supports: translate, scale, rotate, matrix, skewX, skewY.
pub fn parse_svg_transform(s: &str) -> Affine {
    let mut result = Affine::IDENTITY;
    let mut input = s.trim();

    while !input.is_empty() {
        // Find function name
        let func_end = input.find('(').unwrap_or(input.len());
        let func_name = input[..func_end].trim();
        if func_end >= input.len() {
            break;
        }

        let args_end = input[func_end..].find(')').map(|i| func_end + i).unwrap_or(input.len());
        let args_str = &input[func_end + 1..args_end];
        let args: Vec<f64> = args_str
            .split(|c: char| c == ',' || c.is_whitespace())
            .filter(|s| !s.is_empty())
            .filter_map(|s| s.parse().ok())
            .collect();

        let tf = match func_name {
            "translate" => {
                let tx = args.first().copied().unwrap_or(0.0);
                let ty = args.get(1).copied().unwrap_or(0.0);
                Affine::translate((tx, ty))
            }
            "scale" => {
                let sx = args.first().copied().unwrap_or(1.0);
                let sy = args.get(1).copied().unwrap_or(sx);
                Affine::scale_non_uniform(sx, sy)
            }
            "rotate" => {
                let angle = args.first().copied().unwrap_or(0.0).to_radians();
                if args.len() >= 3 {
                    let cx = args[1];
                    let cy = args[2];
                    Affine::translate((cx, cy))
                        * Affine::rotate(angle)
                        * Affine::translate((-cx, -cy))
                } else {
                    Affine::rotate(angle)
                }
            }
            "matrix" if args.len() >= 6 => {
                Affine::new([args[0], args[1], args[2], args[3], args[4], args[5]])
            }
            "skewX" => {
                let angle = args.first().copied().unwrap_or(0.0).to_radians();
                Affine::new([1.0, 0.0, angle.tan(), 1.0, 0.0, 0.0])
            }
            "skewY" => {
                let angle = args.first().copied().unwrap_or(0.0).to_radians();
                Affine::new([1.0, angle.tan(), 0.0, 1.0, 0.0, 0.0])
            }
            _ => Affine::IDENTITY,
        };

        result = result * tf;
        input = if args_end + 1 < input.len() {
            input[args_end + 1..].trim()
        } else {
            ""
        };
    }

    result
}

/// Serialize an Affine as an SVG `transform` attribute value.
pub fn serialize_svg_transform(a: &Affine) -> String {
    let c = a.as_coeffs();
    if (c[0] - 1.0).abs() < 1e-9
        && c[1].abs() < 1e-9
        && c[2].abs() < 1e-9
        && (c[3] - 1.0).abs() < 1e-9
    {
        // Pure translation
        if c[4].abs() < 1e-9 && c[5].abs() < 1e-9 {
            return String::new(); // Identity
        }
        return format!("translate({},{})", fmt_f64(c[4]), fmt_f64(c[5]));
    }
    format!(
        "matrix({},{},{},{},{},{})",
        fmt_f64(c[0]), fmt_f64(c[1]), fmt_f64(c[2]),
        fmt_f64(c[3]), fmt_f64(c[4]), fmt_f64(c[5])
    )
}

fn fmt_f64(v: f64) -> String {
    if (v - v.round()).abs() < 1e-9 {
        format!("{}", v as i64)
    } else {
        let s = format!("{:.6}", v);
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use kurbo::Point;

    #[test]
    fn mat3_affine_round_trip() {
        let m = Mat3::translate(10.0, 20.0);
        let a = affine_from_mat3(&m);
        let m2 = mat3_from_affine(&a);
        assert!((m.m[6] - m2.m[6]).abs() < 0.001);
        assert!((m.m[7] - m2.m[7]).abs() < 0.001);
    }

    #[test]
    fn parse_translate() {
        let a = parse_svg_transform("translate(10, 20)");
        let c = a.as_coeffs();
        assert!((c[4] - 10.0).abs() < 1e-9);
        assert!((c[5] - 20.0).abs() < 1e-9);
    }

    #[test]
    fn parse_rotate_with_center() {
        let a = parse_svg_transform("rotate(90, 50, 50)");
        let p: Point = a * Point::new(50.0, 0.0);
        assert!((p.x - 100.0).abs() < 1e-6);
        assert!((p.y - 50.0).abs() < 1e-6);
    }

    #[test]
    fn parse_compound_transform() {
        let a = parse_svg_transform("translate(10,20) scale(2)");
        let p: Point = a * Point::new(0.0, 0.0);
        assert!((p.x - 10.0).abs() < 1e-6);
        assert!((p.y - 20.0).abs() < 1e-6);
    }

    #[test]
    fn identity_serializes_empty() {
        assert_eq!(serialize_svg_transform(&Affine::IDENTITY), "");
    }
}
