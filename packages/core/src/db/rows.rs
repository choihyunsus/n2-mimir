// Shared typed SQLite row decoding; conversion failures propagate to the caller.
use super::*;

pub(crate) fn experience(row: &rusqlite::Row) -> rusqlite::Result<ExperienceRow> {
    Ok(ExperienceRow {
        id: row.get(0)?,
        timestamp: row.get(1)?,
        session_id: row.get(2)?,
        agent: row.get(3)?,
        project: row.get(4)?,
        exp_type: row.get(5)?,
        category: row.get(6)?,
        severity: row.get(7)?,
        context: row.get(8)?,
        action: row.get(9)?,
        outcome: row.get(10)?,
        correction: row.get(11)?,
        source_ref: row.get(12)?,
        frequency: row.get(13)?,
        token_cost: row.get(14)?,
        created_at: row.get(15)?,
    })
}

pub(crate) fn insight(row: &rusqlite::Row) -> rusqlite::Result<InsightRow> {
    Ok(InsightRow {
        id: row.get(0)?,
        created_at: row.get(1)?,
        updated_at: row.get(2)?,
        agent: row.get(3)?,
        description: row.get(4)?,
        compressed: row.get(5)?,
        token_cost: row.get(6)?,
        category: row.get(7)?,
        scope: row.get(8)?,
        importance: row.get(9)?,
        confidence: row.get(10)?,
        effect_score: row.get(11)?,
        status: row.get(12)?,
        converted_type: row.get(13)?,
        converted_ref: row.get(14)?,
    })
}
