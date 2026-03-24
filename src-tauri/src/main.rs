// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod exec;
mod executors;
mod graph_commands;
mod pty;

use graph_commands::{GraphEngine, StoreState};
use svg_graph_engine::graph::Graph;
use svg_store::SqliteStore;
use tauri::Manager;

fn main() {
    // Force X11 backend via XWayland — WebKitGTK on native Wayland is unstable.
    if std::env::var("WAYLAND_DISPLAY").is_ok() {
        std::env::set_var("GDK_BACKEND", "x11");
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            // Initialize PTY session manager
            app.manage(pty::PtyManager::new());

            // Initialize graph engine
            let graph = Graph::new();
            // Node defs will be registered from the frontend via graph_register_node_def
            app.manage(GraphEngine::new(graph));

            // Initialize SQLite store
            let app_data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("/tmp"));
            std::fs::create_dir_all(&app_data_dir).ok();
            let db_path = app_data_dir.join("svgos.db");

            let store = SqliteStore::open(db_path.to_str().unwrap_or("/tmp/svgos.db"))
                .expect("Failed to open SQLite store");
            app.manage(StoreState {
                store: std::sync::Mutex::new(store),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // PTY terminal commands (push-based)
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_list,
            // Native code execution
            exec::exec_run,
            exec::exec_run_repl,
            // Graph engine commands
            graph_commands::graph_add_node,
            graph_commands::graph_remove_node,
            graph_commands::graph_update_node,
            graph_commands::graph_add_edge,
            graph_commands::graph_remove_edge,
            graph_commands::graph_get_snapshot,
            graph_commands::graph_load_snapshot,
            graph_commands::graph_undo,
            graph_commands::graph_redo,
            graph_commands::graph_clear,
            graph_commands::graph_register_node_def,
            graph_commands::graph_list_node_defs,
            // Store commands
            graph_commands::store_save,
            graph_commands::store_autosave,
            graph_commands::store_load,
            graph_commands::store_load_latest,
            graph_commands::store_list,
            graph_commands::store_get_setting,
            graph_commands::store_set_setting,
            // System info
            get_shell,
            get_home_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SVG OS Desktop");
}

#[tauri::command]
fn get_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
}

#[tauri::command]
fn get_home_dir() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string())
}
