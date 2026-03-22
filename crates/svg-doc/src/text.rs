//! Text model: styled runs, text styles, and extraction from document nodes.

use crate::node::{Node, NodeId};
use crate::tag::SvgTag;
use crate::attr::{AttrKey, AttrValue};
use crate::document::Document;
use serde::{Serialize, Deserialize};

/// Font style (normal, italic, oblique).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FontStyle {
    Normal,
    Italic,
    Oblique,
}

impl Default for FontStyle {
    fn default() -> Self { Self::Normal }
}

/// Text decoration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TextDecoration {
    None,
    Underline,
    LineThrough,
    Overline,
}

impl Default for TextDecoration {
    fn default() -> Self { Self::None }
}

/// Text alignment for paragraph layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TextAlign {
    Start,
    Middle,
    End,
}

impl Default for TextAlign {
    fn default() -> Self { Self::Start }
}

/// Style properties for a text run. Flat struct passed to TextMeasure.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TextStyle {
    pub font_family: String,
    pub font_size: f32,
    pub font_weight: u16,
    pub font_style: FontStyle,
    pub letter_spacing: f32,
    pub word_spacing: f32,
    pub decoration: TextDecoration,
    pub baseline_shift: f32,
}

impl Default for TextStyle {
    fn default() -> Self {
        Self {
            font_family: "sans-serif".into(),
            font_size: 16.0,
            font_weight: 400,
            font_style: FontStyle::Normal,
            letter_spacing: 0.0,
            word_spacing: 0.0,
            decoration: TextDecoration::None,
            baseline_shift: 0.0,
        }
    }
}

impl TextStyle {
    /// Extract style from a Node's attributes, inheriting from parent_style
    /// for any absent properties.
    pub fn from_node(node: &Node, parent: &TextStyle) -> Self {
        let font_family = node
            .get_string(&AttrKey::FontFamily)
            .map(|s| s.to_string())
            .unwrap_or_else(|| parent.font_family.clone());

        let font_size = node.get_f32(&AttrKey::FontSize);
        let font_size = if font_size > 0.0 { font_size } else { parent.font_size };

        let font_weight = node
            .get_string(&AttrKey::FontWeight)
            .and_then(|s| parse_font_weight(s))
            .unwrap_or(parent.font_weight);

        let font_style = node
            .get_string(&AttrKey::FontStyle)
            .map(|s| match s {
                "italic" => FontStyle::Italic,
                "oblique" => FontStyle::Oblique,
                _ => FontStyle::Normal,
            })
            .unwrap_or(parent.font_style);

        let letter_spacing = {
            let v = node.get_f32(&AttrKey::LetterSpacing);
            if v != 0.0 || node.get_attr(&AttrKey::LetterSpacing).is_some() {
                v
            } else {
                parent.letter_spacing
            }
        };

        let word_spacing = {
            let v = node.get_f32(&AttrKey::WordSpacing);
            if v != 0.0 || node.get_attr(&AttrKey::WordSpacing).is_some() {
                v
            } else {
                parent.word_spacing
            }
        };

        let decoration = node
            .get_string(&AttrKey::TextDecoration)
            .map(|s| match s {
                "underline" => TextDecoration::Underline,
                "line-through" => TextDecoration::LineThrough,
                "overline" => TextDecoration::Overline,
                _ => TextDecoration::None,
            })
            .unwrap_or(parent.decoration);

        let baseline_shift = {
            let v = node.get_f32(&AttrKey::BaselineShift);
            if v != 0.0 || node.get_attr(&AttrKey::BaselineShift).is_some() {
                v
            } else {
                parent.baseline_shift
            }
        };

        Self {
            font_family,
            font_size,
            font_weight,
            font_style,
            letter_spacing,
            word_spacing,
            decoration,
            baseline_shift,
        }
    }
}

/// A run of text with uniform style.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextRun {
    pub content: String,
    pub style: TextStyle,
}

/// Extract TextRuns from a `<text>` element by walking its children.
///
/// - Flat text (no `<tspan>` children): returns a single run with the text node's style.
/// - `<tspan>` children: returns one run per tspan, with styles inherited from the parent.
pub fn extract_text_runs(doc: &Document, text_node_id: NodeId) -> Vec<TextRun> {
    let text_node = match doc.get(text_node_id) {
        Some(n) => n,
        None => return vec![],
    };

    let parent_style = TextStyle::from_node(text_node, &TextStyle::default());
    let children = text_node.children.clone();

    // Check if there are tspan children
    let tspan_children: Vec<NodeId> = children
        .iter()
        .filter(|cid| doc.get(**cid).map(|n| n.tag == SvgTag::TSpan).unwrap_or(false))
        .copied()
        .collect();

    if tspan_children.is_empty() {
        // Flat text: single run from the text node's TextContent
        if let Some(content) = text_node.get_string(&AttrKey::TextContent) {
            if !content.is_empty() {
                return vec![TextRun {
                    content: content.to_string(),
                    style: parent_style,
                }];
            }
        }
        return vec![];
    }

    // TSpan children: one run per tspan
    let mut runs = Vec::new();
    for child_id in &tspan_children {
        if let Some(child) = doc.get(*child_id) {
            let style = TextStyle::from_node(child, &parent_style);
            if let Some(content) = child.get_string(&AttrKey::TextContent) {
                if !content.is_empty() {
                    runs.push(TextRun {
                        content: content.to_string(),
                        style,
                    });
                }
            }
        }
    }

    runs
}

fn parse_font_weight(s: &str) -> Option<u16> {
    match s {
        "normal" => Some(400),
        "bold" => Some(700),
        "lighter" => Some(300),
        "bolder" => Some(800),
        _ => s.parse::<u16>().ok(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_text_style() {
        let style = TextStyle::default();
        assert_eq!(style.font_family, "sans-serif");
        assert_eq!(style.font_size, 16.0);
        assert_eq!(style.font_weight, 400);
        assert_eq!(style.font_style, FontStyle::Normal);
        assert_eq!(style.letter_spacing, 0.0);
        assert_eq!(style.word_spacing, 0.0);
        assert_eq!(style.decoration, TextDecoration::None);
        assert_eq!(style.baseline_shift, 0.0);
    }

    #[test]
    fn from_node_inherits_parent() {
        let node = Node::new(SvgTag::TSpan);
        let parent = TextStyle {
            font_family: "Inter".into(),
            font_size: 24.0,
            font_weight: 700,
            ..TextStyle::default()
        };

        let style = TextStyle::from_node(&node, &parent);
        assert_eq!(style.font_family, "Inter");
        assert_eq!(style.font_size, 24.0);
        assert_eq!(style.font_weight, 700);
    }

    #[test]
    fn from_node_overrides_parent() {
        let mut node = Node::new(SvgTag::TSpan);
        node.set_attr(AttrKey::FontFamily, AttrValue::Str("Syne".into()));
        node.set_attr(AttrKey::FontSize, AttrValue::F32(32.0));
        node.set_attr(AttrKey::FontWeight, AttrValue::Str("400".into()));

        let parent = TextStyle {
            font_family: "Inter".into(),
            font_size: 24.0,
            font_weight: 700,
            ..TextStyle::default()
        };

        let style = TextStyle::from_node(&node, &parent);
        assert_eq!(style.font_family, "Syne");
        assert_eq!(style.font_size, 32.0);
        assert_eq!(style.font_weight, 400);
    }

    #[test]
    fn extract_flat_text() {
        let mut doc = Document::new();
        let root = doc.root;
        let mut text = Node::new(SvgTag::Text);
        text.set_attr(AttrKey::TextContent, AttrValue::Str("Hello World".into()));
        let text_id = text.id;
        doc.insert_node(root, 1, text);

        let runs = extract_text_runs(&doc, text_id);
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].content, "Hello World");
    }

    #[test]
    fn extract_tspan_children() {
        let mut doc = Document::new();
        let root = doc.root;

        let mut text = Node::new(SvgTag::Text);
        text.set_attr(AttrKey::FontFamily, AttrValue::Str("Inter".into()));
        text.set_attr(AttrKey::FontSize, AttrValue::F32(24.0));
        let text_id = text.id;
        doc.insert_node(root, 1, text);

        let mut ts1 = Node::new(SvgTag::TSpan);
        ts1.set_attr(AttrKey::FontWeight, AttrValue::Str("700".into()));
        ts1.set_attr(AttrKey::TextContent, AttrValue::Str("MARCUS".into()));
        let ts1_id = ts1.id;
        doc.insert_node(text_id, 0, ts1);

        let mut ts2 = Node::new(SvgTag::TSpan);
        ts2.set_attr(AttrKey::FontWeight, AttrValue::Str("400".into()));
        ts2.set_attr(AttrKey::TextContent, AttrValue::Str("VALENCIA".into()));
        let ts2_id = ts2.id;
        doc.insert_node(text_id, 1, ts2);

        let runs = extract_text_runs(&doc, text_id);
        assert_eq!(runs.len(), 2);
        assert_eq!(runs[0].content, "MARCUS");
        assert_eq!(runs[0].style.font_weight, 700);
        assert_eq!(runs[0].style.font_family, "Inter");
        assert_eq!(runs[0].style.font_size, 24.0);
        assert_eq!(runs[1].content, "VALENCIA");
        assert_eq!(runs[1].style.font_weight, 400);
    }

    #[test]
    fn extract_empty_text() {
        let mut doc = Document::new();
        let root = doc.root;
        let text = Node::new(SvgTag::Text);
        let text_id = text.id;
        doc.insert_node(root, 1, text);

        let runs = extract_text_runs(&doc, text_id);
        assert_eq!(runs.len(), 0);
    }
}
