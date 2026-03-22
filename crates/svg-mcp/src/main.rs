//! SVG OS MCP Server — Model Context Protocol interface for the SVG OS engine.
//!
//! Exposes 5 tools for AI agent consumption:
//! - render_template: Render SVG template with data bindings
//! - batch_render: Render template for each row of data
//! - generate_diagram: Create diagram from graph definition
//! - eval_expression: Evaluate expressions against data
//! - describe_template: Analyze template binding slots

mod engine;
mod tools;

use rmcp::{transport::stdio, ServiceExt};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let server = tools::SvgMcpServer::new();
    let service = server.serve(stdio()).await.inspect_err(|e| {
        eprintln!("svg-mcp server error: {}", e);
    })?;
    service.waiting().await?;
    Ok(())
}
