CREATE TABLE IF NOT EXISTS graphs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT 'Untitled',
    snapshot BLOB NOT NULL,
    tldraw_snapshot BLOB,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_autosave BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS graph_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    graph_id INTEGER NOT NULL REFERENCES graphs(id) ON DELETE CASCADE,
    snapshot BLOB NOT NULL,
    tldraw_snapshot BLOB,
    saved_at TEXT NOT NULL DEFAULT (datetime('now')),
    label TEXT
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_history_graph ON graph_history(graph_id, saved_at DESC);
CREATE INDEX IF NOT EXISTS idx_graphs_autosave ON graphs(is_autosave, updated_at DESC);
