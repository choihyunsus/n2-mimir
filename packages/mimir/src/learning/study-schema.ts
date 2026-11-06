// Durable study state and replay receipts use module-owned tables.
import type { SqlConnection } from '../store/connection.js';

export function initializeStudy(connection: SqlConnection): void {
  connection.transaction(() => {
    const version = connection.query<{ value: string }>("SELECT value FROM meta WHERE key='mimir_study_schema_version'")[0]?.value;
    if (version !== undefined && version !== '1') throw new Error('Unsupported Mimir study schema version');
    connection.execute(`CREATE TABLE IF NOT EXISTS mimir_study_sessions (
      id TEXT PRIMARY KEY,agent TEXT NOT NULL,topic TEXT NOT NULL,project TEXT NOT NULL DEFAULT 'default',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','cancelled')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT)`);
    connection.execute(`CREATE TABLE IF NOT EXISTS mimir_study_entries (
      id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES mimir_study_sessions(id) ON DELETE CASCADE,
      topic TEXT NOT NULL,action TEXT NOT NULL,outcome TEXT NOT NULL,
      entry_type TEXT NOT NULL CHECK(entry_type IN ('success','correction','failure','pattern')),
      category TEXT DEFAULT '',created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    connection.execute(`CREATE TABLE IF NOT EXISTS mimir_study_results (
      session_id TEXT PRIMARY KEY REFERENCES mimir_study_sessions(id) ON DELETE CASCADE,result_json TEXT NOT NULL)`);
    connection.execute('CREATE INDEX IF NOT EXISTS idx_study_entries_session ON mimir_study_entries(session_id)');
    connection.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('mimir_study_schema_version','1')");
  });
}
