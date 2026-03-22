//! svg-text: Text measurement and paragraph layout.
//!
//! Provides a `TextMeasure` trait with pluggable backends:
//! - `BrowserTextMeasure`: delegates to JS via callback (WASM)
//! - `MockTextMeasure`: fixed-width estimation for testing
//! - Native backend (rustybuzz + fontdb): future, feature-gated
//!
//! The paragraph layout algorithm (`paragraph.rs`) is backend-agnostic —
//! it takes `&dyn TextMeasure` and never imports WASM or font code.

pub mod paragraph;
pub mod emit;
pub mod hyphenate;
pub mod bidi;

use svg_doc::TextStyle;
use serde::{Serialize, Deserialize};

/// Basic text measurement results (legacy).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct TextMetrics {
    pub width: f32,
    pub height: f32,
    pub ascent: f32,
    pub descent: f32,
}

/// Extended measurement results for a styled text run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunMetrics {
    pub width: f32,
    pub height: f32,
    pub ascent: f32,
    pub descent: f32,
    pub line_gap: f32,
    /// Per-character advance widths.
    pub advances: Vec<f32>,
}

/// Trait for text measurement backends.
pub trait TextMeasure {
    /// Measure a string of text with the given font and size (legacy).
    fn measure(&self, text: &str, font_family: &str, font_size: f32) -> TextMetrics;

    /// Measure a run of text with full style information.
    fn measure_run(&self, text: &str, style: &TextStyle) -> RunMetrics {
        let m = self.measure(text, &style.font_family, style.font_size);
        let char_count = text.chars().count().max(1);
        let char_width = m.width / char_count as f32;
        RunMetrics {
            width: m.width,
            height: m.height,
            ascent: m.ascent,
            descent: m.descent,
            line_gap: 0.0,
            advances: text.chars().map(|_| char_width).collect(),
        }
    }

    /// Get per-character advance widths.
    fn measure_advances(&self, text: &str, style: &TextStyle) -> Vec<f32> {
        self.measure_run(text, style).advances
    }

    /// Find the character index where cumulative width exceeds max_width.
    /// Returns the number of characters (not bytes) that fit.
    fn hit_test_width(&self, text: &str, style: &TextStyle, max_width: f32) -> usize {
        let advances = self.measure_advances(text, style);
        let mut cumulative = 0.0;
        for (i, adv) in advances.iter().enumerate() {
            cumulative += adv;
            if cumulative > max_width {
                return i;
            }
        }
        text.chars().count()
    }
}

/// Browser-delegated text measurement.
pub struct BrowserTextMeasure;

impl TextMeasure for BrowserTextMeasure {
    fn measure(&self, text: &str, font_family: &str, font_size: f32) -> TextMetrics {
        #[cfg(target_arch = "wasm32")]
        {
            let result = js_measure_text(text, font_family, font_size);
            TextMetrics {
                width: result[0],
                height: result[1],
                ascent: result[2],
                descent: result[3],
            }
        }

        #[cfg(not(target_arch = "wasm32"))]
        {
            let mock = MockTextMeasure::new(font_size);
            mock.measure(text, font_family, font_size)
        }
    }
}

/// Mock text measurer for testing. Uses fixed character width.
pub struct MockTextMeasure {
    pub char_width: f32,
    pub line_height: f32,
}

impl MockTextMeasure {
    pub fn new(font_size: f32) -> Self {
        Self {
            char_width: font_size * 0.6,
            line_height: font_size * 1.2,
        }
    }
}

impl TextMeasure for MockTextMeasure {
    fn measure(&self, text: &str, _font_family: &str, font_size: f32) -> TextMetrics {
        let width = text.len() as f32 * self.char_width;
        let height = self.line_height;
        let ascent = font_size * 0.8;
        let descent = font_size * 0.2;
        TextMetrics { width, height, ascent, descent }
    }

    fn measure_run(&self, text: &str, style: &TextStyle) -> RunMetrics {
        let base_char_width = style.font_size * 0.6;
        let mut advances = Vec::with_capacity(text.chars().count());
        let mut width = 0.0;
        for ch in text.chars() {
            let w = if ch == ' ' {
                base_char_width + style.word_spacing
            } else {
                base_char_width
            } + style.letter_spacing;
            advances.push(w);
            width += w;
        }
        RunMetrics {
            width,
            height: style.font_size * 1.2,
            ascent: style.font_size * 0.8,
            descent: style.font_size * 0.2,
            line_gap: 0.0,
            advances,
        }
    }
}

// WASM text measurement callback
#[cfg(target_arch = "wasm32")]
use std::cell::RefCell;

#[cfg(target_arch = "wasm32")]
thread_local! {
    static TEXT_MEASURE_FN: RefCell<Option<Box<dyn Fn(&str, &str, f32) -> [f32; 4]>>> =
        RefCell::new(None);
}

#[cfg(target_arch = "wasm32")]
fn js_measure_text(text: &str, font: &str, size: f32) -> [f32; 4] {
    TEXT_MEASURE_FN.with(|f| {
        if let Some(ref func) = *f.borrow() {
            func(text, font, size)
        } else {
            let w = text.len() as f32 * size * 0.6;
            [w, size * 1.2, size * 0.8, size * 0.2]
        }
    })
}

/// Register a text measurement callback from the WASM bridge.
#[cfg(target_arch = "wasm32")]
pub fn set_text_measure_fn(f: Box<dyn Fn(&str, &str, f32) -> [f32; 4]>) {
    TEXT_MEASURE_FN.with(|cell| {
        *cell.borrow_mut() = Some(f);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use svg_doc::TextStyle;

    #[test]
    fn mock_measure() {
        let measurer = MockTextMeasure::new(16.0);
        let m = measurer.measure("Hello", "sans-serif", 16.0);
        assert!(m.width > 0.0);
        assert!(m.height > 0.0);
        assert!((m.width - 48.0).abs() < 0.01);
    }

    #[test]
    fn browser_fallback() {
        let measurer = BrowserTextMeasure;
        let m = measurer.measure("Test", "Arial", 12.0);
        assert!(m.width > 0.0);
    }

    #[test]
    fn measure_run_default_style() {
        let measurer = MockTextMeasure::new(16.0);
        let style = TextStyle::default();
        let run = measurer.measure_run("Hello", &style);
        let legacy = measurer.measure("Hello", "sans-serif", 16.0);
        assert!((run.width - legacy.width).abs() < 0.01);
    }

    #[test]
    fn measure_run_letter_spacing() {
        let measurer = MockTextMeasure::new(16.0);
        let mut style = TextStyle::default();
        let base = measurer.measure_run("Hello", &style);

        style.letter_spacing = 2.0;
        let spaced = measurer.measure_run("Hello", &style);
        // 5 chars * 2.0 extra = 10.0 more
        assert!((spaced.width - base.width - 10.0).abs() < 0.01);
    }

    #[test]
    fn measure_run_word_spacing() {
        let measurer = MockTextMeasure::new(16.0);
        let mut style = TextStyle::default();
        let base = measurer.measure_run("Hello World", &style);

        style.word_spacing = 5.0;
        let spaced = measurer.measure_run("Hello World", &style);
        // 1 space * 5.0 extra
        assert!((spaced.width - base.width - 5.0).abs() < 0.01);
    }

    #[test]
    fn hit_test_width_basic() {
        let measurer = MockTextMeasure::new(10.0);
        let style = TextStyle { font_size: 10.0, ..TextStyle::default() };
        // char_width = 6.0, "Hello World" = 11 chars
        // At max_width = 35.0: cumulative after 5 chars = 30.0 (fits), after 6 = 36.0 (over)
        let idx = measurer.hit_test_width("Hello World", &style, 35.0);
        assert_eq!(idx, 5); // "Hello" fits, space pushes over
    }

    #[test]
    fn hit_test_width_all_fits() {
        let measurer = MockTextMeasure::new(10.0);
        let style = TextStyle { font_size: 10.0, ..TextStyle::default() };
        let idx = measurer.hit_test_width("Hi", &style, 1000.0);
        assert_eq!(idx, 2);
    }

    #[test]
    fn default_trait_impls_work() {
        // A minimal struct that only implements measure()
        struct MinimalMeasure;
        impl TextMeasure for MinimalMeasure {
            fn measure(&self, text: &str, _ff: &str, fs: f32) -> TextMetrics {
                TextMetrics {
                    width: text.len() as f32 * fs * 0.5,
                    height: fs,
                    ascent: fs * 0.8,
                    descent: fs * 0.2,
                }
            }
        }

        let m = MinimalMeasure;
        let style = TextStyle::default();
        let run = m.measure_run("Test", &style);
        assert_eq!(run.advances.len(), 4);
        assert!(run.width > 0.0);

        let idx = m.hit_test_width("Test", &style, 5.0);
        assert!(idx < 4);
    }
}
