// Insight storage operations on a managed SQLite connection.
use super::*;

const PROJECT_SCOPE_SQL: &str = "(scope IN ('global','agent') OR (
    EXISTS (SELECT 1 FROM experience_insight_links l JOIN experiences e ON e.id=l.experience_id
        WHERE l.insight_id=insights.id AND l.relation='supports' AND e.project=? AND e.agent=insights.agent)
    AND NOT EXISTS (SELECT 1 FROM experience_insight_links l JOIN experiences e ON e.id=l.experience_id
        WHERE l.insight_id=insights.id AND (e.project<>? OR e.agent<>insights.agent))))";

// === Insight CRUD ===

pub fn insert_insight(handle: i64, input_json: &str) -> Result<String, Box<dyn std::error::Error>> {
    crate::scope::Scope::parse(input_json)?;
    let input: InsightInput = serde_json::from_str(input_json)?;
    if input.project.is_some() && input.source_ids.is_none() {
        return Err("Project-scoped insertion requires source IDs".into());
    }
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let token_text = if input.compressed.is_empty() {
        &input.description
    } else {
        &input.compressed
    };
    let token_cost = input
        .token_cost
        .unwrap_or_else(|| estimate_tokens(token_text));

    with_conn(handle, |conn| {
        let transaction = crate::atomic::AtomicWrite::new(conn)?;
        transaction.execute(
            "INSERT INTO insights (id, created_at, updated_at, agent, description, compressed,
                token_cost, category, scope, importance, confidence, effect_score, status)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 2, 0.5, 0.0, 'active')",
            params![
                id,
                now,
                now,
                input.agent,
                input.description,
                input.compressed,
                token_cost,
                input.category,
                input.scope.as_deref().unwrap_or("project"),
            ],
        )?;
        if let Some(ids) = &input.source_ids {
            let (_, project) = crate::sources::link_sources(&transaction, &id, ids)?;
            if input
                .project
                .as_ref()
                .is_some_and(|expected| expected != &project)
            {
                return Err("Source project differs from requested project".into());
            }
        }
        transaction.commit()?;
        Ok(id)
    })
}

pub fn reinforce_insight(
    handle: i64,
    id: &str,
    sources_json: &str,
) -> Result<u32, Box<dyn std::error::Error>> {
    let ids: Vec<String> = serde_json::from_str(sources_json)?;
    with_conn(handle, |conn| {
        let transaction = crate::atomic::AtomicWrite::new(conn)?;
        let (added, _) = crate::sources::link_sources(&transaction, id, &ids)?;
        if added > 0 {
            transaction.execute("UPDATE insights SET importance=importance+1,updated_at=datetime('now') WHERE id=?1", [id])?;
        }
        transaction.commit()?;
        Ok(added as u32)
    })
}

pub fn get_insight(handle: i64, id: &str) -> Result<String, Box<dyn std::error::Error>> {
    with_conn(handle, |conn| {
        let mut stmt = conn.prepare(
            "SELECT id, created_at, updated_at, agent, description, compressed, token_cost,
                category, scope, importance, confidence, effect_score, status,
                converted_type, converted_ref
            FROM insights WHERE id = ?1",
        )?;
        let result = stmt.query_row(params![id], crate::db::rows::insight);

        match result {
            Ok(row) => Ok(serde_json::to_string(&row)?),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(String::new()),
            Err(e) => Err(e.into()),
        }
    })
}

pub fn query_insights(
    handle: i64,
    filter_json: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    crate::scope::Scope::parse(filter_json)?;
    let filter: InsightFilter = serde_json::from_str(filter_json)?;

    with_conn(handle, |conn| {
        let mut conditions = vec!["1=1".to_string()];
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        append_project_scope(&filter.project, &mut conditions, &mut param_values);

        for (column, value) in [
            ("id", &filter.id),
            ("agent", &filter.agent),
            ("category", &filter.category),
            ("scope", &filter.scope),
            ("status", &filter.status),
        ] {
            if let Some(value) = value {
                conditions.push(format!("{column} = ?"));
                param_values.push(Box::new(value.clone()));
            }
        }
        if let Some(min_imp) = filter.min_importance {
            conditions.push(format!("importance >= {}", min_imp));
        }

        let limit = filter.limit.unwrap_or(50);
        let sql = format!(
            "SELECT id, created_at, updated_at, agent, description, compressed, token_cost,
                category, scope, importance, confidence, effect_score, status,
                converted_type, converted_ref
            FROM insights WHERE {} ORDER BY importance DESC, effect_score DESC LIMIT {}",
            conditions.join(" AND "),
            limit
        );

        let mut stmt = conn.prepare(&sql)?;
        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();
        let rows = stmt.query_map(params_ref.as_slice(), crate::db::rows::insight)?;

        let results: Vec<InsightRow> = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(serde_json::to_string(&results)?)
    })
}

fn append_project_scope(
    project: &Option<String>,
    conditions: &mut Vec<String>,
    parameters: &mut Vec<Box<dyn rusqlite::types::ToSql>>,
) {
    if let Some(project) = project {
        conditions.push(PROJECT_SCOPE_SQL.into());
        parameters.push(Box::new(project.clone()));
        parameters.push(Box::new(project.clone()));
    }
}

// === Voting ===

pub fn upvote_insight(handle: i64, id: &str) -> Result<(), Box<dyn std::error::Error>> {
    with_conn(handle, |conn| {
        conn.execute(
            "UPDATE insights SET importance = importance + 1, updated_at = datetime('now') WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    })
}

pub fn downvote_insight(handle: i64, id: &str) -> Result<(), Box<dyn std::error::Error>> {
    with_conn(handle, |conn| {
        conn.execute(
            "UPDATE insights SET
                importance = MAX(0, importance - 1),
                status = CASE WHEN importance <= 1 THEN 'retired' ELSE status END,
                updated_at = datetime('now')
            WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    })
}

pub fn graduate_insight(
    handle: i64,
    id: &str,
    converted_type: &str,
    converted_ref: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    with_conn(handle, |conn| {
        conn.execute(
            "UPDATE insights SET status = 'graduated', converted_type = ?1,
                converted_ref = ?2, updated_at = datetime('now') WHERE id = ?3",
            params![converted_type, converted_ref, id],
        )?;
        Ok(())
    })
}
