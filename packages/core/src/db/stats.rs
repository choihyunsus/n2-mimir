// Stats storage operations on a managed SQLite connection.
use super::*;

// === Stats ===

pub fn get_stats(handle: i64) -> Result<String, Box<dyn std::error::Error>> {
    with_conn(handle, |conn| {
        let exp: i64 = conn.query_row("SELECT COUNT(*) FROM experiences", [], |r| r.get(0))?;
        let ins: i64 = conn.query_row("SELECT COUNT(*) FROM insights", [], |r| r.get(0))?;
        let tags: i64 = conn.query_row("SELECT COUNT(*) FROM tags", [], |r| r.get(0))?;

        let result = serde_json::json!({
            "experiences": exp,
            "insights": ins,
            "tags": tags,
        });
        Ok(result.to_string())
    })
}
