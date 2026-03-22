//! MCP tool definitions for SVG OS.

use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::*,
    tool, tool_handler, tool_router,
    ErrorData as McpError,
    ServerHandler,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::engine;

#[derive(Debug, Clone)]
pub struct SvgMcpServer {
    tool_router: ToolRouter<Self>,
}

impl SvgMcpServer {
    pub fn new() -> Self {
        Self {
            tool_router: Self::tool_router(),
        }
    }
}

// ── Tool parameter types ─────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct RenderTemplateParams {
    /// SVG template string with data-bind attributes
    pub template_svg: String,
    /// Data object to bind into the template
    pub data: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct BatchRenderParams {
    /// SVG template string with data-bind attributes
    pub template_svg: String,
    /// Array of data objects, one per instance
    pub rows: Vec<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct GenerateDiagramParams {
    /// Graph definition: { nodes: [{id, label, ...}], edges: [{from, to}] }
    pub graph: serde_json::Value,
    /// Layout config: { direction?: "TopToBottom"|"LeftToRight", nodeGap?: number, layerGap?: number }
    #[serde(default)]
    pub config: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct EvalExpressionParams {
    /// Expression to evaluate (e.g., "$.score * 2 + 10")
    pub expression: String,
    /// Data object for field references ($.field)
    pub data: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct DescribeTemplateParams {
    /// SVG template string to analyze
    pub template_svg: String,
}

// ── Tool implementations ─────────────────────────────────────────────────

#[tool_router]
impl SvgMcpServer {
    #[tool(
        name = "render_template",
        description = "Render an SVG template with data bindings applied. Takes a template SVG string containing data-bind attributes and a data object. Returns the rendered SVG with all bindings resolved. Supports: data-bind (text content), data-bind-fill (fill color), data-bind-expr (expression evaluation), data-bind-attr-X (arbitrary attribute)."
    )]
    pub async fn render_template(
        &self,
        params: Parameters<RenderTemplateParams>,
    ) -> Result<CallToolResult, McpError> {
        match engine::render_template(&params.0.template_svg, &params.0.data) {
            Ok(svg) => Ok(CallToolResult::success(vec![Content::text(svg)])),
            Err(e) => Ok(CallToolResult::error(vec![Content::text(e)])),
        }
    }

    #[tool(
        name = "batch_render",
        description = "Render a template for each row of data. Takes a template SVG and an array of data objects. Returns a JSON array of rendered SVG strings, one per row. Expressions can use row_index() and row_count() for position-aware rendering (e.g., alternating row colors)."
    )]
    pub async fn batch_render(
        &self,
        params: Parameters<BatchRenderParams>,
    ) -> Result<CallToolResult, McpError> {
        match engine::batch_render(&params.0.template_svg, &params.0.rows) {
            Ok(svgs) => {
                let json = serde_json::to_string(&svgs).unwrap_or_else(|_| "[]".into());
                Ok(CallToolResult::success(vec![Content::text(json)]))
            }
            Err(e) => Ok(CallToolResult::error(vec![Content::text(e)])),
        }
    }

    #[tool(
        name = "generate_diagram",
        description = "Generate a diagram SVG from a graph definition. Takes nodes (with id, label, optional type/metadata) and edges (with from, to). Automatically creates styled nodes with ports, connects them with orthogonal connectors, and runs Sugiyama layered layout. Returns complete SVG string."
    )]
    pub async fn generate_diagram(
        &self,
        params: Parameters<GenerateDiagramParams>,
    ) -> Result<CallToolResult, McpError> {
        let config = params.0.config.unwrap_or(serde_json::json!({}));
        match engine::generate_diagram_svg(&params.0.graph, &config) {
            Ok(svg) => Ok(CallToolResult::success(vec![Content::text(svg)])),
            Err(e) => Ok(CallToolResult::error(vec![Content::text(e)])),
        }
    }

    #[tool(
        name = "eval_expression",
        description = "Evaluate an expression against a data object. Useful for testing expressions before embedding them in templates. Supports: arithmetic (+,-,*,/,%), comparison (==,!=,>,<), logic (&&,||,!), ternary (?:), field access ($.field), and 24 built-in functions (if, min, max, format, truncate, split, join, contains, etc.)."
    )]
    pub async fn eval_expression(
        &self,
        params: Parameters<EvalExpressionParams>,
    ) -> Result<CallToolResult, McpError> {
        match engine::eval_expression(&params.0.expression, &params.0.data) {
            Ok(result) => {
                let text = match result {
                    serde_json::Value::String(s) => s,
                    other => other.to_string(),
                };
                Ok(CallToolResult::success(vec![Content::text(text)]))
            }
            Err(e) => Ok(CallToolResult::error(vec![Content::text(e)])),
        }
    }

    #[tool(
        name = "describe_template",
        description = "Analyze an SVG template and return its bindable slots. Lists all data-bind attributes found, their field names, types (text, color, expression, attribute), and target SVG attributes. Use this to understand what data a template expects before calling render_template."
    )]
    pub async fn describe_template(
        &self,
        params: Parameters<DescribeTemplateParams>,
    ) -> Result<CallToolResult, McpError> {
        match engine::describe_template(&params.0.template_svg) {
            Ok(desc) => {
                let json = serde_json::to_string_pretty(&desc).unwrap_or_else(|_| "{}".into());
                Ok(CallToolResult::success(vec![Content::text(json)]))
            }
            Err(e) => Ok(CallToolResult::error(vec![Content::text(e)])),
        }
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for SvgMcpServer {
    fn get_info(&self) -> ServerInfo {
        let mut info = ServerInfo::default();
        info.instructions = Some(
            "SVG OS: A programmable visual document engine. \
             Render data-driven SVG templates, generate diagrams, \
             and evaluate expressions. Templates use data-bind attributes \
             for declarative data mapping and expressions for computed values."
                .into(),
        );
        info.capabilities = ServerCapabilities::builder().enable_tools().build();
        info
    }
}
