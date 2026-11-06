// Supplemental browsing and archival indexes preserve the common Soul tables.
import type { SqlConnection } from '../store/connection.js';

export function initializeMaintenance(connection: SqlConnection): void {
  connection.transaction(() => {
    const version = connection.query<{ value: string }>("SELECT value FROM meta WHERE key='mimir_maintenance_schema_version'")[0]?.value;
    if (version !== undefined && version !== '1') throw new Error('Unsupported Mimir maintenance schema version');
    connection.execute(`CREATE TABLE IF NOT EXISTS mimir_experience_previews (
      experience_id TEXT PRIMARY KEY REFERENCES experiences(id) ON DELETE CASCADE,
      context TEXT NOT NULL,action TEXT NOT NULL,outcome TEXT NOT NULL)`);
    initializeInsightIndex(connection);
    connection.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('mimir_maintenance_schema_version','1')");
  });
}

function initializeInsightIndex(connection: SqlConnection): void {
  const existing = connection.query("SELECT name FROM sqlite_master WHERE name='insights_fts'").length > 0;
  connection.execute(`CREATE VIRTUAL TABLE IF NOT EXISTS insights_fts USING fts5(
    description,compressed,content=insights,content_rowid=rowid,tokenize='unicode61')`);
  connection.execute(`CREATE TRIGGER IF NOT EXISTS insights_ai AFTER INSERT ON insights BEGIN
    INSERT INTO insights_fts(rowid,description,compressed) VALUES(new.rowid,new.description,new.compressed); END`);
  connection.execute(`CREATE TRIGGER IF NOT EXISTS insights_ad AFTER DELETE ON insights BEGIN
    INSERT INTO insights_fts(insights_fts,rowid,description,compressed) VALUES('delete',old.rowid,old.description,old.compressed); END`);
  connection.execute(`CREATE TRIGGER IF NOT EXISTS insights_au AFTER UPDATE ON insights BEGIN
    INSERT INTO insights_fts(insights_fts,rowid,description,compressed) VALUES('delete',old.rowid,old.description,old.compressed);
    INSERT INTO insights_fts(rowid,description,compressed) VALUES(new.rowid,new.description,new.compressed); END`);
  if (!existing) connection.execute("INSERT INTO insights_fts(insights_fts) VALUES('rebuild')");
}
