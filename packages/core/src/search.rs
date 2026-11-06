// search.rs — FTS5 full-text search + tag chain cascading recall

use rusqlite::params;
use serde::Serialize;

use crate::db;
use crate::scope::{Scope, EXPERIENCE_SCOPE};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TagFrequency {
    level: i64,
    tag: String,
    frequency: i64,
}

/// FTS5 full-text search on experiences (BM25 ranking)
pub fn fts_search(
    handle: i64,
    query: &str,
    limit: usize,
    scope_json: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let scope = Scope::parse(scope_json)?;
    let query = sanitize_fts_query(query)?;
    if query.is_empty() {
        return Ok("[]".to_string());
    }
    db::with_conn(handle, |conn| {
        let mut stmt = conn.prepare(
            "SELECT e.id, e.timestamp, e.session_id, e.agent, e.project, e.type,
                e.category, e.severity, e.context, e.action, e.outcome, e.correction,
                e.source_ref, e.frequency, e.token_cost, e.created_at, rank
            FROM experiences_fts fts
            JOIN experiences e ON e.rowid = fts.rowid
            WHERE experiences_fts MATCH ?1
              AND (?3 IS NULL OR e.project=?3) AND (?4 IS NULL OR e.agent=?4)
            ORDER BY rank
            LIMIT ?2",
        )?;

        let rows = stmt.query_map(
            params![query, limit as i64, scope.project, scope.agent],
            crate::db::rows::experience,
        )?;

        let results: Vec<db::ExperienceRow> = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        let ranked = results
            .into_iter()
            .enumerate()
            .map(|(index, item)| {
                let mut experience = serde_json::to_value(item)?;
                experience
                    .as_object_mut()
                    .expect("experience object")
                    .remove("rank");
                Ok(serde_json::json!({"experience": experience, "rank": index + 1}))
            })
            .collect::<serde_json::Result<Vec<_>>>()?;
        Ok(serde_json::to_string(&ranked)?)
    })
}

/// Get tag frequencies for cascading recall (architecture.md 8-3 Step 3)
pub fn tag_frequencies(
    handle: i64,
    tags_json: &str,
    limit: usize,
    scope_json: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let tags: Vec<String> = serde_json::from_str(tags_json)?;
    if tags.is_empty() {
        return Ok("[]".to_string());
    }

    let scope = Scope::parse(scope_json)?;
    db::with_conn(handle, |conn| {
        let placeholders: String = tags.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT level, tag, COUNT(*) as frequency
            FROM tags t JOIN experiences e ON e.id=t.experience_id WHERE tag IN ({}) AND {EXPERIENCE_SCOPE}
            GROUP BY level, tag
            ORDER BY frequency DESC
            LIMIT ?",
            placeholders
        );

        let mut stmt = conn.prepare(&sql)?;

        // Build params: tags + limit
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        for tag in &tags {
            param_values.push(Box::new(tag.clone()));
        }
        scope.append(&mut param_values);
        param_values.push(Box::new(limit as i64));

        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();

        let rows = stmt.query_map(params_ref.as_slice(), |row| {
            Ok(TagFrequency {
                level: row.get(0)?,
                tag: row.get(1)?,
                frequency: row.get(2)?,
            })
        })?;

        let results: Vec<TagFrequency> = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(serde_json::to_string(&results)?)
    })
}

/// Find experiences by tags (cascading recall — architecture.md 8-3 Step 2)
pub fn find_by_tags(
    handle: i64,
    tags_json: &str,
    limit: usize,
    scope_json: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let tags: Vec<String> = serde_json::from_str(tags_json)?;
    if tags.is_empty() {
        return Ok("[]".to_string());
    }

    let scope = Scope::parse(scope_json)?;
    db::with_conn(handle, |conn| {
        let placeholders: String = tags.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT DISTINCT e.id, e.timestamp, e.session_id, e.agent, e.project, e.type,
                e.category, e.severity, e.context, e.action, e.outcome, e.correction,
                e.source_ref, e.frequency, e.token_cost, e.created_at
            FROM experiences e
            JOIN tags t ON t.experience_id = e.id
            WHERE t.tag IN ({}) AND {EXPERIENCE_SCOPE}
            ORDER BY e.created_at DESC
            LIMIT ?",
            placeholders
        );

        let mut stmt = conn.prepare(&sql)?;

        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        for tag in &tags {
            param_values.push(Box::new(tag.clone()));
        }
        scope.append(&mut param_values);
        param_values.push(Box::new(limit as i64));

        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();

        let rows = stmt.query_map(params_ref.as_slice(), crate::db::rows::experience)?;

        let results: Vec<db::ExperienceRow> = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(serde_json::to_string(&results)?)
    })
}

/// Intersect tag layers in SQL before applying the result limit.
pub fn find_by_tags_intersection(
    handle: i64,
    layers_json: &str,
    limit: usize,
    scope_json: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let layers: Vec<Vec<String>> = serde_json::from_str(layers_json)?;
    if layers.is_empty() || layers.iter().all(Vec::is_empty) {
        return Ok("[]".into());
    }
    let scope = Scope::parse(scope_json)?;
    db::with_conn(handle, |conn| {
        let mut conditions = Vec::new();
        let mut values: Vec<String> = Vec::new();
        for layer in layers.iter().filter(|layer| !layer.is_empty()) {
            let placeholders = vec!["?"; layer.len()].join(",");
            conditions.push(format!("EXISTS (SELECT 1 FROM tags t WHERE t.experience_id=e.id AND t.tag IN ({placeholders}))"));
            values.extend(layer.iter().cloned());
        }
        let sql = format!("SELECT e.id,e.timestamp,e.session_id,e.agent,e.project,e.type,
            e.category,e.severity,e.context,e.action,e.outcome,e.correction,e.source_ref,e.frequency,e.token_cost,e.created_at
            FROM experiences e WHERE {} AND {EXPERIENCE_SCOPE} ORDER BY e.created_at DESC,e.id LIMIT ?", conditions.join(" AND "));
        let mut stmt = conn.prepare(&sql)?;
        let mut parameters: Vec<Box<dyn rusqlite::ToSql>> = values
            .into_iter()
            .map(|value| Box::new(value) as Box<dyn rusqlite::ToSql>)
            .collect();
        scope.append(&mut parameters);
        parameters.push(Box::new(limit as i64));
        let params_ref: Vec<&dyn rusqlite::ToSql> =
            parameters.iter().map(|value| value.as_ref()).collect();
        let rows = stmt.query_map(params_ref.as_slice(), crate::db::rows::experience)?;

        let results: Vec<db::ExperienceRow> = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(serde_json::to_string(&results)?)
    })
}

fn sanitize_fts_query(query: &str) -> Result<String, Box<dyn std::error::Error>> {
    if query.chars().count() > 4096 {
        return Err("Search query exceeds 4096 characters".into());
    }
    let mut groups: Vec<Vec<String>> = vec![Vec::new()];
    for token in query
        .split(|character: char| !character.is_alphanumeric() && character != '_')
        .filter(|token| !token.is_empty())
    {
        let keyword = token.to_ascii_uppercase();
        if keyword == "OR" {
            if !groups.last().expect("initial group").is_empty() {
                groups.push(Vec::new());
            }
            continue;
        }
        if ["AND", "NOT", "NEAR"].contains(&keyword.as_str()) {
            continue;
        }
        groups
            .last_mut()
            .expect("initial group")
            .push(format!("\"{token}\""));
    }
    Ok(groups
        .into_iter()
        .filter(|group| !group.is_empty())
        .map(|group| group.join(" "))
        .collect::<Vec<_>>()
        .join(" OR "))
}
