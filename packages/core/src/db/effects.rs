// Effects and optional voting commit together. Session replay is idempotent.
use super::*;

pub fn record_effect(
    handle: i64,
    input_json: &str,
    apply_vote: bool,
) -> Result<bool, Box<dyn std::error::Error>> {
    let input: EffectInput = serde_json::from_str(input_json)?;
    if input.insight_id.trim().is_empty()
        || input.session_id.trim().is_empty()
        || !matches!(input.outcome.as_str(), "positive" | "negative" | "neutral")
    {
        return Err("Invalid effect measurement".into());
    }
    with_conn(handle, |conn| {
        let tx = crate::atomic::AtomicWrite::new(conn)?;
        if is_replay(&tx, &input)? {
            return Ok(false);
        }
        tx.execute(
            "INSERT INTO effect_tracking (insight_id, session_id, was_relevant, was_followed, outcome)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![input.insight_id, input.session_id, input.was_relevant, input.was_followed, input.outcome],
        )?;
        update_effect_score(&tx, &input.insight_id)?;
        if apply_vote {
            apply_effect_vote(&tx, &input)?;
        }
        tx.commit()?;
        Ok(true)
    })
}

fn is_replay(conn: &Connection, input: &EffectInput) -> Result<bool, Box<dyn std::error::Error>> {
    let previous: Option<(bool, bool, String)> = conn
        .query_row(
            "SELECT was_relevant, was_followed, outcome FROM effect_tracking
         WHERE insight_id = ?1 AND session_id = ?2 ORDER BY id DESC LIMIT 1",
            params![input.insight_id, input.session_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    if let Some(value) = previous {
        if value
            != (
                input.was_relevant,
                input.was_followed,
                input.outcome.clone(),
            )
        {
            return Err("Conflicting effect measurement for this insight and session".into());
        }
        return Ok(true);
    }
    Ok(false)
}

fn apply_effect_vote(
    conn: &Connection,
    input: &EffectInput,
) -> Result<(), Box<dyn std::error::Error>> {
    if input.outcome == "positive" && input.was_followed {
        conn.execute(
            "UPDATE insights SET importance = importance + 1,
            updated_at = datetime('now') WHERE id = ?1",
            params![input.insight_id],
        )?;
    }
    if input.outcome == "negative" && input.was_relevant {
        conn.execute(
            "UPDATE insights SET importance = MAX(0, importance - 1),
            status = CASE WHEN importance <= 1 THEN 'retired' ELSE status END,
            updated_at = datetime('now') WHERE id = ?1",
            params![input.insight_id],
        )?;
    }
    Ok(())
}

fn update_effect_score(
    conn: &Connection,
    insight_id: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let score: f64 = conn.query_row(
        "SELECT AVG(CASE WHEN outcome = 'positive' THEN 1.0 ELSE 0.0 END) FROM (
            SELECT outcome FROM effect_tracking WHERE id IN (
                SELECT MAX(id) FROM effect_tracking WHERE insight_id = ?1 GROUP BY session_id
            ) ORDER BY created_at DESC, id DESC LIMIT 10
        )",
        params![insight_id],
        |row| row.get(0),
    )?;
    conn.execute(
        "UPDATE insights SET effect_score = ?1, updated_at = datetime('now')
        WHERE id = ?2",
        params![score, insight_id],
    )?;
    Ok(())
}
