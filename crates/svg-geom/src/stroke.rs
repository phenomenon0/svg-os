//! Stroke-to-path conversion and curve fitting.

use kurbo::{Cap, Join, Stroke, StrokeOpts};
use serde::{Serialize, Deserialize};
use crate::path::PathData;

/// SVG stroke style parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrokeStyle {
    pub width: f64,
    pub cap: LineCap,
    pub join: LineJoin,
    pub miter_limit: f64,
}

impl Default for StrokeStyle {
    fn default() -> Self {
        Self {
            width: 1.0,
            cap: LineCap::Butt,
            join: LineJoin::Miter,
            miter_limit: 4.0,
        }
    }
}

/// Line cap style (SVG stroke-linecap).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LineCap {
    Butt,
    Round,
    Square,
}

/// Line join style (SVG stroke-linejoin).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LineJoin {
    Miter,
    Round,
    Bevel,
}

/// Convert a path's stroke outline to a filled path.
///
/// Takes a path and stroke parameters, returns the outline
/// as a new filled PathData (useful for boolean ops, export, etc).
pub fn stroke_to_path(path: &PathData, style: &StrokeStyle) -> PathData {
    let kurbo_cap = match style.cap {
        LineCap::Butt => Cap::Butt,
        LineCap::Round => Cap::Round,
        LineCap::Square => Cap::Square,
    };
    let kurbo_join = match style.join {
        LineJoin::Miter => Join::Miter,
        LineJoin::Round => Join::Round,
        LineJoin::Bevel => Join::Bevel,
    };

    let stroke = Stroke::new(style.width)
        .with_join(kurbo_join)
        .with_miter_limit(style.miter_limit)
        .with_caps(kurbo_cap);

    let stroked = kurbo::stroke(
        path.bez().elements().iter().copied(),
        &stroke,
        &StrokeOpts::default(),
        0.25, // tolerance
    );
    PathData::from_bez(stroked)
}

/// Fit a smooth curve through a set of points.
///
/// Creates a polyline BezPath from the input points.
/// For smoother results, use kurbo's `CubicBez` fitting on
/// individual segments (future improvement).
pub fn path_fit(points: &[(f64, f64)], _accuracy: f64) -> PathData {
    if points.len() < 2 {
        return PathData::empty();
    }

    let mut bez = kurbo::BezPath::new();
    bez.move_to(kurbo::Point::new(points[0].0, points[0].1));
    for &(x, y) in &points[1..] {
        bez.line_to(kurbo::Point::new(x, y));
    }
    PathData::from_bez(bez)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::path::path_parse;

    #[test]
    fn stroke_produces_nonempty_path() {
        let path = path_parse("M0,0 L100,0 L100,50 L0,50 Z");
        let style = StrokeStyle {
            width: 10.0,
            ..Default::default()
        };
        let stroked = stroke_to_path(&path, &style);
        assert!(!stroked.is_empty());
    }

    #[test]
    fn fit_curve() {
        let points = vec![
            (0.0, 0.0),
            (10.0, 5.0),
            (20.0, 0.0),
            (30.0, -5.0),
            (40.0, 0.0),
        ];
        let fitted = path_fit(&points, 1.0);
        assert!(!fitted.is_empty());
    }
}
