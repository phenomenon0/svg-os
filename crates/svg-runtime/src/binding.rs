//! Data binding: map external data fields to SVG node attributes.

use svg_doc::{Document, NodeId, AttrKey, AttrValue};
use serde::{Serialize, Deserialize};
use serde_json::Value;

/// Where data comes from.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DataSource {
    /// JSON from a URL (fetched by the TS layer).
    Json {
        url: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        refresh_secs: Option<u32>,
    },
    /// CSV from a URL (parsed by the TS layer).
    Csv { url: String },
    /// Static inline data.
    Static { value: Value },
    /// Expression evaluated against current data context.
    Expression { expr: String },
}

/// Maps a data field to a node attribute.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldMapping {
    /// JSONPath-like selector into the data (e.g., "name", "stats.score").
    pub field: String,
    /// The SVG attribute to set.
    pub attr: String,
    /// Optional transform expression (e.g., "value + 'px'", "value * 2").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transform: Option<String>,
}

/// A binding between a data source and a document node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Binding {
    /// The data source.
    pub source: DataSource,
    /// Target node to bind data to.
    pub target: NodeId,
    /// How fields map to attributes.
    pub mappings: Vec<FieldMapping>,
    /// Fallback value if data is missing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback: Option<Value>,
}

/// The binding engine: manages all active data bindings.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BindingEngine {
    bindings: Vec<Binding>,
}

impl BindingEngine {
    pub fn new() -> Self {
        Self {
            bindings: Vec::new(),
        }
    }

    /// Register a new binding.
    pub fn bind(&mut self, binding: Binding) {
        self.bindings.push(binding);
    }

    /// Remove all bindings for a node.
    pub fn unbind(&mut self, node: NodeId) {
        self.bindings.retain(|b| b.target != node);
    }

    /// Get all bindings.
    pub fn bindings(&self) -> &[Binding] {
        &self.bindings
    }

    /// Evaluate all bindings against provided data, updating the document.
    ///
    /// `data` is a JSON object where keys match data source identifiers.
    /// For Static sources, the data is inline in the binding itself.
    pub fn evaluate(&self, doc: &mut Document, data: &Value) {
        for binding in &self.bindings {
            let source_data = match &binding.source {
                DataSource::Static { value } => value.clone(),
                DataSource::Json { url, .. } => {
                    // Look up data by URL key
                    data.get(url).cloned().unwrap_or(Value::Null)
                }
                DataSource::Csv { url } => {
                    data.get(url).cloned().unwrap_or(Value::Null)
                }
                DataSource::Expression { expr } => {
                    // Simple expression evaluation: just look up the field
                    resolve_field(data, expr).unwrap_or(Value::Null)
                }
            };

            let effective_data = if source_data.is_null() {
                binding.fallback.clone().unwrap_or(Value::Null)
            } else {
                source_data
            };

            if effective_data.is_null() {
                continue;
            }

            for mapping in &binding.mappings {
                let field_value = resolve_field(&effective_data, &mapping.field);

                if let Some(value) = field_value {
                    let attr_str = apply_transform(&value, &mapping.transform);
                    let attr_key = AttrKey::from_name(&mapping.attr);
                    let attr_value = AttrValue::parse(&attr_key, &attr_str);
                    doc.set_attr(binding.target, attr_key, attr_value);
                }
            }
        }
    }
}

/// Resolve a dot-separated field path in a JSON value.
/// E.g., "stats.score" resolves data["stats"]["score"].
fn resolve_field(data: &Value, path: &str) -> Option<Value> {
    let mut current = data;
    for part in path.split('.') {
        match current {
            Value::Object(map) => {
                current = map.get(part)?;
            }
            Value::Array(arr) => {
                let idx: usize = part.parse().ok()?;
                current = arr.get(idx)?;
            }
            _ => return None,
        }
    }
    Some(current.clone())
}

/// Apply a simple transform to a value.
fn apply_transform(value: &Value, transform: &Option<String>) -> String {
    let base = match value {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => String::new(),
        other => other.to_string(),
    };

    match transform {
        Some(expr) => {
            // Simple transforms: "value + 'suffix'", "value * N", etc.
            if expr.contains("+ '") || expr.contains("+ \"") {
                // String concatenation: extract suffix
                let suffix = expr
                    .split('\'')
                    .nth(1)
                    .or_else(|| expr.split('"').nth(1))
                    .unwrap_or("");
                format!("{}{}", base, suffix)
            } else if expr.contains("'") && expr.contains("+ value") {
                // Prefix + value
                let prefix = expr.split('\'').nth(1).unwrap_or("");
                format!("{}{}", prefix, base)
            } else if let Some(stripped) = expr.strip_prefix("value * ") {
                // Multiplication
                if let (Ok(v), Ok(m)) = (base.parse::<f64>(), stripped.parse::<f64>()) {
                    format_f64(v * m)
                } else {
                    base
                }
            } else {
                base
            }
        }
        None => base,
    }
}

fn format_f64(v: f64) -> String {
    if v == v.floor() && v.abs() < 1e9 {
        format!("{}", v as i64)
    } else {
        format!("{:.4}", v).trim_end_matches('0').trim_end_matches('.').to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use svg_doc::{Node, SvgTag};
    use serde_json::json;

    #[test]
    fn resolve_nested_field() {
        let data = json!({
            "player": {
                "name": "Alice",
                "stats": { "score": 42 }
            }
        });

        let name = resolve_field(&data, "player.name").unwrap();
        assert_eq!(name, json!("Alice"));

        let score = resolve_field(&data, "player.stats.score").unwrap();
        assert_eq!(score, json!(42));
    }

    #[test]
    fn evaluate_static_binding() {
        let mut doc = Document::new();
        let root = doc.root;
        let mut text = Node::new(SvgTag::Text);
        text.set_attr(AttrKey::X, AttrValue::F32(10.0));
        let text_id = text.id;
        doc.insert_node(root, 1, text);

        let mut engine = BindingEngine::new();
        engine.bind(Binding {
            source: DataSource::Static {
                value: json!({ "label": "Hello World" }),
            },
            target: text_id,
            mappings: vec![FieldMapping {
                field: "label".to_string(),
                attr: "data-text-content".to_string(),
                transform: None,
            }],
            fallback: None,
        });

        engine.evaluate(&mut doc, &json!({}));

        let node = doc.get(text_id).unwrap();
        assert_eq!(
            node.get_string(&AttrKey::TextContent),
            Some("Hello World")
        );
    }

    #[test]
    fn evaluate_with_transform() {
        let value = json!(100);
        let result = apply_transform(&value, &Some("value * 2".to_string()));
        assert_eq!(result, "200");
    }

    #[test]
    fn evaluate_string_concat() {
        let value = json!(42);
        let result = apply_transform(&value, &Some("value + 'px'".to_string()));
        assert_eq!(result, "42px");
    }
}
