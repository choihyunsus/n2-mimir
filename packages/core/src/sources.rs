// Link evidence atomically inside the caller's transaction and owner scope.
use rusqlite::{params, Connection};
use std::collections::HashSet;

pub(crate) fn link_sources(
    conn: &Connection,
    insight: &str,
    ids: &[String],
) -> Result<(usize, String), Box<dyn std::error::Error>> {
    if ids.is_empty()
        || ids.len() > 100
        || ids.iter().collect::<HashSet<_>>().len() != ids.len()
        || ids.iter().any(|id| id.trim().is_empty() || id.len() > 512)
    {
        return Err("Require 1-100 distinct bounded source IDs".into());
    }
    let agent: String =
        conn.query_row("SELECT agent FROM insights WHERE id=?1", [insight], |row| {
            row.get(0)
        })?;
    let mut statement = conn.prepare(
        "SELECT DISTINCT e.project,e.agent FROM experience_insight_links l
        JOIN experiences e ON e.id=l.experience_id WHERE l.insight_id=?1",
    )?;
    let mut owners = statement
        .query_map([insight], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for id in ids {
        owners.push(conn.query_row(
            "SELECT project,agent FROM experiences WHERE id=?1",
            [id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )?);
    }
    let project = owners[0].0.clone();
    if owners
        .iter()
        .any(|owner| owner.0 != project || owner.1 != agent)
    {
        return Err("Insight sources must share one project and the insight owner".into());
    }
    let mut added = 0;
    for id in ids {
        added += conn.execute(
            "INSERT OR IGNORE INTO experience_insight_links(experience_id,insight_id,relation)
            VALUES (?1,?2,'supports')",
            params![id, insight],
        )?;
    }
    Ok((added, project))
}
