use std::sync::Arc;

use async_trait::async_trait;
use svg_graph_engine::{ExecContext, NodeExecutor, Scheduler};

/// data:json — Pass-through: output = config.json parsed
pub struct JsonNodeExecutor;

#[async_trait]
impl NodeExecutor for JsonNodeExecutor {
    async fn execute(&self, ctx: &mut ExecContext, _node_id: &str) -> Result<(), String> {
        let raw = ctx
            .config
            .get("json")
            .and_then(|v| v.as_str())
            .unwrap_or("{}");
        let parsed: serde_json::Value =
            serde_json::from_str(raw).map_err(|e| e.to_string())?;
        ctx.set_output("data", parsed);
        Ok(())
    }
}

/// data:table — Pass-through: output = config.dataJson parsed as rows,
/// plus optional selected row from config.selectedRow.
pub struct TableNodeExecutor;

#[async_trait]
impl NodeExecutor for TableNodeExecutor {
    async fn execute(&self, ctx: &mut ExecContext, _node_id: &str) -> Result<(), String> {
        // Use input data if connected, otherwise use config
        let rows = if let Some(input) = ctx.get_input("data").cloned() {
            if input.is_array() {
                input
            } else {
                Self::parse_config_rows(&ctx.config)
            }
        } else {
            Self::parse_config_rows(&ctx.config)
        };

        ctx.set_output("rows", rows.clone());

        // Selected row
        if let Some(idx) = ctx.config.get("selectedRow").and_then(|v| v.as_u64()) {
            if let Some(arr) = rows.as_array() {
                if (idx as usize) < arr.len() {
                    ctx.set_output("selected", arr[idx as usize].clone());
                }
            }
        }

        Ok(())
    }
}

impl TableNodeExecutor {
    fn parse_config_rows(config: &serde_json::Value) -> serde_json::Value {
        let raw = config
            .get("dataJson")
            .and_then(|v| v.as_str())
            .unwrap_or("[]");
        serde_json::from_str(raw).unwrap_or(serde_json::Value::Array(vec![]))
    }
}

/// data:transform — Evaluate a JS expression on input data.
/// For now, just pass through input. Full JS eval via boa_engine can be added later.
pub struct TransformNodeExecutor;

#[async_trait]
impl NodeExecutor for TransformNodeExecutor {
    async fn execute(&self, ctx: &mut ExecContext, _node_id: &str) -> Result<(), String> {
        let input = ctx
            .get_input("input")
            .cloned()
            .unwrap_or(serde_json::Value::Null);

        // For now, pass through. Expression evaluation will be added with boa_engine.
        let _expression = ctx
            .config
            .get("expression")
            .and_then(|v| v.as_str())
            .unwrap_or("$.value");

        ctx.set_output("output", input);
        Ok(())
    }
}

/// data:filter — Filter array based on predicate expression.
/// For now, pass through. Predicate evaluation will be added with boa_engine.
pub struct FilterNodeExecutor;

#[async_trait]
impl NodeExecutor for FilterNodeExecutor {
    async fn execute(&self, ctx: &mut ExecContext, _node_id: &str) -> Result<(), String> {
        let input = ctx
            .get_input("input")
            .cloned()
            .unwrap_or(serde_json::Value::Array(vec![]));

        // Ensure we output an array
        if !input.is_array() {
            ctx.set_output("output", serde_json::Value::Array(vec![]));
            return Ok(());
        }

        // Pass through for now — predicate evaluation requires JS engine
        let _predicate = ctx
            .config
            .get("predicate")
            .and_then(|v| v.as_str())
            .unwrap_or("true");

        ctx.set_output("output", input);
        Ok(())
    }
}

/// data:merge — Shallow-merge two objects
pub struct MergeNodeExecutor;

#[async_trait]
impl NodeExecutor for MergeNodeExecutor {
    async fn execute(&self, ctx: &mut ExecContext, _node_id: &str) -> Result<(), String> {
        let a = ctx
            .get_input("a")
            .cloned()
            .unwrap_or(serde_json::Value::Object(Default::default()));
        let b = ctx
            .get_input("b")
            .cloned()
            .unwrap_or(serde_json::Value::Object(Default::default()));

        let mut result = match a {
            serde_json::Value::Object(m) => m,
            _ => serde_json::Map::new(),
        };
        if let serde_json::Value::Object(m) = b {
            for (k, v) in m {
                result.insert(k, v);
            }
        }

        ctx.set_output("merged", serde_json::Value::Object(result));
        Ok(())
    }
}

/// data:fetch — HTTP fetch via reqwest.
/// TODO: Add reqwest dependency and implement actual fetch.
pub struct FetchNodeExecutor;

#[async_trait]
impl NodeExecutor for FetchNodeExecutor {
    async fn execute(&self, ctx: &mut ExecContext, _node_id: &str) -> Result<(), String> {
        let input_url = ctx
            .get_input("url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let config_url = ctx
            .config
            .get("url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let url = if !input_url.is_empty() {
            input_url
        } else {
            config_url
        };

        if url.is_empty() {
            ctx.set_output(
                "response",
                serde_json::json!({ "error": "No URL" }),
            );
            return Ok(());
        }

        // Placeholder until reqwest is added as a dependency
        ctx.set_output(
            "response",
            serde_json::json!({
                "error": "fetch not yet implemented in native executor"
            }),
        );
        Ok(())
    }
}

/// view:note — Template interpolation with {{field}} placeholders
pub struct NoteNodeExecutor;

#[async_trait]
impl NodeExecutor for NoteNodeExecutor {
    async fn execute(&self, ctx: &mut ExecContext, _node_id: &str) -> Result<(), String> {
        let content = ctx
            .config
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        // Simple {{field}} interpolation from input data
        let input = ctx
            .get_input("data")
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        let mut output = content;

        if let serde_json::Value::Object(map) = &input {
            for (key, value) in map {
                let placeholder = format!("{{{{{}}}}}", key);
                let replacement = match value {
                    serde_json::Value::String(s) => s.clone(),
                    other => other.to_string(),
                };
                output = output.replace(&placeholder, &replacement);
            }
        }

        ctx.set_output("text", serde_json::Value::String(output));
        Ok(())
    }
}

/// view:svg-template — Merge config data with input data for SVG template rendering
pub struct SvgTemplateNodeExecutor;

#[async_trait]
impl NodeExecutor for SvgTemplateNodeExecutor {
    async fn execute(&self, ctx: &mut ExecContext, _node_id: &str) -> Result<(), String> {
        // Parse own data from config
        let mut own_data = ctx
            .config
            .get("data")
            .and_then(|v| v.as_str())
            .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
            .and_then(|v| match v {
                serde_json::Value::Object(m) => Some(m),
                _ => None,
            })
            .unwrap_or_default();

        // Merge input data on top
        if let Some(serde_json::Value::Object(input_map)) = ctx.get_input("data").cloned() {
            for (k, v) in input_map {
                own_data.insert(k, v);
            }
        }

        ctx.set_output("renderData", serde_json::Value::Object(own_data));
        Ok(())
    }
}

/// view:webview — Resolve URL from input or config
pub struct WebviewNodeExecutor;

#[async_trait]
impl NodeExecutor for WebviewNodeExecutor {
    async fn execute(&self, ctx: &mut ExecContext, _node_id: &str) -> Result<(), String> {
        let input_url = ctx
            .get_input("url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let config_url = ctx
            .config
            .get("url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let url = if !input_url.is_empty() {
            input_url
        } else {
            config_url
        };

        ctx.set_output("url", serde_json::Value::String(url));
        Ok(())
    }
}

/// view:metric — Resolve value and label for metric display
pub struct MetricNodeExecutor;

#[async_trait]
impl NodeExecutor for MetricNodeExecutor {
    async fn execute(&self, ctx: &mut ExecContext, _node_id: &str) -> Result<(), String> {
        let value = ctx
            .get_input("value")
            .cloned()
            .or_else(|| ctx.config.get("value").cloned())
            .unwrap_or(serde_json::json!(0));

        let label = ctx
            .get_input("label")
            .and_then(|v| v.as_str())
            .or_else(|| ctx.config.get("label").and_then(|v| v.as_str()))
            .unwrap_or("Value")
            .to_string();

        ctx.set_output(
            "display",
            serde_json::json!({ "value": value, "label": label }),
        );
        Ok(())
    }
}

/// view:chart — Pass chart data through (rendering delegated to canvas layer)
pub struct ChartNodeExecutor;

#[async_trait]
impl NodeExecutor for ChartNodeExecutor {
    async fn execute(&self, ctx: &mut ExecContext, _node_id: &str) -> Result<(), String> {
        let data = ctx
            .get_input("data")
            .cloned()
            .unwrap_or(serde_json::Value::Array(vec![]));
        ctx.set_output("chartData", data);
        Ok(())
    }
}

/// Register all native executors with the scheduler.
pub fn register_all_executors(scheduler: &mut Scheduler) {
    // Data subsystem
    scheduler.register_executor("data:json", Arc::new(JsonNodeExecutor));
    scheduler.register_executor("data:table", Arc::new(TableNodeExecutor));
    scheduler.register_executor("data:transform", Arc::new(TransformNodeExecutor));
    scheduler.register_executor("data:filter", Arc::new(FilterNodeExecutor));
    scheduler.register_executor("data:merge", Arc::new(MergeNodeExecutor));
    scheduler.register_executor("data:fetch", Arc::new(FetchNodeExecutor));

    // View subsystem
    scheduler.register_executor("view:note", Arc::new(NoteNodeExecutor));
    scheduler.register_executor("view:svg-template", Arc::new(SvgTemplateNodeExecutor));
    scheduler.register_executor("view:webview", Arc::new(WebviewNodeExecutor));
    scheduler.register_executor("view:metric", Arc::new(MetricNodeExecutor));
    scheduler.register_executor("view:chart", Arc::new(ChartNodeExecutor));
}
