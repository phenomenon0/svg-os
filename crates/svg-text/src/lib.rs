//! svg-text: Text measurement abstraction.
//!
//! Tier 1: Delegates to browser via JS callback (wasm-bindgen import).
//! Provides a trait so we can swap in Rust-native text measurement later.

use serde::{Serialize, Deserialize};

/// Text measurement results.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct TextMetrics {
    pub width: f32,
    pub height: f32,
    pub ascent: f32,
    pub descent: f32,
}

/// Trait for text measurement backends.
pub trait TextMeasure {
    /// Measure a string of text with the given font and size.
    fn measure(&self, text: &str, font_family: &str, font_size: f32) -> TextMetrics;
}

/// Browser-delegated text measurement.
///
/// In WASM builds, this calls out to JavaScript's `measureText` API.
/// The actual JS function is registered via `set_text_measure_callback`.
pub struct BrowserTextMeasure;

impl TextMeasure for BrowserTextMeasure {
    fn measure(&self, text: &str, font_family: &str, font_size: f32) -> TextMetrics {
        // In WASM: call the registered JS callback
        // In native tests: fall back to estimation
        #[cfg(target_arch = "wasm32")]
        {
            let result = js_measure_text(text, font_family, font_size);
            // result is [width, height, ascent, descent] as f32 array
            TextMetrics {
                width: result[0],
                height: result[1],
                ascent: result[2],
                descent: result[3],
            }
        }

        #[cfg(not(target_arch = "wasm32"))]
        {
            // Fallback estimation for native tests
            let mock = MockTextMeasure {
                char_width: font_size * 0.6,
                line_height: font_size * 1.2,
            };
            mock.measure(text, font_family, font_size)
        }
    }
}

/// Mock text measurer for Rust-only testing.
///
/// Uses fixed character width — obviously not accurate, but allows
/// tests to run without a browser.
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
        TextMetrics {
            width,
            height,
            ascent,
            descent,
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
            // Fallback
            let w = text.len() as f32 * size * 0.6;
            [w, size * 1.2, size * 0.8, size * 0.2]
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_measure() {
        let measurer = MockTextMeasure::new(16.0);
        let m = measurer.measure("Hello", "sans-serif", 16.0);
        assert!(m.width > 0.0);
        assert!(m.height > 0.0);
        // 5 chars * 9.6 char_width = 48.0
        assert!((m.width - 48.0).abs() < 0.01);
    }

    #[test]
    fn browser_fallback() {
        let measurer = BrowserTextMeasure;
        let m = measurer.measure("Test", "Arial", 12.0);
        assert!(m.width > 0.0);
    }
}
