//! Native code execution via subprocess.

use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Serialize, Deserialize)]
pub struct ExecResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

#[tauri::command]
pub async fn exec_run(
    lang: String,
    code: String,
    cwd: Option<String>,
    stdin: Option<String>,
) -> Result<ExecResult, String> {
    let work_dir = cwd.unwrap_or_else(|| {
        std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string())
    });

    let result = match lang.as_str() {
        "javascript" | "js" | "node" => {
            run_command("node", &["-e", &code], &work_dir, stdin.as_deref())
        }
        "python" | "python3" | "py" => {
            run_command("python3", &["-c", &code], &work_dir, stdin.as_deref())
        }
        "ruby" | "rb" => {
            run_command("ruby", &["-e", &code], &work_dir, stdin.as_deref())
        }
        "bash" | "sh" => {
            run_command("bash", &["-c", &code], &work_dir, stdin.as_deref())
        }
        "c" => compile_and_run("gcc", &code, &work_dir, stdin.as_deref()),
        "cpp" | "c++" => compile_and_run("g++", &code, &work_dir, stdin.as_deref()),
        "sql" | "sqlite" | "sqlite3" => {
            run_command("sqlite3", &[":memory:"], &work_dir, Some(&code))
        }
        "php" => run_command("php", &["-r", &code], &work_dir, stdin.as_deref()),
        _ => Err(format!("Unsupported language: {}", lang)),
    };

    result
}

#[tauri::command]
pub async fn exec_run_repl(
    lang: String,
    code: String,
    context_json: Option<String>,
) -> Result<ExecResult, String> {
    let wrapped = match lang.as_str() {
        "python" | "python3" | "py" => {
            if let Some(ctx) = &context_json {
                format!("import json\n__ctx = json.loads('{}')\nfor k,v in __ctx.items(): globals()[k] = v\n{}", ctx.replace('\'', "\\'"), code)
            } else {
                code.clone()
            }
        }
        "javascript" | "js" | "node" => {
            if let Some(ctx) = &context_json {
                format!("const __ctx = JSON.parse('{}');\nObject.assign(globalThis, __ctx);\n{}", ctx.replace('\'', "\\'"), code)
            } else {
                code.clone()
            }
        }
        _ => code.clone(),
    };

    exec_run(lang, wrapped, None, None).await
}

fn run_command(
    program: &str,
    args: &[&str],
    cwd: &str,
    stdin_data: Option<&str>,
) -> Result<ExecResult, String> {
    let mut cmd = Command::new(program);
    cmd.args(args).current_dir(cwd);
    cmd.env("PYTHONIOENCODING", "utf-8");
    cmd.env("NODE_OPTIONS", "--no-warnings");

    if let Some(data) = stdin_data {
        use std::process::Stdio;
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| e.to_string())?;
        if let Some(mut child_stdin) = child.stdin.take() {
            use std::io::Write;
            let _ = child_stdin.write_all(data.as_bytes());
        }
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        Ok(ExecResult {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code().unwrap_or(-1),
        })
    } else {
        let output = cmd.output().map_err(|e| e.to_string())?;
        Ok(ExecResult {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code().unwrap_or(-1),
        })
    }
}

fn compile_and_run(
    compiler: &str,
    code: &str,
    cwd: &str,
    stdin_data: Option<&str>,
) -> Result<ExecResult, String> {
    let tmp = std::env::temp_dir();
    let id = uuid::Uuid::new_v4();
    let src_ext = if compiler == "g++" { "cpp" } else { "c" };
    let src_path = tmp.join(format!("svgos_{}.{}", id, src_ext));
    let bin_path = tmp.join(format!("svgos_{}", id));

    std::fs::write(&src_path, code).map_err(|e| e.to_string())?;

    // Compile
    let compile = Command::new(compiler)
        .args([
            src_path.to_str().unwrap(),
            "-o",
            bin_path.to_str().unwrap(),
            "-lm",
        ])
        .current_dir(cwd)
        .output()
        .map_err(|e| e.to_string())?;

    let _ = std::fs::remove_file(&src_path);

    if !compile.status.success() {
        let _ = std::fs::remove_file(&bin_path);
        return Ok(ExecResult {
            stdout: String::new(),
            stderr: String::from_utf8_lossy(&compile.stderr).to_string(),
            exit_code: compile.status.code().unwrap_or(-1),
        });
    }

    // Run
    let result = run_command(
        bin_path.to_str().unwrap(),
        &[],
        cwd,
        stdin_data,
    );

    let _ = std::fs::remove_file(&bin_path);
    result
}
