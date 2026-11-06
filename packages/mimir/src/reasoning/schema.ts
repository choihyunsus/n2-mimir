// Additive module-owned tables. Shared Soul/Mimir schema_version remains version 2.
import type { SqlConnection } from '../store/connection.js';

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS mimir_reasoning_atoms (
    atom_id TEXT PRIMARY KEY,
    atom_type TEXT NOT NULL CHECK(atom_type IN ('premise','reasoning','hypothesis','verification','conclusion')),
    content TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 0.7,
    is_verified INTEGER NOT NULL DEFAULT 0, depth INTEGER NOT NULL DEFAULT 0,
    insight_id TEXT REFERENCES insights(id) ON DELETE SET NULL,
    experience_id TEXT REFERENCES experiences(id) ON DELETE SET NULL,
    agent TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS mimir_atom_deps (
    parent_atom_id TEXT NOT NULL REFERENCES mimir_reasoning_atoms(atom_id) ON DELETE CASCADE,
    child_atom_id TEXT NOT NULL REFERENCES mimir_reasoning_atoms(atom_id) ON DELETE CASCADE,
    PRIMARY KEY(parent_atom_id, child_atom_id)
  )`,
  `CREATE TABLE IF NOT EXISTS mimir_evidence_invalidations (
    experience_id TEXT PRIMARY KEY REFERENCES experiences(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  'CREATE INDEX IF NOT EXISTS idx_atoms_insight ON mimir_reasoning_atoms(insight_id)',
  'CREATE INDEX IF NOT EXISTS idx_atoms_experience ON mimir_reasoning_atoms(experience_id)',
  'CREATE INDEX IF NOT EXISTS idx_atom_deps_child ON mimir_atom_deps(child_atom_id)',
];

export function initializeReasoning(connection: SqlConnection): void {
  connection.transaction(() => {
    const version = connection.query<{ value: string }>("SELECT value FROM meta WHERE key='mimir_reasoning_schema_version'")[0]?.value;
    if (version !== undefined && version !== '1') throw new Error('Unsupported Mimir reasoning schema version');
    for (const statement of STATEMENTS) connection.execute(statement);
    connection.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('mimir_reasoning_schema_version','1')");
  });
}
