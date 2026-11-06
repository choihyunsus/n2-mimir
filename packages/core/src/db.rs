// db.rs — SQLite database core (rusqlite zero-copy)
// All I/O operations: read/write/search/migration

use std::collections::HashMap;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::migration;

// === Global database handle registry ===

lazy_static::lazy_static! {
    static ref DB_REGISTRY: Mutex<HashMap<i64, Connection>> = Mutex::new(HashMap::new());
    static ref HANDLE_COUNTER: Mutex<i64> = Mutex::new(0);
}

/// Open or create a Mímir database. Returns a handle ID.
pub fn open(db_path: &str) -> Result<i64, Box<dyn std::error::Error>> {
    let mut conn = Connection::open(db_path)?;
    conn.execute_batch("PRAGMA journal_mode = WAL;")?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    migration::run_migrations(&mut conn)?;

    let mut counter = HANDLE_COUNTER.lock().unwrap();
    *counter += 1;
    let handle = *counter;

    let mut registry = DB_REGISTRY.lock().unwrap();
    registry.insert(handle, conn);

    Ok(handle)
}

/// Close a database handle.
pub fn close(handle: i64) -> Result<(), Box<dyn std::error::Error>> {
    let mut registry = DB_REGISTRY.lock().unwrap();
    registry.remove(&handle);
    Ok(())
}

/// Helper: access a connection by handle
pub(crate) fn with_conn<F, T>(handle: i64, f: F) -> Result<T, Box<dyn std::error::Error>>
where
    F: FnOnce(&mut Connection) -> Result<T, Box<dyn std::error::Error>>,
{
    let mut registry = DB_REGISTRY.lock().unwrap();
    let conn = registry.get_mut(&handle).ok_or("Invalid database handle")?;
    f(conn)
}

// === Serde types for JSON interchange ===

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExperienceInput {
    agent: String,
    project: String,
    #[serde(rename = "type")]
    exp_type: String,
    category: String,
    severity: Option<String>,
    context: String,
    action: String,
    outcome: String,
    correction: Option<String>,
    source_ref: Option<String>,
    session_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExperienceRow {
    id: String,
    timestamp: String,
    session_id: String,
    agent: String,
    project: String,
    #[serde(rename = "type")]
    exp_type: String,
    category: String,
    severity: String,
    context: String,
    action: String,
    outcome: String,
    correction: Option<String>,
    source_ref: Option<String>,
    frequency: i64,
    token_cost: i64,
    created_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExperienceFilter {
    project: Option<String>,
    agent: Option<String>,
    category: Option<String>,
    #[serde(rename = "type")]
    exp_type: Option<String>,
    severity: Option<String>,
    since: Option<String>,
    limit: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InsightInput {
    project: Option<String>,
    source_ids: Option<Vec<String>>,
    agent: String,
    description: String,
    compressed: String,
    token_cost: Option<i64>,
    category: String,
    scope: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InsightRow {
    id: String,
    created_at: String,
    updated_at: String,
    agent: String,
    description: String,
    compressed: String,
    token_cost: i64,
    category: String,
    scope: String,
    importance: i64,
    confidence: f64,
    effect_score: f64,
    status: String,
    converted_type: Option<String>,
    converted_ref: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InsightFilter {
    id: Option<String>,
    project: Option<String>,
    agent: Option<String>,
    category: Option<String>,
    scope: Option<String>,
    status: Option<String>,
    min_importance: Option<i64>,
    limit: Option<i64>,
}

#[derive(Deserialize)]
struct TagInput {
    level: i64,
    tag: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EffectInput {
    insight_id: String,
    session_id: String,
    was_relevant: bool,
    was_followed: bool,
    outcome: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpsertResult {
    is_new: bool,
    id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SimilarTag {
    tag: String,
    confidence: f64,
}

// === Utility ===

/// Estimate token cost (1 token ≈ 4 chars)
fn estimate_tokens(text: &str) -> i64 {
    ((text.encode_utf16().count() as f64) / 4.0).ceil() as i64
}

mod experience;
pub use experience::*;

mod insight;
pub use insight::*;

mod tags;
pub use tags::*;

mod effects;
pub use effects::*;

mod stats;
pub use stats::*;

mod embeddings;
pub use embeddings::*;

pub(crate) mod rows;
