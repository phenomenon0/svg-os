//! SVG OS CLI — simple command-line interface to the SVG OS engine.
//!
//! Usage:
//!   svg-os render <template.svg> <data.json>          Render template with data → stdout
//!   svg-os batch <template.svg> <rows.json> [dir]     Render each row → files in dir
//!   svg-os diagram <graph.json> [config.json]         Generate diagram → stdout
//!   svg-os eval '<expression>' [data.json]            Evaluate expression → stdout
//!   svg-os describe <template.svg>                    List bindable slots → stdout

mod engine;

use std::fs;
use std::process;

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.len() < 2 {
        print_usage();
        process::exit(1);
    }

    let result = match args[1].as_str() {
        "render" => cmd_render(&args[2..]),
        "batch" => cmd_batch(&args[2..]),
        "diagram" => cmd_diagram(&args[2..]),
        "eval" => cmd_eval(&args[2..]),
        "describe" => cmd_describe(&args[2..]),
        "help" | "--help" | "-h" => { print_usage(); Ok(()) }
        other => {
            eprintln!("Unknown command: {}", other);
            print_usage();
            process::exit(1);
        }
    };

    if let Err(e) = result {
        eprintln!("Error: {}", e);
        process::exit(1);
    }
}

fn cmd_render(args: &[String]) -> Result<(), String> {
    if args.len() < 2 {
        return Err("Usage: svg-os render <template.svg> <data.json>".into());
    }
    let template = fs::read_to_string(&args[0])
        .map_err(|e| format!("Failed to read {}: {}", args[0], e))?;
    let data_str = fs::read_to_string(&args[1])
        .map_err(|e| format!("Failed to read {}: {}", args[1], e))?;
    let data: serde_json::Value = serde_json::from_str(&data_str)
        .map_err(|e| format!("Invalid JSON in {}: {}", args[1], e))?;

    // If data is an array, use the first element
    let row = if let serde_json::Value::Array(arr) = &data {
        arr.first().cloned().unwrap_or(serde_json::Value::Null)
    } else {
        data
    };

    let svg = engine::render_template(&template, &row)?;
    println!("{}", svg);
    Ok(())
}

fn cmd_batch(args: &[String]) -> Result<(), String> {
    if args.len() < 2 {
        return Err("Usage: svg-os batch <template.svg> <rows.json> [output-dir]".into());
    }
    let template = fs::read_to_string(&args[0])
        .map_err(|e| format!("Failed to read {}: {}", args[0], e))?;
    let data_str = fs::read_to_string(&args[1])
        .map_err(|e| format!("Failed to read {}: {}", args[1], e))?;
    let rows: Vec<serde_json::Value> = serde_json::from_str(&data_str)
        .map_err(|e| format!("Invalid JSON array in {}: {}", args[1], e))?;

    let output_dir = args.get(2).map(|s| s.as_str()).unwrap_or(".");

    fs::create_dir_all(output_dir)
        .map_err(|e| format!("Failed to create {}: {}", output_dir, e))?;

    let results = engine::batch_render(&template, &rows)?;

    for (i, svg) in results.iter().enumerate() {
        let path = format!("{}/output-{:04}.svg", output_dir, i);
        fs::write(&path, svg)
            .map_err(|e| format!("Failed to write {}: {}", path, e))?;
        eprintln!("Wrote {}", path);
    }

    eprintln!("Rendered {} files", results.len());
    Ok(())
}

fn cmd_diagram(args: &[String]) -> Result<(), String> {
    if args.is_empty() {
        return Err("Usage: svg-os diagram <graph.json> [config.json]".into());
    }
    let graph_str = fs::read_to_string(&args[0])
        .map_err(|e| format!("Failed to read {}: {}", args[0], e))?;
    let graph: serde_json::Value = serde_json::from_str(&graph_str)
        .map_err(|e| format!("Invalid JSON in {}: {}", args[0], e))?;

    let config = if args.len() > 1 {
        let config_str = fs::read_to_string(&args[1])
            .map_err(|e| format!("Failed to read {}: {}", args[1], e))?;
        serde_json::from_str(&config_str)
            .map_err(|e| format!("Invalid JSON in {}: {}", args[1], e))?
    } else {
        serde_json::json!({})
    };

    let svg = engine::generate_diagram_svg(&graph, &config)?;
    println!("{}", svg);
    Ok(())
}

fn cmd_eval(args: &[String]) -> Result<(), String> {
    if args.is_empty() {
        return Err("Usage: svg-os eval '<expression>' [data.json]".into());
    }
    let expr = &args[0];
    let data = if args.len() > 1 {
        let data_str = fs::read_to_string(&args[1])
            .map_err(|e| format!("Failed to read {}: {}", args[1], e))?;
        let parsed: serde_json::Value = serde_json::from_str(&data_str)
            .map_err(|e| format!("Invalid JSON in {}: {}", args[1], e))?;
        // If array, use first element
        if let serde_json::Value::Array(arr) = &parsed {
            arr.first().cloned().unwrap_or(serde_json::json!({}))
        } else {
            parsed
        }
    } else {
        serde_json::json!({})
    };

    let result = engine::eval_expression(expr, &data)?;
    match result {
        serde_json::Value::String(s) => println!("{}", s),
        other => println!("{}", other),
    }
    Ok(())
}

fn cmd_describe(args: &[String]) -> Result<(), String> {
    if args.is_empty() {
        return Err("Usage: svg-os describe <template.svg>".into());
    }
    let template = fs::read_to_string(&args[0])
        .map_err(|e| format!("Failed to read {}: {}", args[0], e))?;

    let desc = engine::describe_template(&template)?;
    let json = serde_json::to_string_pretty(&desc)
        .map_err(|e| format!("JSON serialization error: {}", e))?;
    println!("{}", json);
    Ok(())
}

fn print_usage() {
    eprintln!("SVG OS — Programmable visual document engine");
    eprintln!();
    eprintln!("Usage:");
    eprintln!("  svg-os render <template.svg> <data.json>          Render template → stdout");
    eprintln!("  svg-os batch <template.svg> <rows.json> [dir]     Batch render → files");
    eprintln!("  svg-os diagram <graph.json> [config.json]         Generate diagram → stdout");
    eprintln!("  svg-os eval '<expression>' [data.json]            Evaluate expression");
    eprintln!("  svg-os describe <template.svg>                    List template slots");
    eprintln!();
    eprintln!("Examples:");
    eprintln!("  svg-os render card.svg data.json > output.svg");
    eprintln!("  svg-os batch card.svg rows.json ./cards/");
    eprintln!("  svg-os eval 'if($.score > 90, \"A\", \"B\")' data.json");
}
