// Tags storage operations on a managed SQLite connection.
use super::*;

// === Tags ===

pub fn set_tags(
    handle: i64,
    experience_id: &str,
    tags_json: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let tags: Vec<TagInput> = serde_json::from_str(tags_json)?;

    with_conn(handle, |conn| {
        conn.execute(
            "DELETE FROM tags WHERE experience_id = ?1",
            params![experience_id],
        )?;
        let mut stmt =
            conn.prepare("INSERT INTO tags (experience_id, level, tag) VALUES (?1, ?2, ?3)")?;
        for tag in &tags {
            stmt.execute(params![experience_id, tag.level, tag.tag])?;
        }
        Ok(())
    })
}

pub fn find_similar_tags(
    handle: i64,
    tag: &str,
    auto_only: bool,
) -> Result<String, Box<dyn std::error::Error>> {
    let threshold = if auto_only { 0.9 } else { 0.0 };
    with_conn(handle, |conn| {
        let mut stmt = conn.prepare(
            "
            SELECT CASE WHEN tag_a = ?1 THEN tag_b ELSE tag_a END as similar_tag, confidence
            FROM tag_similarity
            WHERE (tag_a = ?2 OR tag_b = ?3) AND confidence >= ?4
            ORDER BY confidence DESC
        ",
        )?;
        let rows = stmt.query_map(params![tag, tag, tag, threshold], |row| {
            Ok(SimilarTag {
                tag: row.get(0)?,
                confidence: row.get(1)?,
            })
        })?;
        let results: Vec<SimilarTag> = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(serde_json::to_string(&results)?)
    })
}

pub fn upsert_tag_similarity(
    handle: i64,
    tag_a: &str,
    tag_b: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let (a, b) = if tag_a < tag_b {
        (tag_a, tag_b)
    } else {
        (tag_b, tag_a)
    };
    with_conn(handle, |conn| {
        let existing: Option<(i64, i64)> = conn
            .query_row(
                "SELECT id, confirmed_count FROM tag_similarity WHERE tag_a = ?1 AND tag_b = ?2",
                params![a, b],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();

        if let Some((id, count)) = existing {
            let new_count = count + 1;
            let new_confidence = 1.0 - (1.0 / (new_count as f64 + 1.0));
            conn.execute(
                "UPDATE tag_similarity SET confidence = ?1, confirmed_count = ?2, updated_at = datetime('now') WHERE id = ?3",
                params![new_confidence, new_count, id],
            )?;
        } else {
            conn.execute(
                "INSERT INTO tag_similarity (tag_a, tag_b, confidence, confirmed_count) VALUES (?1, ?2, 0.5, 1)",
                params![a, b],
            )?;
        }
        Ok(())
    })
}
