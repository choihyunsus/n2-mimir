// Scoped browsing, conservative merge, temporal ranking and evidence previews.
import type { MimirDatabase } from '../store/database.js';
import type { MemoryScope, InsightStatus } from '../types.js';
import { requireScope } from '../store/scope.js';
import { initializeMaintenance } from './maintenance-schema.js';
import { archiveExperiences } from './preview.js';
import { freshnessSql } from '../analyzer/temporal.js';

const OWNED_PROJECT = `EXISTS(SELECT 1 FROM experience_insight_links l JOIN experiences e ON e.id=l.experience_id
  WHERE l.insight_id=insights.id AND e.project=? AND e.agent=insights.agent)
  AND NOT EXISTS(SELECT 1 FROM experience_insight_links l JOIN experiences e ON e.id=l.experience_id
  WHERE l.insight_id=insights.id AND (e.project<>? OR e.agent<>insights.agent))`;
export interface BrowseRequest extends Required<MemoryScope> {
  query?: string; category?: string; status?: InsightStatus; limit?: number; offset?: number;
  sort?: 'importance' | 'freshness';
}

export class MaintenanceStore {
  constructor(private readonly db: MimirDatabase) { initializeMaintenance(this.connection); }
  private get connection() { return this.db.reasoning.connection; }

  browseInsights(request: BrowseRequest) {
    requireScope(request);
    const { query = '', category = '', status = '', limit = 50, offset = 0 } = request;
    if (query.length > 1000 || category.length > 128 || !Number.isInteger(limit) || limit < 1 || limit > 200 ||
        !Number.isInteger(offset) || offset < 0) throw new Error('Invalid insight browse request');
    const fts = query.match(/[\p{L}\p{N}_]+/gu)?.map(token => `"${token}"`).join(' OR ') ?? '';
    const where = `agent=? AND (scope IN ('global','agent') OR (${OWNED_PROJECT}))
      AND (?='' OR category=?) AND (?='' OR status=?)
      AND (?='' OR (?<>'' AND rowid IN(SELECT rowid FROM insights_fts WHERE insights_fts MATCH ?)))`;
    const values = [request.agent, request.project, request.project, category, category, status, status, query.trim(), fts, fts];
    const ordering = request.sort === 'freshness' ? `(${freshnessSql('updated_at')})*MAX(1,importance)` : 'importance';
    return this.connection.transaction(() => {
      const ids = this.connection.query<{ id: string }>(`SELECT id FROM insights WHERE ${where}
        ORDER BY ${ordering} DESC,effect_score DESC,id LIMIT ? OFFSET ?`, [...values, limit, offset]);
      const summary = this.connection.query<{ total: number; averageImportance: number; averageEffect: number }>(`
        SELECT COUNT(*) AS total,COALESCE(AVG(importance),0) AS averageImportance,
        COALESCE(AVG(effect_score),0) AS averageEffect FROM insights WHERE ${where}`, values)[0];
      const statuses = this.connection.query<{ status: InsightStatus; count: number }>(
        `SELECT status,COUNT(*) AS count FROM insights WHERE ${where} GROUP BY status`, values);
      return { results: ids.map(row => this.db.getInsight(row.id)!), limit, offset, ...summary,
        byStatus: Object.fromEntries(statuses.map(row => [row.status, row.count])) };
    });
  }

  mergeDuplicates(scope: Required<MemoryScope>, category: string): string[] {
    requireScope(scope);
    return this.connection.transaction(() => {
      const candidates = this.connection.query<{ id: string; description: string; compressed: string }>(`
        SELECT id,description,compressed FROM insights WHERE agent=? AND category=? AND status='active'
        AND scope='project' AND ${OWNED_PROJECT} ORDER BY importance DESC,id`,
      [scope.agent, category, scope.project, scope.project]);
      const keepers = new Map<string, string>();
      const retired: string[] = [];
      for (const candidate of candidates) {
        if (!candidate.description.trim()) continue;
        const key = JSON.stringify([candidate.description.trim(), candidate.compressed.trim()]);
        const keeper = keepers.get(key);
        if (!keeper) { keepers.set(key, candidate.id); continue; }
        this.connection.execute(`INSERT OR IGNORE INTO experience_insight_links(experience_id,insight_id,relation)
          SELECT experience_id,?,relation FROM experience_insight_links WHERE insight_id=?`, [keeper, candidate.id]);
        this.db.reasoning.buildInsightChain(keeper);
        this.connection.execute("UPDATE insights SET status='retired',updated_at=datetime('now') WHERE id=?", [candidate.id]);
        retired.push(candidate.id);
      }
      return retired;
    });
  }

  archiveExperiences(scope: Required<MemoryScope>): number { return archiveExperiences(this.connection, scope); }

  freshExperiences(scope: Required<MemoryScope>, category = '', limit = 20) {
    requireScope(scope);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Invalid fresh experience limit');
    const rows = this.connection.query<{ id: string; freshness: number }>(`
      SELECT id,${freshnessSql('created_at')} AS freshness FROM experiences
      WHERE agent=? AND project=? AND (?='' OR category=?) ORDER BY freshness DESC,id LIMIT ?`,
    [scope.agent, scope.project, category, category, limit]);
    return rows.map(row => ({ experience: this.db.getExperience(row.id)!, freshness: row.freshness }));
  }
}
