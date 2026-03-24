//! Push-based PTY session manager.
//!
//! Unlike the polling-based original, this spawns a reader thread per session
//! that emits Tauri events (`pty:output`, `pty:exit`) directly to the frontend.

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Box<dyn portable_pty::Child + Send>,
    shell: String,
    cwd: String,
}

pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct PtyInfo {
    pub id: String,
    pub shell: String,
    pub cwd: String,
    pub alive: bool,
}

#[derive(Clone, Serialize)]
struct PtyOutputEvent {
    node_id: String,
    data: String,
}

#[derive(Clone, Serialize)]
struct PtyExitEvent {
    node_id: String,
    exit_code: i32,
}

/// Spawn a new PTY session with a push-based reader thread.
#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    manager: State<PtyManager>,
    node_id: String,
    shell: Option<String>,
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<PtyInfo, String> {
    let mut sessions = manager.sessions.lock().map_err(|e| e.to_string())?;

    // Kill existing session for this node if any
    if let Some(mut old) = sessions.remove(&node_id) {
        let _ = old.child.kill();
    }

    let pty_system = native_pty_system();
    let size = PtySize {
        rows: rows.unwrap_or(24),
        cols: cols.unwrap_or(80),
        pixel_width: 0,
        pixel_height: 0,
    };

    let pair = pty_system.openpty(size).map_err(|e| e.to_string())?;

    let default_shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
    let shell_path = shell.unwrap_or(default_shell);
    let work_dir = cwd.unwrap_or_else(|| {
        std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string())
    });

    let mut cmd = CommandBuilder::new(&shell_path);
    cmd.cwd(&work_dir);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("LANG", "en_US.UTF-8");

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let info = PtyInfo {
        id: node_id.clone(),
        shell: shell_path.clone(),
        cwd: work_dir.clone(),
        alive: true,
    };

    // Store session FIRST, before spawning reader thread
    // This ensures the child process stays alive while the reader runs
    sessions.insert(
        node_id.clone(),
        PtySession {
            master: pair.master,
            writer: Arc::new(Mutex::new(writer)),
            child,
            shell: shell_path.clone(),
            cwd: work_dir.clone(),
        },
    );

    // Drop the lock before spawning the reader thread
    drop(sessions);

    // Spawn push-based reader thread
    let app_clone = app.clone();
    let node_id_clone = node_id.clone();
    std::thread::spawn(move || {
        let mut buf = vec![0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    let _ = app_clone.emit(
                        "pty:exit",
                        PtyExitEvent {
                            node_id: node_id_clone.clone(),
                            exit_code: 0,
                        },
                    );
                    break;
                }
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_clone.emit(
                        "pty:output",
                        PtyOutputEvent {
                            node_id: node_id_clone.clone(),
                            data,
                        },
                    );
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(std::time::Duration::from_millis(5));
                }
                Err(_) => {
                    let _ = app_clone.emit(
                        "pty:exit",
                        PtyExitEvent {
                            node_id: node_id_clone.clone(),
                            exit_code: -1,
                        },
                    );
                    break;
                }
            }
        }
    });

    Ok(info)
}

/// Write data (keystrokes) to a PTY session.
#[tauri::command]
pub fn pty_write(
    manager: State<PtyManager>,
    node_id: String,
    data: String,
) -> Result<(), String> {
    let sessions = manager.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions.get(&node_id).ok_or("No PTY session for this node")?;

    let mut writer = session.writer.lock().map_err(|e| e.to_string())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

/// Resize a PTY session.
#[tauri::command]
pub fn pty_resize(
    manager: State<PtyManager>,
    node_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = manager.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions.get(&node_id).ok_or("No PTY session for this node")?;

    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

/// Kill a PTY session.
#[tauri::command]
pub fn pty_kill(
    manager: State<PtyManager>,
    node_id: String,
) -> Result<(), String> {
    let mut sessions = manager.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(mut session) = sessions.remove(&node_id) {
        let _ = session.child.kill();
    }
    Ok(())
}

/// List all active PTY sessions.
#[tauri::command]
pub fn pty_list(manager: State<PtyManager>) -> Result<Vec<PtyInfo>, String> {
    let mut sessions = manager.sessions.lock().map_err(|e| e.to_string())?;
    let mut infos = Vec::new();
    let mut dead_ids = Vec::new();

    for (id, session) in sessions.iter_mut() {
        let alive = match session.child.try_wait() {
            Ok(Some(_)) => false,
            Ok(None) => true,
            Err(_) => false,
        };

        if !alive {
            dead_ids.push(id.clone());
        }

        infos.push(PtyInfo {
            id: id.clone(),
            shell: session.shell.clone(),
            cwd: session.cwd.clone(),
            alive,
        });
    }

    for id in dead_ids {
        sessions.remove(&id);
    }

    Ok(infos)
}
