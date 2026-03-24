//! Data binding: map external data fields to SVG node attributes.

use svg_doc::{Document, NodeId, AttrKey, AttrValue};
use serde::{Serialize, Deserialize};
use serde_json::Value;
use std::collections::HashMap;

use crate::expr::{CompiledExpr, EvalContext};

/// Batch rendering context passed to expressions for row_index()/row_count().
#[derive(Debug, Clone, Copy)]
pub struct BatchContext {
    pub row_index: usize,
    pub row_count: usize,
}

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
    /// AI-powered transform: input comes from upstream, processed by LLM.
    /// Evaluated asynchronously by the TypeScript layer.
    AiTransform {
        /// Prompt template with {{field}} interpolation.
        prompt_template: String,
        /// Optional model override.
        #[serde(skip_serializing_if = "Option::is_none")]
        model: Option<String>,
        /// Optional max tokens.
        #[serde(skip_serializing_if = "Option::is_none")]
        max_tokens: Option<u32>,
        /// Expected output JSON schema (hint for the LLM).
        #[serde(skip_serializing_if = "Option::is_none")]
        output_schema: Option<Value>,
    },
}

/// Maps a data field to a node attribute.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldMapping {
    /// JSONPath-like selector into the data (e.g., "name", "stats.score").
    /// Ignored when `expr` is set.
    #[serde(default)]
    pub field: String,
    /// The SVG attribute to set.
    pub attr: String,
    /// Optional transform expression applied to the resolved field value.
    /// The `value` keyword refers to the resolved field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transform: Option<String>,
    /// Full expression (replaces field+transform). When set, `field` is ignored
    /// and the expression has full access to the data via `$`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expr: Option<String>,
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

/// A pending AI evaluation that needs to be resolved by the TypeScript layer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingAiEval {
    /// The node that needs AI evaluation.
    pub node_id: NodeId,
    /// Input data available to the AI prompt.
    pub input_data: Value,
    /// AI transform configuration.
    pub prompt_template: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_schema: Option<Value>,
}

/// The binding engine: manages all active data bindings.
#[derive(Debug, Clone, Default)]
pub struct BindingEngine {
    bindings: Vec<Binding>,
    /// Cache of compiled expressions keyed by source string.
    expr_cache: HashMap<String, CompiledExpr>,
    /// Computed data per node (populated by evaluate_with_flow).
    node_data: HashMap<NodeId, Value>,
    /// Pending AI evaluations (populated during evaluate_with_flow).
    pending_ai: Vec<PendingAiEval>,
}

// Custom Serialize/Deserialize that skips expr_cache
impl Serialize for BindingEngine {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.bindings.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for BindingEngine {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let bindings = Vec::<Binding>::deserialize(deserializer)?;
        Ok(Self { bindings, expr_cache: HashMap::new(), node_data: HashMap::new(), pending_ai: Vec::new() })
    }
}

impl BindingEngine {
    pub fn new() -> Self {
        Self {
            bindings: Vec::new(),
            expr_cache: HashMap::new(),
            pending_ai: Vec::new(),
            node_data: HashMap::new(),
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

    /// Get the set of node IDs that have bindings targeting them.
    pub fn bound_node_ids(&self) -> std::collections::HashSet<svg_doc::NodeId> {
        self.bindings.iter().map(|b| b.target).collect()
    }

    /// Pre-compile all expressions in registered bindings.
    /// Call once before evaluate() in batch scenarios for performance.
    pub fn compile_expressions(&mut self) {
        let mut to_compile: Vec<String> = Vec::new();
        for binding in &self.bindings {
            if let DataSource::Expression { expr } = &binding.source {
                to_compile.push(expr.clone());
            }
            for mapping in &binding.mappings {
                if let Some(expr) = &mapping.expr {
                    to_compile.push(expr.clone());
                }
                if let Some(transform) = &mapping.transform {
                    to_compile.push(transform.clone());
                }
            }
        }
        for expr_str in to_compile {
            if !self.expr_cache.contains_key(&expr_str) {
                if let Ok(compiled) = CompiledExpr::parse(&expr_str) {
                    self.expr_cache.insert(expr_str, compiled);
                }
            }
        }
    }

    fn get_or_compile(&self, expr_str: &str) -> Option<CompiledExpr> {
        if let Some(cached) = self.expr_cache.get(expr_str) {
            return Some(cached.clone());
        }
        CompiledExpr::parse(expr_str).ok()
    }

    /// Evaluate all bindings against provided data, updating the document.
    pub fn evaluate(&self, doc: &mut Document, data: &Value) {
        self.evaluate_with_context(doc, data, None);
    }

    /// Evaluate bindings with optional batch context for row_index()/row_count().
    pub fn evaluate_with_context(
        &self,
        doc: &mut Document,
        data: &Value,
        batch: Option<&BatchContext>,
    ) {
        let row_index = batch.map(|b| b.row_index);
        let row_count = batch.map(|b| b.row_count);

        for binding in &self.bindings {
            let source_data = match &binding.source {
                DataSource::Static { value } => value.clone(),
                DataSource::Json { url, .. } => {
                    data.get(url).cloned().unwrap_or(Value::Null)
                }
                DataSource::Csv { url } => {
                    data.get(url).cloned().unwrap_or(Value::Null)
                }
                DataSource::Expression { expr } => {
                    if let Some(compiled) = self.get_or_compile(expr) {
                        let ctx = EvalContext {
                            data,
                            value: None,
                            row_index,
                            row_count,
                        };
                        match compiled.eval(&ctx) {
                            Ok(val) => val.to_json(),
                            Err(_) => resolve_field(data, expr).unwrap_or(Value::Null),
                        }
                    } else {
                        resolve_field(data, expr).unwrap_or(Value::Null)
                    }
                }
                DataSource::AiTransform { .. } => {
                    // AI transforms are handled in evaluate_with_flow, not here.
                    // Skip this binding in simple evaluate context.
                    continue;
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
                let attr_str = if let Some(expr_str) = &mapping.expr {
                    if let Some(compiled) = self.get_or_compile(expr_str) {
                        let ctx = EvalContext {
                            data: &effective_data,
                            value: None,
                            row_index,
                            row_count,
                        };
                        match compiled.eval_to_string(&ctx) {
                            Ok(s) => s,
                            Err(e) => {
                                log::warn!("Expression error in '{}': {}", expr_str, e);
                                continue;
                            }
                        }
                    } else {
                        log::warn!("Failed to parse expression: {}", expr_str);
                        continue;
                    }
                } else {
                    let field_value = resolve_field(&effective_data, &mapping.field);
                    match field_value {
                        Some(value) => self.apply_transform_with_ctx(
                            &effective_data, &value, &mapping.transform, row_index, row_count,
                        ),
                        None => continue,
                    }
                };

                let attr_key = AttrKey::from_name(&mapping.attr);
                let attr_value = AttrValue::parse(&attr_key, &attr_str);
                doc.set_attr(binding.target, attr_key, attr_value);
            }
        }
    }

    fn apply_transform_with_ctx(
        &self,
        data: &Value,
        field_value: &Value,
        transform: &Option<String>,
        row_index: Option<usize>,
        row_count: Option<usize>,
    ) -> String {
        let base = value_to_string(field_value);

        match transform {
            None => base,
            Some(expr_str) => {
                if let Some(compiled) = self.get_or_compile(expr_str) {
                    let ctx = EvalContext {
                        data,
                        value: Some(field_value),
                        row_index,
                        row_count,
                    };
                    match compiled.eval_to_string(&ctx) {
                        Ok(s) => s,
                        Err(_) => base,
                    }
                } else {
                    base
                }
            }
        }
    }

    // ── Data flow methods ────────────────────────────────────────────

    /// Get computed data for a node (populated by evaluate_with_flow).
    pub fn get_node_data(&self, node: NodeId) -> Option<&Value> {
        self.node_data.get(&node)
    }

    /// Clear all computed node data.
    pub fn clear_node_data(&mut self) {
        self.node_data.clear();
    }

    /// Set node data directly (used to resolve AI transforms).
    pub fn set_node_data(&mut self, node: NodeId, data: Value) {
        self.node_data.insert(node, data);
    }

    /// Get pending AI evaluations (populated by evaluate_with_flow).
    pub fn pending_ai_evals(&self) -> &[PendingAiEval] {
        &self.pending_ai
    }

    /// Take and clear pending AI evaluations.
    pub fn take_pending_ai_evals(&mut self) -> Vec<PendingAiEval> {
        std::mem::take(&mut self.pending_ai)
    }

    /// Evaluate bindings with data flowing through connectors.
    ///
    /// 1. Topologically sorts nodes by connector graph
    /// 2. For each node, gathers upstream data via incoming connectors
    /// 3. Merges upstream data with the node's own data source
    /// 4. Evaluates bindings with the merged context
    /// 5. Stores the result for downstream nodes
    pub fn evaluate_with_flow(
        &mut self,
        doc: &mut Document,
        external_data: &Value,
        connectors: &svg_layout::ConnectorStore,
    ) {
        // Preserve node_data for AI transform nodes (resolved externally).
        // Clear data for all other nodes.
        let ai_node_ids: std::collections::HashSet<NodeId> = self.bindings.iter()
            .filter(|b| matches!(b.source, DataSource::AiTransform { .. }))
            .map(|b| b.target)
            .collect();
        self.node_data.retain(|id, _| ai_node_ids.contains(id));
        self.pending_ai.clear();

        // Collect all bound node IDs
        let bound_nodes: Vec<NodeId> = self.bindings.iter().map(|b| b.target).collect();

        // Topological sort
        let order = connectors.topological_order(&bound_nodes);

        // Build a map from NodeId to binding index to avoid cloning all bindings
        let binding_index: HashMap<NodeId, usize> = self.bindings.iter()
            .enumerate()
            .map(|(i, b)| (b.target, i))
            .collect();

        for node_id in &order {
            // Find binding for this node; clone individual binding to release borrow on self
            let bind_idx = match binding_index.get(node_id) {
                Some(i) => *i,
                None => continue,
            };
            let binding = self.bindings[bind_idx].clone();

            // Gather upstream data from incoming connectors
            let incoming = connectors.incoming(*node_id);
            let mut input_data = serde_json::Map::new();
            for conn in &incoming {
                if matches!(conn.data_flow, svg_layout::DataFlow::None) {
                    continue;
                }
                let source_data = self.node_data.get(&conn.from.0)
                    .cloned()
                    .unwrap_or(Value::Null);

                let flow_data = match &conn.data_flow {
                    svg_layout::DataFlow::PassThrough => source_data,
                    svg_layout::DataFlow::Field(path) => {
                        resolve_field(&source_data, path).unwrap_or(Value::Null)
                    }
                    svg_layout::DataFlow::Expression(expr) => {
                        if let Some(compiled) = self.get_or_compile(expr) {
                            let ctx = EvalContext {
                                data: &source_data,
                                value: None,
                                row_index: None,
                                row_count: None,
                            };
                            compiled.eval(&ctx)
                                .map(|v| v.to_json())
                                .unwrap_or(Value::Null)
                        } else {
                            Value::Null
                        }
                    }
                    svg_layout::DataFlow::None => continue,
                };

                input_data.insert(conn.to.1.clone(), flow_data);
            }

            // Resolve own data source
            let own_data = match &binding.source {
                DataSource::Static { value } => value.clone(),
                DataSource::Json { url, .. } => {
                    external_data.get(url).cloned().unwrap_or(Value::Null)
                }
                DataSource::Csv { url } => {
                    external_data.get(url).cloned().unwrap_or(Value::Null)
                }
                DataSource::Expression { expr } => {
                    if let Some(compiled) = self.get_or_compile(expr) {
                        let ctx = EvalContext {
                            data: external_data,
                            value: None,
                            row_index: None,
                            row_count: None,
                        };
                        compiled.eval(&ctx)
                            .map(|v| v.to_json())
                            .unwrap_or(Value::Null)
                    } else {
                        resolve_field(external_data, expr).unwrap_or(Value::Null)
                    }
                }
                DataSource::AiTransform { prompt_template, model, max_tokens, output_schema } => {
                    // Build input from upstream data
                    let ai_input = if input_data.is_empty() {
                        external_data.clone()
                    } else {
                        Value::Object(input_data)
                    };

                    // Store as pending — TS layer will resolve asynchronously
                    self.pending_ai.push(PendingAiEval {
                        node_id: *node_id,
                        input_data: ai_input,
                        prompt_template: prompt_template.clone(),
                        model: model.clone(),
                        max_tokens: *max_tokens,
                        output_schema: output_schema.clone(),
                    });

                    // Skip normal binding evaluation for this node.
                    // If previously resolved, node_data already has the result
                    // and downstream nodes can use it.
                    continue;
                }
            };

            let effective_data = if own_data.is_null() {
                binding.fallback.clone().unwrap_or(Value::Null)
            } else {
                own_data
            };

            // Build merged context: own data + _input from upstream
            let merged = if input_data.is_empty() {
                effective_data.clone()
            } else {
                let mut obj = match effective_data.clone() {
                    Value::Object(m) => m,
                    _ => serde_json::Map::new(),
                };
                obj.insert("_input".into(), Value::Object(input_data));
                Value::Object(obj)
            };

            // Evaluate bindings against merged context
            if !merged.is_null() {
                for mapping in &binding.mappings {
                    let attr_str = if let Some(expr_str) = &mapping.expr {
                        if let Some(compiled) = self.get_or_compile(expr_str) {
                            let ctx = EvalContext {
                                data: &merged,
                                value: None,
                                row_index: None,
                                row_count: None,
                            };
                            match compiled.eval_to_string(&ctx) {
                                Ok(s) => s,
                                Err(e) => {
                                    log::warn!("Expression error in '{}': {}", expr_str, e);
                                    continue;
                                }
                            }
                        } else {
                            log::warn!("Failed to parse expression: {}", expr_str);
                            continue;
                        }
                    } else {
                        let field_value = resolve_field(&merged, &mapping.field);
                        match field_value {
                            Some(value) => {
                                let base = value_to_string(&value);
                                match &mapping.transform {
                                    None => base,
                                    Some(expr_str) => {
                                        if let Some(compiled) = self.get_or_compile(expr_str) {
                                            let ctx = EvalContext {
                                                data: &merged,
                                                value: Some(&value),
                                                row_index: None,
                                                row_count: None,
                                            };
                                            compiled.eval_to_string(&ctx).unwrap_or(base)
                                        } else {
                                            base
                                        }
                                    }
                                }
                            }
                            None => continue,
                        }
                    };

                    let attr_key = AttrKey::from_name(&mapping.attr);
                    let attr_value = AttrValue::parse(&attr_key, &attr_str);
                    doc.set_attr(*node_id, attr_key, attr_value);
                }
            }

            // Store merged data for downstream nodes
            self.node_data.insert(*node_id, merged);
        }
    }
}

/// Resolve a dot-separated field path in a JSON value.
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

fn value_to_string(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => String::new(),
        other => other.to_string(),
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
                expr: None,
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
        let mut doc = Document::new();
        let root = doc.root;
        let mut rect = Node::new(SvgTag::Rect);
        rect.set_attr(AttrKey::Width, AttrValue::F32(50.0));
        let rect_id = rect.id;
        doc.insert_node(root, 1, rect);

        let mut engine = BindingEngine::new();
        engine.bind(Binding {
            source: DataSource::Static {
                value: json!({ "w": 100 }),
            },
            target: rect_id,
            mappings: vec![FieldMapping {
                field: "w".to_string(),
                attr: "width".to_string(),
                transform: Some("value * 2".to_string()),
                expr: None,
            }],
            fallback: None,
        });

        engine.evaluate(&mut doc, &json!({}));
        assert_eq!(doc.get(rect_id).unwrap().get_f32(&AttrKey::Width), 200.0);
    }

    #[test]
    fn evaluate_string_concat_transform() {
        let mut doc = Document::new();
        let root = doc.root;
        let mut text = Node::new(SvgTag::Text);
        let text_id = text.id;
        doc.insert_node(root, 1, text);

        let mut engine = BindingEngine::new();
        engine.bind(Binding {
            source: DataSource::Static {
                value: json!({ "n": 42 }),
            },
            target: text_id,
            mappings: vec![FieldMapping {
                field: "n".to_string(),
                attr: "data-text-content".to_string(),
                transform: Some("value + 'px'".to_string()),
                expr: None,
            }],
            fallback: None,
        });

        engine.evaluate(&mut doc, &json!({}));
        assert_eq!(
            doc.get(text_id).unwrap().get_string(&AttrKey::TextContent),
            Some("42px")
        );
    }

    #[test]
    fn evaluate_expr_field() {
        let mut doc = Document::new();
        let root = doc.root;
        let mut rect = Node::new(SvgTag::Rect);
        let rect_id = rect.id;
        doc.insert_node(root, 1, rect);

        let mut engine = BindingEngine::new();
        engine.bind(Binding {
            source: DataSource::Static {
                value: json!({ "score": 95, "max": 100 }),
            },
            target: rect_id,
            mappings: vec![FieldMapping {
                field: String::new(),
                attr: "width".to_string(),
                transform: None,
                expr: Some("$.score / $.max * 200".to_string()),
            }],
            fallback: None,
        });

        engine.evaluate(&mut doc, &json!({}));
        assert_eq!(doc.get(rect_id).unwrap().get_f32(&AttrKey::Width), 190.0);
    }

    #[test]
    fn evaluate_expr_conditional_fill() {
        let mut doc = Document::new();
        let root = doc.root;
        let mut rect = Node::new(SvgTag::Rect);
        let rect_id = rect.id;
        doc.insert_node(root, 1, rect);

        let mut engine = BindingEngine::new();
        engine.bind(Binding {
            source: DataSource::Static {
                value: json!({ "rating": 92 }),
            },
            target: rect_id,
            mappings: vec![FieldMapping {
                field: String::new(),
                attr: "fill".to_string(),
                transform: None,
                expr: Some("if($.rating > 90, '#gold', '#silver')".to_string()),
            }],
            fallback: None,
        });

        engine.evaluate(&mut doc, &json!({}));
        let fill = doc.get(rect_id).unwrap().get_attr(&AttrKey::Fill);
        assert!(fill.is_some());
    }

    #[test]
    fn compile_expressions_caches() {
        let mut engine = BindingEngine::new();
        engine.bind(Binding {
            source: DataSource::Static { value: json!({"x": 1}) },
            target: NodeId::new(),
            mappings: vec![
                FieldMapping {
                    field: String::new(),
                    attr: "width".to_string(),
                    transform: None,
                    expr: Some("$.x * 2".to_string()),
                },
                FieldMapping {
                    field: "x".to_string(),
                    attr: "height".to_string(),
                    transform: Some("value + 10".to_string()),
                    expr: None,
                },
            ],
            fallback: None,
        });

        engine.compile_expressions();
        assert!(engine.expr_cache.contains_key("$.x * 2"));
        assert!(engine.expr_cache.contains_key("value + 10"));
    }
}
