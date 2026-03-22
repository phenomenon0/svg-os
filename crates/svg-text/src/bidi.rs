//! Bidirectional text support using the Unicode Bidi Algorithm.
//!
//! Feature-gated behind `bidi` feature (default on).
//! When disabled, all text is treated as LTR.

use svg_doc::{TextStyle, TextRun, TextDirection};
use crate::paragraph::PositionedRun;

/// Resolve bidi levels for a sequence of text runs.
/// Returns true if any reordering is needed.
#[cfg(feature = "bidi")]
pub fn needs_bidi_reorder(runs: &[TextRun]) -> bool {
    runs.iter().any(|r| r.style.direction != TextDirection::Ltr) ||
    runs.iter().any(|r| has_rtl_chars(&r.content))
}

#[cfg(not(feature = "bidi"))]
pub fn needs_bidi_reorder(_runs: &[TextRun]) -> bool {
    false
}

/// Reorder positioned runs within a line for visual display.
/// Reverses RTL runs and adjusts x positions.
#[cfg(feature = "bidi")]
pub fn reorder_line_runs(
    runs: &mut Vec<PositionedRun>,
    base_direction: TextDirection,
    max_width: f32,
) {
    if runs.is_empty() {
        return;
    }

    // Simple reordering: reverse runs that contain RTL text
    // Full UBA would use unicode_bidi::BidiInfo, but for the common case
    // (pure RTL or pure LTR with occasional embedded), this works.
    let all_rtl = base_direction == TextDirection::Rtl;

    if all_rtl {
        // Reverse all runs and mirror x positions
        runs.reverse();
        let mut x = 0.0;
        for run in runs.iter_mut() {
            run.x = x;
            x += run.width;
        }
        // Right-align: shift all runs so they end at max_width
        if max_width.is_finite() {
            let total_width: f32 = runs.iter().map(|r| r.width).sum();
            let offset = max_width - total_width;
            for run in runs.iter_mut() {
                run.x += offset;
            }
        }
    } else {
        // Mixed: use unicode-bidi for proper reordering
        let combined: String = runs.iter().map(|r| r.text.as_str()).collect::<Vec<_>>().join("");
        if combined.is_empty() {
            return;
        }

        let para_level = unicode_bidi::Level::ltr();
        let info = unicode_bidi::BidiInfo::new(&combined, Some(para_level));

        // Check if any paragraph has RTL
        let has_rtl = info.paragraphs.iter().any(|p| {
            let (levels, _) = info.visual_runs(p, p.range.clone());
            levels.iter().any(|l| l.is_rtl())
        });

        if has_rtl {
            // For now, do a simple reversal of RTL-content runs
            // Full implementation would track level per character
            for run in runs.iter_mut() {
                if has_rtl_chars(&run.text) {
                    // Reverse the characters in RTL runs
                    run.text = run.text.chars().rev().collect();
                }
            }
        }
    }
}

#[cfg(not(feature = "bidi"))]
pub fn reorder_line_runs(
    _runs: &mut Vec<PositionedRun>,
    _base_direction: TextDirection,
    _max_width: f32,
) {
    // No-op without bidi feature
}

/// Check if a string contains RTL characters (Arabic, Hebrew, etc.)
fn has_rtl_chars(s: &str) -> bool {
    s.chars().any(|c| {
        let cp = c as u32;
        // Arabic: U+0600–U+06FF, U+0750–U+077F, U+08A0–U+08FF, U+FB50–U+FDFF, U+FE70–U+FEFF
        // Hebrew: U+0590–U+05FF, U+FB1D–U+FB4F
        (0x0590..=0x05FF).contains(&cp) ||
        (0x0600..=0x06FF).contains(&cp) ||
        (0x0750..=0x077F).contains(&cp) ||
        (0x08A0..=0x08FF).contains(&cp) ||
        (0xFB1D..=0xFDFF).contains(&cp) ||
        (0xFE70..=0xFEFF).contains(&cp)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_run(text: &str, x: f32, width: f32) -> PositionedRun {
        PositionedRun {
            text: text.into(),
            style: TextStyle::default(),
            x,
            width,
            run_index: 0,
        }
    }

    #[test]
    fn rtl_detection() {
        assert!(has_rtl_chars("مرحبا")); // Arabic
        assert!(has_rtl_chars("שלום"));   // Hebrew
        assert!(!has_rtl_chars("Hello")); // Latin
        assert!(has_rtl_chars("Hello مرحبا")); // Mixed
    }

    #[test]
    #[cfg(feature = "bidi")]
    fn reorder_rtl_base() {
        let mut runs = vec![
            make_run("Hello", 0.0, 30.0),
            make_run("World", 36.0, 30.0),
        ];
        reorder_line_runs(&mut runs, TextDirection::Rtl, 100.0);
        // Runs should be reversed
        assert_eq!(runs[0].text, "World");
        assert_eq!(runs[1].text, "Hello");
        // Should be right-aligned
        let right_edge = runs.last().unwrap().x + runs.last().unwrap().width;
        assert!((right_edge - 100.0).abs() < 1.0, "right_edge={}", right_edge);
    }

    #[test]
    fn ltr_no_reorder() {
        let mut runs = vec![
            make_run("Hello", 0.0, 30.0),
            make_run("World", 36.0, 30.0),
        ];
        let original_order: Vec<String> = runs.iter().map(|r| r.text.clone()).collect();
        reorder_line_runs(&mut runs, TextDirection::Ltr, 100.0);
        let new_order: Vec<String> = runs.iter().map(|r| r.text.clone()).collect();
        assert_eq!(original_order, new_order);
    }
}
