use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use svg_graph_engine::types::GraphSnapshot;

const SCHEMA: &str = include_str!("schema.sql");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphRecord {
    pub id: i64,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    pub is_autosave: bool,
}

pub struct SqliteStore {
    conn: Connection,
}

impl SqliteStore {
    pub fn open(path: &str) -> SqlResult<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn })
    }

    pub fn open_in_memory() -> SqlResult<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn })
    }

    /// Save a graph snapshot. Returns the graph row ID.
    pub fn save(
        &self,
        name: &str,
        snapshot: &GraphSnapshot,
        tldraw_snapshot: Option<&[u8]>,
    ) -> Result<i64, String> {
        let blob = rmp_serde::to_vec_named(snapshot).map_err(|e| e.to_string())?;

        self.conn
            .execute(
                "INSERT INTO graphs (name, snapshot, tldraw_snapshot) VALUES (?1, ?2, ?3)",
                params![name, blob, tldraw_snapshot],
            )
            .map_err(|e| e.to_string())?;

        Ok(self.conn.last_insert_rowid())
    }

    /// Autosave: upsert the single autosave row for a graph name.
    pub fn autosave(
        &self,
        name: &str,
        snapshot: &GraphSnapshot,
        tldraw_snapshot: Option<&[u8]>,
    ) -> Result<i64, String> {
        let blob = rmp_serde::to_vec_named(snapshot).map_err(|e| e.to_string())?;

        // Try to update existing autosave
        let updated = self
            .conn
            .execute(
                "UPDATE graphs SET snapshot = ?1, tldraw_snapshot = ?2, updated_at = datetime('now')
                 WHERE name = ?3 AND is_autosave = TRUE",
                params![blob, tldraw_snapshot, name],
            )
            .map_err(|e| e.to_string())?;

        if updated > 0 {
            let id: i64 = self
                .conn
                .query_row(
                    "SELECT id FROM graphs WHERE name = ?1 AND is_autosave = TRUE",
                    params![name],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            return Ok(id);
        }

        // Insert new autosave
        self.conn
            .execute(
                "INSERT INTO graphs (name, snapshot, tldraw_snapshot, is_autosave)
                 VALUES (?1, ?2, ?3, TRUE)",
                params![name, blob, tldraw_snapshot],
            )
            .map_err(|e| e.to_string())?;

        Ok(self.conn.last_insert_rowid())
    }

    /// Load a graph snapshot by ID.
    pub fn load(&self, id: i64) -> Result<(GraphSnapshot, Option<Vec<u8>>), String> {
        let (blob, tldraw): (Vec<u8>, Option<Vec<u8>>) = self
            .conn
            .query_row(
                "SELECT snapshot, tldraw_snapshot FROM graphs WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| e.to_string())?;

        let snapshot: GraphSnapshot =
            rmp_serde::from_slice(&blob).map_err(|e| e.to_string())?;

        Ok((snapshot, tldraw))
    }

    /// Load the most recent autosave.
    pub fn load_latest_autosave(&self) -> Result<Option<(i64, GraphSnapshot, Option<Vec<u8>>)>, String> {
        let result = self.conn.query_row(
            "SELECT id, snapshot, tldraw_snapshot FROM graphs
             WHERE is_autosave = TRUE
             ORDER BY updated_at DESC LIMIT 1",
            [],
            |row| {
                let id: i64 = row.get(0)?;
                let blob: Vec<u8> = row.get(1)?;
                let tldraw: Option<Vec<u8>> = row.get(2)?;
                Ok((id, blob, tldraw))
            },
        );

        match result {
            Ok((id, blob, tldraw)) => {
                let snapshot: GraphSnapshot =
                    rmp_serde::from_slice(&blob).map_err(|e| e.to_string())?;
                Ok(Some((id, snapshot, tldraw)))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    /// List all saved graphs (non-autosave).
    pub fn list(&self) -> Result<Vec<GraphRecord>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, name, created_at, updated_at, is_autosave
                 FROM graphs ORDER BY updated_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok(GraphRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                    is_autosave: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut records = Vec::new();
        for row in rows {
            records.push(row.map_err(|e| e.to_string())?);
        }
        Ok(records)
    }

    /// Save a version to history (for manual saves / checkpoints).
    pub fn save_history(
        &self,
        graph_id: i64,
        snapshot: &GraphSnapshot,
        tldraw_snapshot: Option<&[u8]>,
        label: Option<&str>,
    ) -> Result<i64, String> {
        let blob = rmp_serde::to_vec_named(snapshot).map_err(|e| e.to_string())?;

        self.conn
            .execute(
                "INSERT INTO graph_history (graph_id, snapshot, tldraw_snapshot, label)
                 VALUES (?1, ?2, ?3, ?4)",
                params![graph_id, blob, tldraw_snapshot, label],
            )
            .map_err(|e| e.to_string())?;

        Ok(self.conn.last_insert_rowid())
    }

    /// Get/set a setting.
    pub fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        match self.conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        ) {
            Ok(val) => Ok(Some(val)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = ?2",
                params![key, value],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Delete a graph and its history.
    pub fn delete(&self, id: i64) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM graphs WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use svg_graph_engine::types::*;

    fn test_snapshot() -> GraphSnapshot {
        GraphSnapshot {
            nodes: vec![NodeSnapshotEntry {
                id: "node-1".to_string(),
                node_type: "data:json".to_string(),
                config: serde_json::json!({"dataJson": "{}"}),
                meta: NodeMeta {
                    created: 1000,
                    last_run: 0,
                    run_count: 0,
                    position: None,
                    size: None,
                },
            }],
            edges: vec![],
            subsystems: vec![],
            version: 1,
        }
    }

    #[test]
    fn test_save_and_load() {
        let store = SqliteStore::open_in_memory().unwrap();
        let snapshot = test_snapshot();

        let id = store.save("Test Graph", &snapshot, None).unwrap();
        let (loaded, tldraw) = store.load(id).unwrap();

        assert_eq!(loaded.nodes.len(), 1);
        assert_eq!(loaded.nodes[0].id, "node-1");
        assert!(tldraw.is_none());
    }

    #[test]
    fn test_autosave() {
        let store = SqliteStore::open_in_memory().unwrap();
        let snapshot = test_snapshot();

        let id1 = store.autosave("default", &snapshot, None).unwrap();
        let id2 = store.autosave("default", &snapshot, None).unwrap();

        // Should reuse the same row
        assert_eq!(id1, id2);

        let latest = store.load_latest_autosave().unwrap();
        assert!(latest.is_some());
    }

    #[test]
    fn test_list() {
        let store = SqliteStore::open_in_memory().unwrap();
        let snapshot = test_snapshot();

        store.save("Graph A", &snapshot, None).unwrap();
        store.save("Graph B", &snapshot, None).unwrap();

        let list = store.list().unwrap();
        assert_eq!(list.len(), 2);
    }

    #[test]
    fn test_settings() {
        let store = SqliteStore::open_in_memory().unwrap();

        assert!(store.get_setting("api_key").unwrap().is_none());

        store.set_setting("api_key", "sk-test-123").unwrap();
        assert_eq!(
            store.get_setting("api_key").unwrap(),
            Some("sk-test-123".to_string())
        );

        store.set_setting("api_key", "sk-updated").unwrap();
        assert_eq!(
            store.get_setting("api_key").unwrap(),
            Some("sk-updated".to_string())
        );
    }

    #[test]
    fn test_save_with_tldraw() {
        let store = SqliteStore::open_in_memory().unwrap();
        let snapshot = test_snapshot();
        let tldraw_data = b"tldraw json here";

        let id = store
            .save("With TLDraw", &snapshot, Some(tldraw_data))
            .unwrap();
        let (_, tldraw) = store.load(id).unwrap();

        assert_eq!(tldraw.unwrap(), tldraw_data.to_vec());
    }
}
