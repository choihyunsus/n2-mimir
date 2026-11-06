// migration.rs — Schema migration runner (versioned evolution)

use crate::schema::{SCHEMA_SQL, SCHEMA_VERSION};
use rusqlite::{Connection, OptionalExtension};

/// Migration definitions: target_version → SQL statements
fn get_migrations() -> Vec<(u32, Vec<&'static str>)> {
    vec![
        // Version 2 tables and indexes are created by the additive bootstrap schema.
        (2, vec![]),
        // v1 is the initial schema (created by SCHEMA_SQL)
        // Future migrations:
        // (2, vec![
        //     "ALTER TABLE experiences ADD COLUMN embedding_status TEXT DEFAULT NULL;",
        //     "CREATE INDEX IF NOT EXISTS idx_exp_embedding ON experiences(embedding_status);",
        // ]),
    ]
}

/// Read current schema version from meta table
fn get_current_version(conn: &Connection) -> Result<u32, Box<dyn std::error::Error>> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM meta WHERE key='schema_version'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    match value {
        Some(value) => Ok(value.parse()?),
        None => Ok(0),
    }
}

/// Update schema version in meta table
fn set_version(conn: &Connection, version: u32) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?1)",
        [version.to_string()],
    )?;
    Ok(())
}

/// Run all pending migrations from current version to SCHEMA_VERSION.
/// Schema initialization and pending migrations commit together.
///
/// Returns number of migrations applied.
pub fn run_migrations(conn: &mut Connection) -> Result<u32, Box<dyn std::error::Error>> {
    let transaction = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    transaction.execute_batch(SCHEMA_SQL)?;
    let current = get_current_version(&transaction)?;
    if current > SCHEMA_VERSION {
        return Err("Database schema is newer than this Mimir version".into());
    }
    let migrations = get_migrations();
    let mut applied = 0;
    for version in (current + 1)..=SCHEMA_VERSION {
        if version == 1 {
            continue;
        }
        let (_, statements) = migrations
            .iter()
            .find(|(target, _)| *target == version)
            .ok_or("Missing database migration")?;
        for statement in statements {
            transaction.execute_batch(statement)?;
        }
        applied += 1;
    }
    set_version(&transaction, SCHEMA_VERSION)?;
    transaction.commit()?;
    Ok(applied)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn test_migration_version_tracking() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);")
            .unwrap();

        assert_eq!(get_current_version(&conn).unwrap(), 0);
        set_version(&conn, 1).unwrap();
        assert_eq!(get_current_version(&conn).unwrap(), 1);
    }
}
