// Preserve owner-scoped evidence using the existing Soul-compatible link table.
import type Database from 'better-sqlite3';

export function linkSources(db: Database.Database, insightId: string, ids: ReadonlyArray<string>): number {
  if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) throw new Error('Require 1-100 distinct source IDs');
  if (ids.some(id => typeof id !== 'string' || !id.trim() || id.length > 512)) throw new Error('Invalid source ID');
  const insight = db.prepare('SELECT agent FROM insights WHERE id=?').get(insightId) as { agent: string } | undefined;
  if (!insight) throw new Error('Insight does not exist');
  const existing = db.prepare(`SELECT DISTINCT e.project,e.agent FROM experience_insight_links l
    JOIN experiences e ON e.id=l.experience_id WHERE l.insight_id=?`).all(insightId) as Array<{ project: string; agent: string }>;
  const sources = ids.map(id => {
    const row = db.prepare('SELECT project,agent FROM experiences WHERE id=?').get(id) as { project: string; agent: string } | undefined;
    if (!row) throw new Error('Source experience does not exist');
    return row;
  });
  const project = existing[0]?.project ?? sources[0].project;
  if ([...existing, ...sources].some(source => source.project !== project || source.agent !== insight.agent)) {
    throw new Error('Insight sources must share one project and the insight owner');
  }
  const insert = db.prepare("INSERT OR IGNORE INTO experience_insight_links(experience_id,insight_id,relation) VALUES (?,?,'supports')");
  return ids.reduce((count, id) => count + insert.run(id, insightId).changes, 0);
}
