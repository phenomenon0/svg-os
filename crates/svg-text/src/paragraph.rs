//! Paragraph layout: word wrap, alignment, and run positioning.
//!
//! Pure algorithm — takes `&dyn TextMeasure` and produces positioned lines.
//! No DOM, no WASM, no rendering code.

use svg_doc::{TextStyle, TextRun, TextAlign};
use crate::TextMeasure;

/// A positioned run within a line.
#[derive(Debug, Clone)]
pub struct PositionedRun {
    /// The text fragment (may be a subset of the original run).
    pub text: String,
    /// Cloned style from the input run.
    pub style: TextStyle,
    /// X offset within the line.
    pub x: f32,
    /// Measured width.
    pub width: f32,
    /// Index into the original `Vec<TextRun>`.
    pub run_index: usize,
}

/// A laid-out line of text.
#[derive(Debug, Clone)]
pub struct LayoutLine {
    pub runs: Vec<PositionedRun>,
    /// Baseline y position.
    pub y: f32,
    /// Total content width.
    pub width: f32,
    pub ascent: f32,
    pub descent: f32,
    /// Line box height (ascent + descent, or overridden by line_height).
    pub height: f32,
}

/// Complete paragraph layout result.
#[derive(Debug, Clone)]
pub struct ParagraphLayout {
    pub lines: Vec<LayoutLine>,
    /// Maximum line content width.
    pub width: f32,
    /// Total height (sum of line heights).
    pub height: f32,
}

/// Configuration for paragraph layout.
#[derive(Debug, Clone)]
pub struct ParagraphConfig {
    /// Wrapping width. `f32::INFINITY` for no wrap.
    pub max_width: f32,
    pub align: TextAlign,
    /// Override line height. `None` = derive from font metrics.
    pub line_height: Option<f32>,
    /// First-line indent.
    pub indent: f32,
}

impl Default for ParagraphConfig {
    fn default() -> Self {
        Self {
            max_width: f32::INFINITY,
            align: TextAlign::Start,
            line_height: None,
            indent: 0.0,
        }
    }
}

/// A word fragment for layout.
struct Word {
    text: String,
    style: TextStyle,
    run_index: usize,
    width: f32,
    ascent: f32,
    descent: f32,
    trailing_space: bool,
    space_width: f32,
}

/// Lay out a paragraph of text runs.
pub fn layout_paragraph(
    runs: &[TextRun],
    config: &ParagraphConfig,
    measurer: &dyn TextMeasure,
) -> ParagraphLayout {
    if runs.is_empty() {
        return ParagraphLayout { lines: vec![], width: 0.0, height: 0.0 };
    }

    let words = split_into_words(runs, measurer);
    if words.is_empty() {
        return ParagraphLayout { lines: vec![], width: 0.0, height: 0.0 };
    }

    let mut lines: Vec<LineBuilder> = Vec::new();
    let mut current_line = LineBuilder::new();
    let mut is_first_line = true;

    for word in &words {
        let indent = if is_first_line && current_line.runs.is_empty() {
            config.indent
        } else {
            0.0
        };

        let available = config.max_width - indent;
        let needed = current_line.content_width + word.width
            + if current_line.runs.is_empty() { 0.0 } else { word.space_width };

        if !current_line.runs.is_empty() && needed > available {
            // Word doesn't fit — finalize current line and start new one
            current_line.indent = if is_first_line { config.indent } else { 0.0 };
            lines.push(current_line);
            current_line = LineBuilder::new();
            is_first_line = false;
        }

        // Check if single word exceeds max_width — character-level break
        if current_line.runs.is_empty() && word.width > config.max_width {
            let indent = if is_first_line { config.indent } else { 0.0 };
            let remaining = &word.text;
            let mut offset = 0;
            let char_count = remaining.chars().count();

            while offset < char_count {
                let avail = config.max_width - if offset == 0 { indent } else { 0.0 };
                let substr: String = remaining.chars().skip(offset).collect();
                let fit = measurer.hit_test_width(&substr, &word.style, avail);
                let take = fit.max(1); // always take at least 1 char
                let fragment: String = remaining.chars().skip(offset).take(take).collect();
                let metrics = measurer.measure_run(&fragment, &word.style);

                if offset > 0 || !current_line.runs.is_empty() {
                    // Need a new line for continuation
                    if !current_line.runs.is_empty() {
                        current_line.indent = if is_first_line { config.indent } else { 0.0 };
                        lines.push(current_line);
                        current_line = LineBuilder::new();
                        is_first_line = false;
                    }
                }

                current_line.add_run(
                    fragment,
                    word.style.clone(),
                    word.run_index,
                    metrics.width,
                    metrics.ascent,
                    metrics.descent,
                    0.0,
                );
                offset += take;
            }

            // If word had trailing space, note it for next word spacing
            if word.trailing_space {
                current_line.trailing_space_width = word.space_width;
            }
            continue;
        }

        // Normal case: add word to current line
        let space = if current_line.runs.is_empty() { 0.0 } else { word.space_width };
        current_line.add_run(
            word.text.clone(),
            word.style.clone(),
            word.run_index,
            word.width,
            word.ascent,
            word.descent,
            space,
        );
    }

    // Finalize last line
    if !current_line.runs.is_empty() {
        current_line.indent = if is_first_line { config.indent } else { 0.0 };
        lines.push(current_line);
    }

    // Position lines vertically and compute alignment offsets
    let mut layout_lines = Vec::with_capacity(lines.len());
    let mut y = 0.0;
    let mut max_width: f32 = 0.0;

    for line in &lines {
        let ascent = line.max_ascent;
        let descent = line.max_descent;
        let height = config.line_height.unwrap_or(ascent + descent);

        y += ascent; // baseline = top of line box + ascent

        let content_width = line.content_width;
        let align_offset = match config.align {
            TextAlign::Start => line.indent,
            TextAlign::Middle => (config.max_width - content_width) / 2.0,
            TextAlign::End => {
                if config.max_width.is_finite() {
                    config.max_width - content_width
                } else {
                    0.0
                }
            }
        };

        // Position runs within line
        let mut x = align_offset;
        let mut positioned_runs = Vec::with_capacity(line.runs.len());
        for run in &line.runs {
            x += run.leading_space;
            positioned_runs.push(PositionedRun {
                text: run.text.clone(),
                style: run.style.clone(),
                x,
                width: run.width,
                run_index: run.run_index,
            });
            x += run.width;
        }

        max_width = max_width.max(content_width);
        layout_lines.push(LayoutLine {
            runs: positioned_runs,
            y,
            width: content_width,
            ascent,
            descent,
            height,
        });

        y += descent;
        // Add line gap if using computed height
        if config.line_height.is_some() {
            y = layout_lines.iter().map(|l| l.height).sum();
        }
    }

    let total_height = if layout_lines.is_empty() {
        0.0
    } else {
        layout_lines.iter().map(|l| l.height).sum()
    };

    ParagraphLayout {
        lines: layout_lines,
        width: max_width,
        height: total_height,
    }
}

/// Internal run in a line being built.
struct RunEntry {
    text: String,
    style: TextStyle,
    run_index: usize,
    width: f32,
    leading_space: f32,
}

/// Line accumulator during layout.
struct LineBuilder {
    runs: Vec<RunEntry>,
    content_width: f32,
    max_ascent: f32,
    max_descent: f32,
    indent: f32,
    trailing_space_width: f32,
}

impl LineBuilder {
    fn new() -> Self {
        Self {
            runs: Vec::new(),
            content_width: 0.0,
            max_ascent: 0.0,
            max_descent: 0.0,
            indent: 0.0,
            trailing_space_width: 0.0,
        }
    }

    fn add_run(
        &mut self,
        text: String,
        style: TextStyle,
        run_index: usize,
        width: f32,
        ascent: f32,
        descent: f32,
        leading_space: f32,
    ) {
        self.content_width += leading_space + width;
        self.max_ascent = self.max_ascent.max(ascent);
        self.max_descent = self.max_descent.max(descent);
        self.runs.push(RunEntry { text, style, run_index, width, leading_space });
    }
}

/// Split TextRuns into words at whitespace boundaries.
fn split_into_words(runs: &[TextRun], measurer: &dyn TextMeasure) -> Vec<Word> {
    let mut words = Vec::new();

    for (run_idx, run) in runs.iter().enumerate() {
        let text = &run.content;
        if text.is_empty() {
            continue;
        }

        // Measure a space in this style for word spacing
        let space_metrics = measurer.measure_run(" ", &run.style);
        let space_width = space_metrics.width;

        let mut start = 0;
        let chars: Vec<char> = text.chars().collect();
        let len = chars.len();

        while start < len {
            // Skip leading whitespace
            while start < len && chars[start].is_whitespace() {
                start += 1;
            }
            if start >= len {
                break;
            }

            // Find end of word
            let mut end = start;
            while end < len && !chars[end].is_whitespace() {
                end += 1;
            }

            let word_text: String = chars[start..end].iter().collect();
            let trailing_space = end < len && chars[end].is_whitespace();

            let metrics = measurer.measure_run(&word_text, &run.style);

            words.push(Word {
                text: word_text,
                style: run.style.clone(),
                run_index: run_idx,
                width: metrics.width,
                ascent: metrics.ascent,
                descent: metrics.descent,
                trailing_space,
                space_width,
            });

            start = end;
        }
    }

    words
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MockTextMeasure;

    fn mock() -> MockTextMeasure {
        MockTextMeasure::new(10.0) // char_width = 6.0, line_height = 12.0
    }

    fn style() -> TextStyle {
        TextStyle { font_size: 10.0, ..TextStyle::default() }
    }

    fn run(text: &str) -> TextRun {
        TextRun { content: text.into(), style: style() }
    }

    fn run_styled(text: &str, font_size: f32, weight: u16) -> TextRun {
        TextRun {
            content: text.into(),
            style: TextStyle {
                font_size,
                font_weight: weight,
                ..TextStyle::default()
            },
        }
    }

    #[test]
    fn single_line_no_wrap() {
        let m = mock();
        let runs = vec![run("Hello")];
        let layout = layout_paragraph(&runs, &ParagraphConfig::default(), &m);
        assert_eq!(layout.lines.len(), 1);
        assert_eq!(layout.lines[0].runs.len(), 1);
        assert_eq!(layout.lines[0].runs[0].text, "Hello");
    }

    #[test]
    fn simple_wrap() {
        let m = mock();
        // char_width = 6.0. "Hello" = 30, " " = 6, "World" = 30, " " = 6, "Foo" = 18
        // max_width = 40: "Hello" (30) fits. "Hello World" needs 30+6+30 = 66, doesn't fit.
        let runs = vec![run("Hello World Foo")];
        let config = ParagraphConfig { max_width: 40.0, ..Default::default() };
        let layout = layout_paragraph(&runs, &config, &m);
        assert_eq!(layout.lines.len(), 3);
        assert_eq!(layout.lines[0].runs[0].text, "Hello");
        assert_eq!(layout.lines[1].runs[0].text, "World");
        assert_eq!(layout.lines[2].runs[0].text, "Foo");
    }

    #[test]
    fn mixed_styles_one_line() {
        let m = mock();
        let runs = vec![
            run_styled("Bold", 10.0, 700),
            run_styled(" Normal", 10.0, 400),
        ];
        let layout = layout_paragraph(&runs, &ParagraphConfig::default(), &m);
        assert_eq!(layout.lines.len(), 1);
        assert_eq!(layout.lines[0].runs.len(), 2);
        // First run at x=0
        assert!((layout.lines[0].runs[0].x - 0.0).abs() < 0.01);
        // Second run after first
        let first_end = layout.lines[0].runs[0].x + layout.lines[0].runs[0].width;
        assert!(layout.lines[0].runs[1].x >= first_end);
    }

    #[test]
    fn center_alignment() {
        let m = mock();
        let runs = vec![run("Hi")]; // width = 12.0
        let config = ParagraphConfig {
            max_width: 100.0,
            align: TextAlign::Middle,
            ..Default::default()
        };
        let layout = layout_paragraph(&runs, &config, &m);
        let expected_x = (100.0 - 12.0) / 2.0;
        assert!((layout.lines[0].runs[0].x - expected_x).abs() < 0.01);
    }

    #[test]
    fn end_alignment() {
        let m = mock();
        let runs = vec![run("Hi")]; // width = 12.0
        let config = ParagraphConfig {
            max_width: 100.0,
            align: TextAlign::End,
            ..Default::default()
        };
        let layout = layout_paragraph(&runs, &config, &m);
        let expected_x = 100.0 - 12.0;
        assert!((layout.lines[0].runs[0].x - expected_x).abs() < 0.01);
    }

    #[test]
    fn long_word_character_break() {
        let m = mock();
        // "Abcdefghij" = 10 chars * 6.0 = 60.0, max_width = 25.0
        // Should break into ~4 char chunks (24.0 fits in 25.0)
        let runs = vec![run("Abcdefghij")];
        let config = ParagraphConfig { max_width: 25.0, ..Default::default() };
        let layout = layout_paragraph(&runs, &config, &m);
        assert!(layout.lines.len() >= 2);
        // All characters should be accounted for
        let total_chars: usize = layout.lines.iter()
            .flat_map(|l| &l.runs)
            .map(|r| r.text.chars().count())
            .sum();
        assert_eq!(total_chars, 10);
    }

    #[test]
    fn empty_runs() {
        let m = mock();
        let layout = layout_paragraph(&[], &ParagraphConfig::default(), &m);
        assert_eq!(layout.lines.len(), 0);
        assert_eq!(layout.height, 0.0);
    }

    #[test]
    fn trailing_space_trimmed() {
        let m = mock();
        let runs = vec![run("Hello ")];
        let config = ParagraphConfig { max_width: 1000.0, ..Default::default() };
        let layout = layout_paragraph(&runs, &config, &m);
        // Line width should be "Hello" width, not "Hello " width
        assert_eq!(layout.lines.len(), 1);
        assert_eq!(layout.lines[0].runs[0].text, "Hello");
    }

    #[test]
    fn total_height() {
        let m = mock();
        let runs = vec![run("Hello World Foo")];
        let config = ParagraphConfig { max_width: 40.0, ..Default::default() };
        let layout = layout_paragraph(&runs, &config, &m);
        let sum: f32 = layout.lines.iter().map(|l| l.height).sum();
        assert!((layout.height - sum).abs() < 0.01);
    }

    #[test]
    fn first_line_indent() {
        let m = mock();
        let runs = vec![run("Hello World Foo")];
        let config = ParagraphConfig {
            max_width: 100.0,
            indent: 20.0,
            ..Default::default()
        };
        let layout = layout_paragraph(&runs, &config, &m);
        // First run on first line should be indented
        assert!((layout.lines[0].runs[0].x - 20.0).abs() < 0.01);
        // Second line should not be indented
        if layout.lines.len() > 1 {
            assert!((layout.lines[1].runs[0].x - 0.0).abs() < 0.01);
        }
    }

    #[test]
    fn letter_spacing_affects_wrap() {
        let m = mock();
        // Without spacing: "Hello" = 5 * 6.0 = 30.0, fits in max_width=35
        let runs_normal = vec![run("Hello")];
        let config = ParagraphConfig { max_width: 35.0, ..Default::default() };
        let layout1 = layout_paragraph(&runs_normal, &config, &m);
        assert_eq!(layout1.lines.len(), 1);

        // With spacing: "Hello" = 5 * (6.0 + 3.0) = 45.0, doesn't fit
        let runs_spaced = vec![TextRun {
            content: "Hello".into(),
            style: TextStyle {
                font_size: 10.0,
                letter_spacing: 3.0,
                ..TextStyle::default()
            },
        }];
        let layout2 = layout_paragraph(&runs_spaced, &config, &m);
        // Should need character-level breaking
        assert!(layout2.lines.len() >= 2);
    }

    #[test]
    fn mixed_font_sizes_line_metrics() {
        let m = mock();
        let runs = vec![
            run_styled("Small", 10.0, 400),  // ascent=8, descent=2
            run_styled("Big", 20.0, 400),    // ascent=16, descent=4
        ];
        let layout = layout_paragraph(&runs, &ParagraphConfig::default(), &m);
        assert_eq!(layout.lines.len(), 1);
        assert!((layout.lines[0].ascent - 16.0).abs() < 0.01);
        assert!((layout.lines[0].descent - 4.0).abs() < 0.01);
    }
}
