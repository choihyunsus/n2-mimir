// Embeddings storage operations on a managed SQLite connection.
use super::*;

// === Embedding cache ===

pub fn store_embedding(
    handle: i64,
    source_type: &str,
    source_id: &str,
    vector_json: &str,
    model: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let vector: Vec<f32> = serde_json::from_str(vector_json)?;
    if vector.is_empty() || vector.len() > 65536 || vector.iter().any(|value| !value.is_finite()) {
        return Err("Vector requires 1-65536 finite float32 values".into());
    }
    let vector_bytes: Vec<u8> = vector.iter().flat_map(|f| f.to_le_bytes()).collect();
    let id = Uuid::new_v4().to_string();

    with_conn(handle, |conn| {
        conn.execute(
            "INSERT OR REPLACE INTO embeddings (id, source_type, source_id, vector, model)
            VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, source_type, source_id, vector_bytes, model],
        )?;
        Ok(())
    })
}

pub fn get_embedding(
    handle: i64,
    source_type: &str,
    source_id: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    with_conn(handle, |conn| {
        let result: Option<(Vec<u8>, String)> = conn.query_row(
            "SELECT vector,model FROM embeddings WHERE source_type=?1 AND source_id=?2 ORDER BY created_at DESC,rowid DESC LIMIT 1",
            params![source_type, source_id], |row| Ok((row.get(0)?,row.get(1)?)),
        ).optional()?;
        match result {
            Some((bytes, model)) => Ok(serde_json::to_string(
                &serde_json::json!({"vector":decode_vector(&bytes)?,"model":model}),
            )?),
            None => Ok(String::new()),
        }
    })
}

pub fn get_all_embeddings(handle: i64) -> Result<String, Box<dyn std::error::Error>> {
    with_conn(handle, |conn| {
        let mut statement =
            conn.prepare("SELECT source_type,source_id,vector,model FROM embeddings")?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Vec<u8>>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut result = Vec::with_capacity(rows.len());
        for (source_type, source_id, bytes, model) in rows {
            result.push(serde_json::json!({"sourceType":source_type,"sourceId":source_id,"vector":decode_vector(&bytes)?,"model":model}));
        }
        Ok(serde_json::to_string(&result)?)
    })
}

fn decode_vector(bytes: &[u8]) -> Result<Vec<f32>, Box<dyn std::error::Error>> {
    if bytes.is_empty() || !bytes.len().is_multiple_of(4) || bytes.len() > 65536 * 4 {
        return Err("Invalid vector encoding".into());
    }
    let values: Vec<f32> = bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|chunk| f32::from_le_bytes(*chunk))
        .collect();
    if values.iter().any(|value| !value.is_finite()) {
        return Err("Invalid vector value".into());
    }
    Ok(values)
}
