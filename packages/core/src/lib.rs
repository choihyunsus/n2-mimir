// n2-mimir-core — napi-rs entry point
// Exports all public functions to Node.js via native bindings

#![deny(clippy::all)]

mod db;
mod sql;
pub use sql::{execute_sql, query_sql};
mod atomic;
mod migration;
mod schema;
mod scope;
mod search;
mod sources;
mod vector;
mod weight;

use napi::bindgen_prelude::*;
use napi_derive::napi;

/// Binding contract version, including scoped reads and nested FTS results.
#[napi]
pub fn api_version() -> u32 {
    3
}

/// Read stored embedding vectors together with their actual model identifiers.
#[napi]
pub fn get_all_embeddings(handle: i64) -> Result<String> {
    db::get_all_embeddings(handle).map_err(|error| Error::from_reason(error.to_string()))
}

/// Reinforce only when new owner-scoped evidence was linked in the same transaction.
#[napi]
pub fn reinforce_insight(handle: i64, id: String, sources_json: String) -> Result<u32> {
    db::reinforce_insight(handle, &id, &sources_json)
        .map_err(|error| Error::from_reason(error.to_string()))
}

/// Open or create a Mímir database at the given path.
/// Returns an opaque handle for subsequent operations.
#[napi]
pub fn open_database(db_path: String) -> Result<i64> {
    db::open(&db_path).map_err(|e| Error::from_reason(e.to_string()))
}

/// Close a database handle.
#[napi]
pub fn close_database(handle: i64) -> Result<()> {
    db::close(handle).map_err(|e| Error::from_reason(e.to_string()))
}

// === Experience CRUD ===

/// Insert a new experience entry. Returns the generated ID.
#[napi]
pub fn insert_experience(handle: i64, input_json: String) -> Result<String> {
    db::insert_experience(handle, &input_json).map_err(|e| Error::from_reason(e.to_string()))
}

/// Get a single experience by ID. Returns JSON or empty string.
#[napi]
pub fn get_experience(handle: i64, id: String) -> Result<String> {
    db::get_experience(handle, &id).map_err(|e| Error::from_reason(e.to_string()))
}

/// Upsert experience (Delta Learning).
#[napi]
pub fn upsert_experience(handle: i64, input_json: String) -> Result<String> {
    db::upsert_experience(handle, &input_json).map_err(|e| Error::from_reason(e.to_string()))
}

/// Query experiences with JSON filter. Returns JSON array.
#[napi]
pub fn query_experiences(handle: i64, filter_json: String) -> Result<String> {
    db::query_experiences(handle, &filter_json).map_err(|e| Error::from_reason(e.to_string()))
}

// === FTS5 Search ===

/// Full-text search on experiences. Returns JSON array of ranked results.
#[napi]
pub fn search_experiences(
    handle: i64,
    query: String,
    limit: i32,
    scope_json: Option<String>,
) -> Result<String> {
    search::fts_search(
        handle,
        &query,
        limit.max(0) as usize,
        scope_json.as_deref().unwrap_or("{}"),
    )
    .map_err(|e| Error::from_reason(e.to_string()))
}

// === Insight CRUD ===

/// Insert a new insight. Returns the generated ID.
#[napi]
pub fn insert_insight(handle: i64, input_json: String) -> Result<String> {
    db::insert_insight(handle, &input_json).map_err(|e| Error::from_reason(e.to_string()))
}

/// Get a single insight by ID. Returns JSON or empty string.
#[napi]
pub fn get_insight(handle: i64, id: String) -> Result<String> {
    db::get_insight(handle, &id).map_err(|e| Error::from_reason(e.to_string()))
}

/// Query insights with JSON filter. Returns JSON array.
#[napi]
pub fn query_insights(handle: i64, filter_json: String) -> Result<String> {
    db::query_insights(handle, &filter_json).map_err(|e| Error::from_reason(e.to_string()))
}

// === Voting ===

#[napi]
pub fn upvote_insight(handle: i64, id: String) -> Result<()> {
    db::upvote_insight(handle, &id).map_err(|e| Error::from_reason(e.to_string()))
}

#[napi]
pub fn downvote_insight(handle: i64, id: String) -> Result<()> {
    db::downvote_insight(handle, &id).map_err(|e| Error::from_reason(e.to_string()))
}

#[napi]
pub fn graduate_insight(
    handle: i64,
    id: String,
    converted_type: String,
    converted_ref: String,
) -> Result<()> {
    db::graduate_insight(handle, &id, &converted_type, &converted_ref)
        .map_err(|e| Error::from_reason(e.to_string()))
}

// === Tags ===

/// Set tags for an experience. tags_json = JSON array of {level, tag}.
#[napi]
pub fn set_tags(handle: i64, experience_id: String, tags_json: String) -> Result<()> {
    db::set_tags(handle, &experience_id, &tags_json).map_err(|e| Error::from_reason(e.to_string()))
}

/// Get tag frequencies. tags_json = JSON array of strings.
#[napi]
pub fn get_tag_frequencies(
    handle: i64,
    tags_json: String,
    limit: i32,
    scope_json: Option<String>,
) -> Result<String> {
    search::tag_frequencies(
        handle,
        &tags_json,
        limit.max(0) as usize,
        scope_json.as_deref().unwrap_or("{}"),
    )
    .map_err(|e| Error::from_reason(e.to_string()))
}

/// Find experiences by tags. Returns JSON array.
#[napi]
pub fn find_experiences_by_tags(
    handle: i64,
    tags_json: String,
    limit: i32,
    scope_json: Option<String>,
) -> Result<String> {
    search::find_by_tags(
        handle,
        &tags_json,
        limit.max(0) as usize,
        scope_json.as_deref().unwrap_or("{}"),
    )
    .map_err(|e| Error::from_reason(e.to_string()))
}

/// Find experiences by tags intersection. Returns JSON array.
#[napi]
pub fn find_experiences_by_tags_intersection(
    handle: i64,
    tags_layers_json: String,
    limit: i32,
    scope_json: Option<String>,
) -> Result<String> {
    search::find_by_tags_intersection(
        handle,
        &tags_layers_json,
        limit.max(0) as usize,
        scope_json.as_deref().unwrap_or("{}"),
    )
    .map_err(|e| Error::from_reason(e.to_string()))
}

#[napi]
pub fn find_similar_tags(handle: i64, tag: String, auto_only: bool) -> Result<String> {
    db::find_similar_tags(handle, &tag, auto_only).map_err(|e| Error::from_reason(e.to_string()))
}

#[napi]
pub fn upsert_tag_similarity(handle: i64, tag_a: String, tag_b: String) -> Result<()> {
    db::upsert_tag_similarity(handle, &tag_a, &tag_b).map_err(|e| Error::from_reason(e.to_string()))
}

// === Effect tracking ===

/// Record an effect measurement. input_json = JSON EffectMeasurement.
#[napi]
pub fn record_effect(handle: i64, input_json: String, apply_vote: Option<bool>) -> Result<bool> {
    db::record_effect(handle, &input_json, apply_vote.unwrap_or(false))
        .map_err(|e| Error::from_reason(e.to_string()))
}

// === Stats ===

/// Get database statistics. Returns JSON {experiences, insights, tags}.
#[napi]
pub fn get_stats(handle: i64) -> Result<String> {
    db::get_stats(handle).map_err(|e| Error::from_reason(e.to_string()))
}

// === Vector ops (SIMD) ===

/// Compute cosine similarity between two float32 vectors (passed as JSON arrays).
#[napi]
pub fn cosine_similarity(vec_a_json: String, vec_b_json: String) -> Result<f64> {
    vector::cosine_similarity_json(&vec_a_json, &vec_b_json)
        .map_err(|e| Error::from_reason(e.to_string()))
}

/// Batch compute time-decay weights. Returns JSON array of weights.
#[napi]
pub fn compute_weights(timestamps_json: String, half_life_days: f64) -> Result<String> {
    weight::batch_compute_json(&timestamps_json, half_life_days)
        .map_err(|e| Error::from_reason(e.to_string()))
}

// === Embedding cache ===

/// Store an embedding vector for an experience.
#[napi]
pub fn store_embedding(
    handle: i64,
    source_type: String,
    source_id: String,
    vector_json: String,
    model: String,
) -> Result<()> {
    db::store_embedding(handle, &source_type, &source_id, &vector_json, &model)
        .map_err(|e| Error::from_reason(e.to_string()))
}

/// Get embedding for an experience. Returns JSON array or empty string.
#[napi]
pub fn get_embedding(handle: i64, source_type: String, source_id: String) -> Result<String> {
    db::get_embedding(handle, &source_type, &source_id)
        .map_err(|e| Error::from_reason(e.to_string()))
}
