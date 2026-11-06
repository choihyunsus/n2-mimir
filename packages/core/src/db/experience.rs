// Experience storage operations on a managed SQLite connection.
use super::*;

// === Experience CRUD ===

pub fn insert_experience(
    handle: i64,
    input_json: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    crate::scope::Scope::parse(input_json)?;
    let input: ExperienceInput = serde_json::from_str(input_json)?;
    with_conn(handle, |conn| insert_experience_on(conn, input))
}

fn insert_experience_on(
    conn: &Connection,
    input: ExperienceInput,
) -> Result<String, Box<dyn std::error::Error>> {
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let correction_text = input.correction.as_deref().unwrap_or("");
    let token_cost = estimate_tokens(&format!(
        "{} {} {} {}",
        input.context, input.action, input.outcome, correction_text
    ));

    conn.execute(
        "INSERT INTO experiences (id, session_id, agent, project, type, category, severity,
            context, action, outcome, correction, source_ref, frequency, token_cost, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 1, ?13, ?14)",
        params![
            id,
            input.session_id.as_deref().unwrap_or(""),
            input.agent,
            input.project,
            input.exp_type,
            input.category,
            input.severity.as_deref().unwrap_or("info"),
            input.context,
            input.action,
            input.outcome,
            input.correction,
            input.source_ref,
            token_cost,
            now,
        ],
    )?;
    Ok(id)
}

pub fn get_experience(handle: i64, id: &str) -> Result<String, Box<dyn std::error::Error>> {
    with_conn(handle, |conn| {
        let mut stmt = conn.prepare(
            "SELECT id, timestamp, session_id, agent, project, type, category, severity,
                context, action, outcome, correction, source_ref, frequency, token_cost, created_at
            FROM experiences WHERE id = ?1",
        )?;
        let result = stmt.query_row(params![id], crate::db::rows::experience);

        match result {
            Ok(row) => Ok(serde_json::to_string(&row)?),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(String::new()),
            Err(e) => Err(e.into()),
        }
    })
}

pub fn upsert_experience(
    handle: i64,
    input_json: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    crate::scope::Scope::parse(input_json)?;
    let input: ExperienceInput = serde_json::from_str(input_json)?;
    with_conn(handle, |conn| {
        let transaction = crate::atomic::AtomicWrite::new(conn)?;
        let existing: Option<String> = transaction.query_row(
            "SELECT id FROM experiences WHERE agent=?1 AND project=?2 AND category=?3 AND action=?4
             AND type=?5 AND context=?6 AND outcome=?7 AND severity=?8
             AND correction IS ?9 AND source_ref IS ?10 AND session_id=?11
             ORDER BY created_at,id LIMIT 1",
            params![input.agent, input.project, input.category, input.action, input.exp_type,
                input.context, input.outcome, input.severity.as_deref().unwrap_or("info"),
                input.correction, input.source_ref, input.session_id.as_deref().unwrap_or("")],
            |row| row.get(0),
        ).optional()?;
        let result = if let Some(id) = existing {
            if input
                .source_ref
                .as_ref()
                .is_none_or(|source| source.trim().is_empty())
            {
                transaction.execute(
                    "UPDATE experiences SET frequency=frequency+1 WHERE id=?1",
                    params![id],
                )?;
            }
            UpsertResult { is_new: false, id }
        } else {
            UpsertResult {
                is_new: true,
                id: insert_experience_on(&transaction, input)?,
            }
        };
        transaction.commit()?;
        Ok(serde_json::to_string(&result)?)
    })
}

pub fn query_experiences(
    handle: i64,
    filter_json: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    crate::scope::Scope::parse(filter_json)?;
    let filter: ExperienceFilter = serde_json::from_str(filter_json)?;

    with_conn(handle, |conn| {
        let mut conditions = vec!["1=1".to_string()];
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        for (column, value) in [
            ("project", &filter.project),
            ("agent", &filter.agent),
            ("category", &filter.category),
            ("type", &filter.exp_type),
            ("severity", &filter.severity),
        ] {
            if let Some(value) = value {
                conditions.push(format!("{column} = ?"));
                param_values.push(Box::new(value.clone()));
            }
        }
        if let Some(ref since) = filter.since {
            conditions.push("created_at >= ?".to_string());
            param_values.push(Box::new(since.clone()));
        }

        let limit = filter.limit.unwrap_or(100);
        let sql = format!(
            "SELECT id, timestamp, session_id, agent, project, type, category, severity,
                context, action, outcome, correction, source_ref, frequency, token_cost, created_at
            FROM experiences WHERE {} ORDER BY created_at DESC LIMIT {}",
            conditions.join(" AND "),
            limit
        );

        let mut stmt = conn.prepare(&sql)?;
        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();
        let rows = stmt.query_map(params_ref.as_slice(), crate::db::rows::experience)?;

        let results: Vec<ExperienceRow> = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(serde_json::to_string(&results)?)
    })
}
