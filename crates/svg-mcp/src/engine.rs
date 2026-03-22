//! Stateless engine workflows for MCP tool handlers.
//!
//! Each function creates a fresh document, performs the operation, and returns
//! the result. No session state, no thread-locals.

use svg_doc::{Document, doc_to_svg_string};
use svg_runtime::{
    BatchContext, CompiledExpr, EvalContext,
    generate_diagram,
};
use svg_layout::{ConnectorStore, LayeredLayoutConfig, LayoutDirection};
use serde::{Serialize, Deserialize};

/// Description of a template's bindable slots.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateDescription {
    pub slots: Vec<TemplateSlot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateSlot {
    pub field: String,
    pub bind_type: String,
    pub target_attr: String,
}

/// Render a template SVG with data bindings applied.
///
/// Parses the SVG, finds data-bind attributes, resolves them against
/// the provided data, and returns the modified SVG string.
/// After binding, runs text layout on any `<text>` elements to produce
/// positioned `<tspan>` children with word wrapping.
pub fn render_template(
    template_svg: &str,
    data: &serde_json::Value,
) -> Result<String, String> {
    let bound_svg = resolve_svg_bindings(template_svg, data, None)?;
    layout_text_in_svg(&bound_svg)
}

/// Render template for each row, returning a Vec of SVG strings.
pub fn batch_render(
    template_svg: &str,
    rows: &[serde_json::Value],
) -> Result<Vec<String>, String> {
    let row_count = rows.len();
    let mut results = Vec::with_capacity(row_count);
    for (i, row) in rows.iter().enumerate() {
        let batch = BatchContext { row_index: i, row_count };
        let bound_svg = resolve_svg_bindings(template_svg, row, Some(&batch))?;
        let svg = layout_text_in_svg(&bound_svg)?;
        results.push(svg);
    }
    Ok(results)
}

/// Generate a diagram from graph JSON.
pub fn generate_diagram_svg(
    graph: &serde_json::Value,
    config: &serde_json::Value,
) -> Result<String, String> {
    let mut doc = Document::new();
    let mut connectors = ConnectorStore::new();

    let direction = match config.get("direction").and_then(|v| v.as_str()) {
        Some("LeftToRight") => LayoutDirection::LeftToRight,
        _ => LayoutDirection::TopToBottom,
    };
    let node_gap = config.get("nodeGap").and_then(|v| v.as_f64()).unwrap_or(40.0) as f32;
    let layer_gap = config.get("layerGap").and_then(|v| v.as_f64()).unwrap_or(80.0) as f32;

    let layout_config = LayeredLayoutConfig {
        direction,
        node_gap,
        layer_gap,
        margin: (40.0, 40.0),
    };

    generate_diagram(&mut doc, &mut connectors, graph, &layout_config)
        .map_err(|e| e.to_string())?;

    Ok(doc_to_svg_string(&doc))
}

/// Evaluate an expression against data.
pub fn eval_expression(
    expr: &str,
    data: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let compiled = CompiledExpr::parse(expr)
        .map_err(|e| format!("Parse error: {}", e))?;

    let ctx = EvalContext {
        data,
        value: None,
        row_index: None,
        row_count: None,
    };

    let result = compiled.eval(&ctx)
        .map_err(|e| format!("Eval error: {}", e))?;

    Ok(result.to_json())
}

/// Describe what bindings a template expects.
pub fn describe_template(template_svg: &str) -> Result<TemplateDescription, String> {
    let slots = extract_bind_slots(template_svg)?;
    Ok(TemplateDescription { slots })
}

// ── Internal: SVG binding resolution via quick-xml ───────────────────────

/// Resolve data-bind attributes in an SVG string by direct XML manipulation.
fn resolve_svg_bindings(
    svg: &str,
    data: &serde_json::Value,
    batch: Option<&BatchContext>,
) -> Result<String, String> {
    use quick_xml::events::{Event, BytesStart, BytesText};
    use quick_xml::{Reader, Writer};
    use std::io::Cursor;

    let mut reader = Reader::from_str(svg);
    let mut writer = Writer::new(Cursor::new(Vec::new()));
    let mut buf = Vec::new();

    // Track pending text content replacement for current element
    let mut pending_text: Option<String> = None;
    let mut in_bound_element = false;
    let mut depth_at_bind = 0;
    let mut current_depth: usize = 0;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                current_depth += 1;
                let mut elem = BytesStart::from(e.name());
                let mut text_bind: Option<String> = None;

                // Process attributes, looking for data-bind-*
                for attr_result in e.attributes() {
                    let attr = attr_result.map_err(|e| format!("XML attr error: {}", e))?;
                    let key = std::str::from_utf8(attr.key.as_ref()).unwrap_or("");
                    let val = attr.unescape_value().map_err(|e| format!("XML unescape: {}", e))?;

                    if key == "data-bind" {
                        // Text content binding
                        text_bind = resolve_field_str(data, &val);
                    } else if key == "data-bind-expr" {
                        // Expression for text content
                        text_bind = eval_expr_str(&val, data, batch);
                    } else if key == "data-bind-fill" {
                        if let Some(v) = resolve_field_str(data, &val) {
                            elem.push_attribute(("fill", v.as_str()));
                        }
                    } else if key == "data-bind-stop" {
                        if let Some(v) = resolve_field_str(data, &val) {
                            elem.push_attribute(("stop-color", v.as_str()));
                        }
                    } else if let Some(target_attr) = key.strip_prefix("data-bind-attr-") {
                        if let Some(v) = resolve_field_str(data, &val) {
                            elem.push_attribute((target_attr, v.as_str()));
                        }
                    } else {
                        elem.push_attribute(attr);
                    }
                }

                writer.write_event(Event::Start(elem))
                    .map_err(|e| format!("XML write: {}", e))?;

                if let Some(text) = text_bind {
                    pending_text = Some(text);
                    in_bound_element = true;
                    depth_at_bind = current_depth;
                }
            }
            Ok(Event::End(ref e)) => {
                if in_bound_element && current_depth == depth_at_bind {
                    // Write the bound text content before closing
                    if let Some(ref text) = pending_text {
                        writer.write_event(Event::Text(BytesText::new(text)))
                            .map_err(|e| format!("XML write: {}", e))?;
                    }
                    pending_text = None;
                    in_bound_element = false;
                }
                current_depth = current_depth.saturating_sub(1);
                writer.write_event(Event::End(e.to_owned()))
                    .map_err(|e| format!("XML write: {}", e))?;
            }
            Ok(Event::Text(ref e)) => {
                if in_bound_element && current_depth == depth_at_bind {
                    // Skip original text content — we'll replace it at End
                } else {
                    writer.write_event(Event::Text(e.to_owned()))
                        .map_err(|e| format!("XML write: {}", e))?;
                }
            }
            Ok(Event::Empty(ref e)) => {
                let mut elem = BytesStart::from(e.name());

                for attr_result in e.attributes() {
                    let attr = attr_result.map_err(|e| format!("XML attr error: {}", e))?;
                    let key = std::str::from_utf8(attr.key.as_ref()).unwrap_or("");
                    let val = attr.unescape_value().map_err(|e| format!("XML unescape: {}", e))?;

                    if key == "data-bind-fill" {
                        if let Some(v) = resolve_field_str(data, &val) {
                            elem.push_attribute(("fill", v.as_str()));
                        }
                    } else if key == "data-bind-stop" {
                        if let Some(v) = resolve_field_str(data, &val) {
                            elem.push_attribute(("stop-color", v.as_str()));
                        }
                    } else if let Some(target_attr) = key.strip_prefix("data-bind-attr-") {
                        if let Some(v) = resolve_field_str(data, &val) {
                            elem.push_attribute((target_attr, v.as_str()));
                        }
                    } else if key == "data-bind" || key == "data-bind-expr" {
                        // Skip — self-closing elements can't have text content
                    } else {
                        elem.push_attribute(attr);
                    }
                }

                writer.write_event(Event::Empty(elem))
                    .map_err(|e| format!("XML write: {}", e))?;
            }
            Ok(Event::Eof) => break,
            Ok(e) => {
                writer.write_event(e)
                    .map_err(|err| format!("XML write: {}", err))?;
            }
            Err(e) => return Err(format!("XML parse error: {}", e)),
        }
        buf.clear();
    }

    let result = writer.into_inner().into_inner();
    String::from_utf8(result).map_err(|e| format!("UTF-8 error: {}", e))
}

/// Extract all data-bind slots from an SVG template.
fn extract_bind_slots(svg: &str) -> Result<Vec<TemplateSlot>, String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(svg);
    let mut buf = Vec::new();
    let mut slots = Vec::new();
    let mut seen = std::collections::HashSet::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) | Ok(Event::Empty(ref e)) => {
                for attr_result in e.attributes() {
                    if let Ok(attr) = attr_result {
                        let key = std::str::from_utf8(attr.key.as_ref()).unwrap_or("");
                        let val = attr.unescape_value().unwrap_or_default();

                        let slot = if key == "data-bind" {
                            Some(TemplateSlot {
                                field: val.to_string(),
                                bind_type: "text".into(),
                                target_attr: "text-content".into(),
                            })
                        } else if key == "data-bind-expr" {
                            Some(TemplateSlot {
                                field: val.to_string(),
                                bind_type: "expression".into(),
                                target_attr: "text-content".into(),
                            })
                        } else if key == "data-bind-fill" {
                            Some(TemplateSlot {
                                field: val.to_string(),
                                bind_type: "color".into(),
                                target_attr: "fill".into(),
                            })
                        } else if key == "data-bind-stop" {
                            Some(TemplateSlot {
                                field: val.to_string(),
                                bind_type: "color".into(),
                                target_attr: "stop-color".into(),
                            })
                        } else if let Some(target) = key.strip_prefix("data-bind-attr-") {
                            Some(TemplateSlot {
                                field: val.to_string(),
                                bind_type: "attribute".into(),
                                target_attr: target.to_string(),
                            })
                        } else {
                            None
                        };

                        if let Some(s) = slot {
                            let dedup_key = format!("{}:{}", s.field, s.target_attr);
                            if seen.insert(dedup_key) {
                                slots.push(s);
                            }
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error: {}", e)),
            _ => {}
        }
        buf.clear();
    }

    Ok(slots)
}

// ── Helpers ──────────────────────────────────────────────────────────────

fn resolve_field_str(data: &serde_json::Value, field: &str) -> Option<String> {
    let mut current = data;
    for part in field.split('.') {
        match current {
            serde_json::Value::Object(map) => current = map.get(part)?,
            serde_json::Value::Array(arr) => {
                let idx: usize = part.parse().ok()?;
                current = arr.get(idx)?;
            }
            _ => return None,
        }
    }
    Some(json_value_to_string(current))
}

fn json_value_to_string(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn eval_expr_str(expr: &str, data: &serde_json::Value, batch: Option<&BatchContext>) -> Option<String> {
    let compiled = CompiledExpr::parse(expr).ok()?;
    let ctx = EvalContext {
        data,
        value: None,
        row_index: batch.map(|b| b.row_index),
        row_count: batch.map(|b| b.row_count),
    };
    compiled.eval_to_string(&ctx).ok()
}

/// Post-process SVG to run text layout on <text> elements.
/// Parses the SVG into a Document, runs paragraph layout on text nodes,
/// emits <tspan> children, and re-serializes.
fn layout_text_in_svg(svg: &str) -> Result<String, String> {
    let mut doc = svg_doc::doc_from_svg_string(svg)
        .map_err(|e| format!("SVG parse error: {}", e))?;

    let measurer = svg_text::MockTextMeasure::new(16.0);

    // Walk all nodes, find <text> elements
    let text_nodes: Vec<svg_doc::NodeId> = doc.nodes.iter()
        .filter(|(_, n)| n.tag == svg_doc::SvgTag::Text)
        .map(|(id, _)| *id)
        .collect();

    for text_id in text_nodes {
        let runs = svg_doc::extract_text_runs(&doc, text_id);
        if runs.is_empty() {
            continue;
        }

        // Get the parent container width for wrapping (if available)
        let max_width = doc.get(text_id)
            .and_then(|n| n.parent)
            .and_then(|pid| doc.get(pid))
            .map(|p| p.get_f32(&svg_doc::AttrKey::Width))
            .filter(|w| *w > 0.0)
            .unwrap_or(f32::INFINITY);

        let config = svg_text::paragraph::ParagraphConfig {
            max_width: if max_width.is_finite() { max_width - 20.0 } else { f32::INFINITY },
            ..Default::default()
        };

        let layout = svg_text::paragraph::layout_paragraphs(&runs, &config, &measurer);
        svg_text::emit::emit_layout(&layout, text_id, &mut doc);
    }

    Ok(svg_doc::doc_to_svg_string(&doc))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn render_simple_template() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
  <text data-bind="name">Placeholder</text>
  <rect data-bind-fill="color" fill="#ccc" width="100" height="50"/>
</svg>"##;
        let data = json!({"name": "Alice", "color": "#ff0000"});
        let result = render_template(svg, &data).unwrap();
        assert!(result.contains("Alice"));
        assert!(result.contains(r##"fill="#ff0000""##));
        assert!(!result.contains("Placeholder"));
    }

    #[test]
    fn render_with_expression() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg">
  <text data-bind-expr="if($.score > 90, 'Excellent', 'Good')">?</text>
</svg>"#;
        let data = json!({"score": 95});
        let result = render_template(svg, &data).unwrap();
        assert!(result.contains("Excellent"));
    }

    #[test]
    fn render_attr_binding() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg">
  <rect data-bind-attr-width="w" width="10" height="50"/>
</svg>"#;
        let data = json!({"w": "200"});
        let result = render_template(svg, &data).unwrap();
        assert!(result.contains("width=\"200\""));
    }

    #[test]
    fn batch_render_produces_n_svgs() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg">
  <text data-bind="name">?</text>
</svg>"#;
        let rows = vec![json!({"name": "Alice"}), json!({"name": "Bob"}), json!({"name": "Carol"})];
        let results = batch_render(svg, &rows).unwrap();
        assert_eq!(results.len(), 3);
        assert!(results[0].contains("Alice"));
        assert!(results[1].contains("Bob"));
        assert!(results[2].contains("Carol"));
    }

    #[test]
    fn describe_finds_slots() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg">
  <text data-bind="name">?</text>
  <rect data-bind-fill="team_color" fill="#ccc"/>
  <image data-bind-attr-href="avatar_url"/>
</svg>"##;
        let desc = describe_template(svg).unwrap();
        assert_eq!(desc.slots.len(), 3);
        assert_eq!(desc.slots[0].field, "name");
        assert_eq!(desc.slots[1].field, "team_color");
        assert_eq!(desc.slots[2].field, "avatar_url");
    }

    #[test]
    fn eval_expression_works() {
        let result = eval_expression("$.a + $.b", &json!({"a": 1, "b": 2})).unwrap();
        assert_eq!(result, json!(3.0));
    }

    #[test]
    fn generate_diagram_works() {
        let graph = json!({
            "nodes": [
                {"id": "a", "label": "Node A"},
                {"id": "b", "label": "Node B"}
            ],
            "edges": [
                {"from": "a", "to": "b"}
            ]
        });
        let config = json!({"direction": "TopToBottom"});
        let svg = generate_diagram_svg(&graph, &config).unwrap();
        assert!(svg.contains("<svg"));
        assert!(svg.contains("Node A"));
    }
}
