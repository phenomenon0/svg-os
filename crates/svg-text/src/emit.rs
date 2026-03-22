//! SVG emitter: converts ParagraphLayout into <tspan> children of a <text> node.

use svg_doc::{Document, NodeId, Node, SvgTag, AttrKey, AttrValue, TextStyle};
use crate::paragraph::{ParagraphLayout, PositionedRun};

/// Emit a paragraph layout as `<tspan>` children of a `<text>` element.
///
/// Replaces any existing `<tspan>` children and `TextContent` attribute.
/// Each `PositionedRun` becomes a `<tspan>` with explicit x/y positioning
/// and font attributes from its style.
pub fn emit_layout(
    layout: &ParagraphLayout,
    text_node_id: NodeId,
    doc: &mut Document,
) {
    // 1. Remove existing <tspan> children
    let children = doc.children(text_node_id);
    let tspan_ids: Vec<NodeId> = children
        .iter()
        .filter(|c| doc.get(**c).map(|n| n.tag == SvgTag::TSpan).unwrap_or(false))
        .copied()
        .collect();
    for id in tspan_ids {
        doc.remove_subtree(id);
    }

    // 2. Remove flat TextContent (text now lives in tspans)
    doc.remove_attr(text_node_id, &AttrKey::TextContent);

    // 3. Emit tspan for each positioned run
    let mut child_index = doc.children(text_node_id).len();

    for line in &layout.lines {
        for run in &line.runs {
            let mut tspan = Node::new(SvgTag::TSpan);

            // Position
            tspan.set_attr(AttrKey::X, AttrValue::F32(run.x));
            tspan.set_attr(AttrKey::Y, AttrValue::F32(line.y));

            // Font properties (only set if different from defaults to keep SVG compact)
            set_style_attrs(&mut tspan, &run.style);

            // Text content
            tspan.set_attr(AttrKey::TextContent, AttrValue::Str(run.text.clone()));

            doc.insert_node(text_node_id, child_index, tspan);
            child_index += 1;
        }
    }
}

/// Set font-related attributes on a tspan node from a TextStyle.
fn set_style_attrs(node: &mut Node, style: &TextStyle) {
    node.set_attr(AttrKey::FontFamily, AttrValue::Str(style.font_family.clone()));
    node.set_attr(AttrKey::FontSize, AttrValue::F32(style.font_size));

    let weight_str = match style.font_weight {
        400 => "normal",
        700 => "bold",
        _ => "",
    };
    if weight_str.is_empty() {
        node.set_attr(AttrKey::FontWeight, AttrValue::Str(style.font_weight.to_string()));
    } else {
        node.set_attr(AttrKey::FontWeight, AttrValue::Str(weight_str.into()));
    }

    match style.font_style {
        svg_doc::TextFontStyle::Italic => {
            node.set_attr(AttrKey::FontStyle, AttrValue::Str("italic".into()));
        }
        svg_doc::TextFontStyle::Oblique => {
            node.set_attr(AttrKey::FontStyle, AttrValue::Str("oblique".into()));
        }
        _ => {}
    }

    if style.letter_spacing != 0.0 {
        node.set_attr(AttrKey::LetterSpacing, AttrValue::F32(style.letter_spacing));
    }
    if style.word_spacing != 0.0 {
        node.set_attr(AttrKey::WordSpacing, AttrValue::F32(style.word_spacing));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use svg_doc::{Document, TextStyle, TextRun, TextAlign};
    use crate::{MockTextMeasure, TextMeasure};
    use crate::paragraph::{layout_paragraph, ParagraphConfig};

    fn mock() -> MockTextMeasure {
        MockTextMeasure::new(10.0)
    }

    fn style() -> TextStyle {
        TextStyle { font_size: 10.0, ..TextStyle::default() }
    }

    fn setup_text_node(doc: &mut Document) -> NodeId {
        let root = doc.root;
        let text = Node::new(SvgTag::Text);
        let text_id = text.id;
        doc.insert_node(root, 1, text);
        text_id
    }

    #[test]
    fn emit_single_line() {
        let mut doc = Document::new();
        let text_id = setup_text_node(&mut doc);

        let runs = vec![TextRun { content: "Hello".into(), style: style() }];
        let layout = layout_paragraph(&runs, &ParagraphConfig::default(), &mock());

        emit_layout(&layout, text_id, &mut doc);

        // Should have 1 tspan child
        let children = doc.children(text_id);
        let tspans: Vec<_> = children.iter()
            .filter(|c| doc.get(**c).map(|n| n.tag == SvgTag::TSpan).unwrap_or(false))
            .collect();
        assert_eq!(tspans.len(), 1);

        // Tspan should have correct text content
        let tspan = doc.get(*tspans[0]).unwrap();
        assert_eq!(tspan.get_string(&AttrKey::TextContent), Some("Hello"));
    }

    #[test]
    fn emit_multi_line() {
        let mut doc = Document::new();
        let text_id = setup_text_node(&mut doc);

        let runs = vec![TextRun { content: "Hello World Foo".into(), style: style() }];
        let config = ParagraphConfig { max_width: 40.0, ..Default::default() };
        let layout = layout_paragraph(&runs, &config, &mock());

        emit_layout(&layout, text_id, &mut doc);

        let children = doc.children(text_id);
        let tspans: Vec<_> = children.iter()
            .filter(|c| doc.get(**c).map(|n| n.tag == SvgTag::TSpan).unwrap_or(false))
            .collect();
        // Should have 3 lines (Hello / World / Foo)
        assert_eq!(tspans.len(), 3);

        // Each should have different y values
        let y0 = doc.get(*tspans[0]).unwrap().get_f32(&AttrKey::Y);
        let y1 = doc.get(*tspans[1]).unwrap().get_f32(&AttrKey::Y);
        let y2 = doc.get(*tspans[2]).unwrap().get_f32(&AttrKey::Y);
        assert!(y1 > y0);
        assert!(y2 > y1);
    }

    #[test]
    fn emit_mixed_styles() {
        let mut doc = Document::new();
        let text_id = setup_text_node(&mut doc);

        let runs = vec![
            TextRun {
                content: "Bold".into(),
                style: TextStyle { font_size: 10.0, font_weight: 700, ..TextStyle::default() },
            },
            TextRun {
                content: "Normal".into(),
                style: TextStyle { font_size: 10.0, font_weight: 400, ..TextStyle::default() },
            },
        ];
        let layout = layout_paragraph(&runs, &ParagraphConfig::default(), &mock());
        emit_layout(&layout, text_id, &mut doc);

        let children = doc.children(text_id);
        let tspans: Vec<NodeId> = children.iter()
            .filter(|c| doc.get(**c).map(|n| n.tag == SvgTag::TSpan).unwrap_or(false))
            .copied()
            .collect();
        assert_eq!(tspans.len(), 2);

        let bold_node = doc.get(tspans[0]).unwrap();
        assert_eq!(bold_node.get_string(&AttrKey::FontWeight), Some("bold"));

        let normal_node = doc.get(tspans[1]).unwrap();
        assert_eq!(normal_node.get_string(&AttrKey::FontWeight), Some("normal"));
    }

    #[test]
    fn emit_replaces_existing_content() {
        let mut doc = Document::new();
        let text_id = setup_text_node(&mut doc);

        // Set initial flat text content
        doc.set_attr(text_id, AttrKey::TextContent, AttrValue::Str("Old".into()));

        // Add an existing tspan child
        let old_tspan = Node::new(SvgTag::TSpan);
        doc.insert_node(text_id, 0, old_tspan);

        // Emit new layout (single word to get exactly 1 tspan)
        let runs = vec![TextRun { content: "New".into(), style: style() }];
        let layout = layout_paragraph(&runs, &ParagraphConfig::default(), &mock());
        emit_layout(&layout, text_id, &mut doc);

        // Old TextContent should be removed
        assert!(doc.get(text_id).unwrap().get_string(&AttrKey::TextContent).is_none());

        // Should have exactly 1 tspan (old one removed, new one added)
        let children = doc.children(text_id);
        let tspans: Vec<_> = children.iter()
            .filter(|c| doc.get(**c).map(|n| n.tag == SvgTag::TSpan).unwrap_or(false))
            .collect();
        assert_eq!(tspans.len(), 1);
        assert_eq!(doc.get(*tspans[0]).unwrap().get_string(&AttrKey::TextContent), Some("New"));
    }

    #[test]
    fn round_trip_extract_layout_emit() {
        let mut doc = Document::new();
        let text_id = setup_text_node(&mut doc);

        // Set up initial text with tspans
        let mut ts1 = Node::new(SvgTag::TSpan);
        ts1.set_attr(AttrKey::FontWeight, AttrValue::Str("700".into()));
        ts1.set_attr(AttrKey::TextContent, AttrValue::Str("Hello".into()));
        doc.insert_node(text_id, 0, ts1);

        let mut ts2 = Node::new(SvgTag::TSpan);
        ts2.set_attr(AttrKey::FontWeight, AttrValue::Str("400".into()));
        ts2.set_attr(AttrKey::TextContent, AttrValue::Str("World".into()));
        doc.insert_node(text_id, 1, ts2);

        // Set parent style
        doc.set_attr(text_id, AttrKey::FontFamily, AttrValue::Str("Inter".into()));
        doc.set_attr(text_id, AttrKey::FontSize, AttrValue::F32(10.0));

        // Extract → layout → emit
        let runs = svg_doc::extract_text_runs(&doc, text_id);
        assert_eq!(runs.len(), 2);
        assert_eq!(runs[0].content, "Hello");
        assert_eq!(runs[1].content, "World");

        let layout = layout_paragraph(&runs, &ParagraphConfig::default(), &mock());
        emit_layout(&layout, text_id, &mut doc);

        // Extract again — should get same content back
        let runs2 = svg_doc::extract_text_runs(&doc, text_id);
        assert_eq!(runs2.len(), 2);
        assert_eq!(runs2[0].content, "Hello");
        assert_eq!(runs2[1].content, "World");
    }
}
