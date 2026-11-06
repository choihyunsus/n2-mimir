// MimirDatabase — Fallback implementation using better-sqlite3
// Extracted from database.ts to keep files under 500 lines (Pillar 2)

import type {
  ExperienceEntry, ExperienceInput, ExperienceFilter,
  Insight, InsightInput, InsightFilter,
  TagChain, TagFrequency, RankedExperience,
  EffectMeasurement,
} from '../types.js';
import { SCHEMA_SQL } from './schema.js';
import { EXPERIENCE_SCOPE_SQL, scopeParams } from './scope.js';
import { linkSources } from './sources.js';
import { encodeVector, decodeVector } from './vector.js';
import type { MemoryScope } from '../types.js';
import { runMigrations } from './migrations.js';
import { sanitizeFtsQuery } from './fts.js';
import type BetterSqlite3 from 'better-sqlite3';
import { randomUUID, randomBytes } from 'crypto';

/** Generate a UUID v4 */
function uuid(): string {
  if (randomUUID) return randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = randomBytes(1)[0] & 0xf;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Estimate token cost (rough: 1 token ≈ 4 chars) */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * FallbackStore — better-sqlite3 implementation of all Mimir database operations.
 * Used when Rust native module is not available.
 */
export class FallbackStore {
  readonly db: BetterSqlite3.Database;

  constructor(db: BetterSqlite3.Database) {
    this.db = db;
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.transaction(() => {
      this.db.exec(SCHEMA_SQL);
      runMigrations(this.db);
    }).immediate();
  }

  // === Experience CRUD ===

  insertExperience(input: ExperienceInput): ExperienceEntry {
    scopeParams(input);
    const id = uuid();
    const now = new Date().toISOString();
    const tokenCost = estimateTokens(
      `${input.context} ${input.action} ${input.outcome} ${input.correction ?? ''}`
    );

    this.db.prepare(`
      INSERT INTO experiences (id, session_id, agent, project, type, category, severity,
        context, action, outcome, correction, source_ref, frequency, token_cost, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      id, input.sessionId ?? '', input.agent, input.project,
      input.type, input.category, input.severity ?? 'info',
      input.context, input.action, input.outcome,
      input.correction ?? null, input.sourceRef ?? null,
      tokenCost, now,
    );

    return this.getExperience(id)!;
  }

  getExperience(id: string): ExperienceEntry | undefined {
    const row = this.db.prepare('SELECT * FROM experiences WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapExperience(row) : undefined;
  }

  queryExperiences(filter: ExperienceFilter): ExperienceEntry[] {
    scopeParams(filter);
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];

    if (filter.project) { conditions.push('project = ?'); params.push(filter.project); }
    if (filter.agent) { conditions.push('agent = ?'); params.push(filter.agent); }
    if (filter.category) { conditions.push('category = ?'); params.push(filter.category); }
    if (filter.type) { conditions.push('type = ?'); params.push(filter.type); }
    if (filter.severity) { conditions.push('severity = ?'); params.push(filter.severity); }
    if (filter.since) { conditions.push('created_at >= ?'); params.push(filter.since); }

    const limit = filter.limit ?? 100;
    const sql = `SELECT * FROM experiences WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.mapExperience(r));
  }

  searchExperiences(query: string, limit: number, scope?: MemoryScope): RankedExperience[] {
    const ownerParameters = scopeParams(scope);
    // Sanitize FTS5 query: escape special characters to prevent MATCH syntax errors
    const sanitized = sanitizeFtsQuery(query);
    if (!sanitized) return [];

      const sql = `
        SELECT e.*, rank
        FROM experiences_fts fts
        JOIN experiences e ON e.rowid = fts.rowid
        WHERE experiences_fts MATCH ? AND ${EXPERIENCE_SCOPE_SQL}
        ORDER BY rank
        LIMIT ?
      `;
      const rows = this.db.prepare(sql).all(sanitized, ...ownerParameters, limit) as Array<Record<string, unknown>>;
      return rows.map((r, i) => ({
        experience: this.mapExperience(r),
        rank: i + 1,
      }));
  }

  // === Insight CRUD ===

  insertInsight(input: InsightInput): Insight {
    scopeParams(input);
    if (input.project !== undefined && input.sourceIds === undefined) throw new Error('Project-scoped insertion requires source IDs');
    const id = uuid();
    const now = new Date().toISOString();
    const tokenCost = input.tokenCost ?? estimateTokens(input.compressed || input.description);

    return this.db.transaction(() => {
    this.db.prepare(`
      INSERT INTO insights (id, created_at, updated_at, agent, description, compressed,
        token_cost, category, scope, importance, confidence, effect_score, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 2, 0.5, 0.0, 'active')
    `).run(id, now, now, input.agent, input.description, input.compressed, tokenCost, input.category, input.scope ?? 'project');

    if (input.sourceIds !== undefined) {
      linkSources(this.db, id, input.sourceIds);
      if (input.project !== undefined) {
        const source = this.getExperience(input.sourceIds[0]);
        if (source?.project !== input.project) throw new Error('Source project differs from requested project');
      }
    }
    return this.getInsight(id)!;
    }).immediate();
  }

  reinforceInsight(id: string, sources: ReadonlyArray<string>): number {
    return this.db.transaction(() => {
      const added = linkSources(this.db, id, sources);
      if (added > 0) this.upvoteInsight(id);
      return added;
    }).immediate();
  }

  getInsight(id: string): Insight | undefined {
    const row = this.db.prepare('SELECT * FROM insights WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapInsight(row) : undefined;
  }

  queryInsights(filter: InsightFilter): Insight[] {
    scopeParams(filter);
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    if (filter.id !== undefined) { conditions.push('id = ?'); params.push(filter.id); }

    if (filter.agent) { conditions.push('agent = ?'); params.push(filter.agent); }
    if (filter.project !== undefined) {
      scopeParams({ project: filter.project, agent: filter.agent });
      conditions.push(`(scope IN ('global','agent') OR (
        EXISTS (SELECT 1 FROM experience_insight_links l JOIN experiences e ON e.id=l.experience_id
          WHERE l.insight_id=insights.id AND l.relation='supports' AND e.project=? AND e.agent=insights.agent)
        AND NOT EXISTS (SELECT 1 FROM experience_insight_links l JOIN experiences e ON e.id=l.experience_id
          WHERE l.insight_id=insights.id AND (e.project<>? OR e.agent<>insights.agent))))`);
      params.push(filter.project, filter.project);
    }
    if (filter.category) { conditions.push('category = ?'); params.push(filter.category); }
    if (filter.scope) { conditions.push('scope = ?'); params.push(filter.scope); }
    if (filter.status) { conditions.push('status = ?'); params.push(filter.status); }
    if (filter.minImportance != null) { conditions.push('importance >= ?'); params.push(filter.minImportance); }

    const limit = filter.limit ?? 50;
    const sql = `SELECT * FROM insights WHERE ${conditions.join(' AND ')} ORDER BY importance DESC, effect_score DESC LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.mapInsight(r));
  }

  // === Voting ===

  upvoteInsight(id: string): void {
    this.db.prepare(
      "UPDATE insights SET importance = importance + 1, updated_at = datetime('now') WHERE id = ?"
    ).run(id);
  }

  downvoteInsight(id: string): void {
    this.db.prepare(
      "UPDATE insights SET importance = MAX(0, importance - 1), status = CASE WHEN importance <= 1 THEN 'retired' ELSE status END, updated_at = datetime('now') WHERE id = ?"
    ).run(id);
  }

  graduateInsight(id: string, convertedType: string, convertedRef: string): void {
    this.db.prepare(
      "UPDATE insights SET status = 'graduated', converted_type = ?, converted_ref = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(convertedType, convertedRef, id);
  }

  // === Tags ===

  setTags(experienceId: string, tags: ReadonlyArray<TagChain>): void {
    const del = this.db.prepare('DELETE FROM tags WHERE experience_id = ?');
    const ins = this.db.prepare('INSERT INTO tags (experience_id, level, tag) VALUES (?, ?, ?)');
    this.db.transaction(() => {
      del.run(experienceId);
      for (const t of tags) {
        ins.run(experienceId, t.level, t.tag);
      }
    })();
  }

  getTagFrequencies(tags: ReadonlyArray<string>, limit: number, scope?: MemoryScope): TagFrequency[] {
    if (tags.length === 0) return [];
    const placeholders = tags.map(() => '?').join(',');
    const sql = `SELECT level, tag, COUNT(*) as frequency FROM tags t JOIN experiences e ON e.id = t.experience_id WHERE tag IN (${placeholders}) AND ${EXPERIENCE_SCOPE_SQL} GROUP BY level, tag ORDER BY frequency DESC LIMIT ?`;
    return this.db.prepare(sql).all(...tags, ...scopeParams(scope), limit) as TagFrequency[];
  }

  findExperiencesByTags(tags: ReadonlyArray<string>, limit: number, scope?: MemoryScope): ExperienceEntry[] {
    if (tags.length === 0) return [];
    const placeholders = tags.map(() => '?').join(',');
    const sql = `SELECT DISTINCT e.* FROM experiences e JOIN tags t ON t.experience_id = e.id WHERE t.tag IN (${placeholders}) AND ${EXPERIENCE_SCOPE_SQL} ORDER BY e.created_at DESC LIMIT ?`;
    const rows = this.db.prepare(sql).all(...tags, ...scopeParams(scope), limit) as Record<string, unknown>[];
    return rows.map((r) => this.mapExperience(r));
  }

  // === Effect tracking ===

  recordEffect(measurement: EffectMeasurement, applyVote = false): boolean {
    const { insightId, sessionId, wasRelevant, wasFollowed, outcome } = measurement;
    if (typeof insightId !== 'string' || !insightId.trim() ||
        typeof sessionId !== 'string' || !sessionId.trim() ||
        typeof wasRelevant !== 'boolean' || typeof wasFollowed !== 'boolean' ||
        !['positive', 'negative', 'neutral'].includes(outcome)) {
      throw new Error('Invalid effect measurement');
    }
    return this.db.transaction(() => {
      const previous = this.db.prepare(`
        SELECT was_relevant, was_followed, outcome FROM effect_tracking
        WHERE insight_id = ? AND session_id = ? ORDER BY id DESC LIMIT 1
      `).get(insightId, sessionId) as { was_relevant: number; was_followed: number; outcome: string } | undefined;
      if (previous) {
        if (previous.was_relevant !== Number(wasRelevant) ||
            previous.was_followed !== Number(wasFollowed) || previous.outcome !== outcome) {
          throw new Error('Conflicting effect measurement for this insight and session');
        }
        return false;
      }
      this.db.prepare(`
      INSERT INTO effect_tracking (insight_id, session_id, was_relevant, was_followed, outcome)
      VALUES (?, ?, ?, ?, ?)
      `).run(insightId, sessionId, Number(wasRelevant), Number(wasFollowed), outcome);
      this.updateEffectScore(insightId);
      if (applyVote && outcome === 'positive' && wasFollowed) this.upvoteInsight(insightId);
      if (applyVote && outcome === 'negative' && wasRelevant) this.downvoteInsight(insightId);
      return true;
    }).immediate();
  }

  private updateEffectScore(insightId: string): void {
    const result = this.db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN outcome = 'positive' THEN 1 ELSE 0 END) as positive
      FROM (
        SELECT outcome FROM effect_tracking WHERE id IN (
          SELECT MAX(id) FROM effect_tracking WHERE insight_id = ? GROUP BY session_id
        )
        ORDER BY created_at DESC, id DESC LIMIT 10
      )
    `).get(insightId) as { total: number; positive: number } | undefined;

    if (result && result.total > 0) {
      const score = result.positive / result.total;
      this.db.prepare("UPDATE insights SET effect_score = ?, updated_at = datetime('now') WHERE id = ?").run(score, insightId);
    }
  }

  // === Stats ===

  getStats(): { experiences: number; insights: number; tags: number } {
    const exp = this.db.prepare('SELECT COUNT(*) as c FROM experiences').get() as { c: number };
    const ins = this.db.prepare('SELECT COUNT(*) as c FROM insights').get() as { c: number };
    const tag = this.db.prepare('SELECT COUNT(*) as c FROM tags').get() as { c: number };
    return { experiences: exp.c, insights: ins.c, tags: tag.c };
  }

  // === Embeddings ===

  storeEmbedding(sourceType: string, sourceId: string, vector: readonly number[], model: string): void {
    const id = uuid();
    const vectorBlob = encodeVector(vector);

    this.db.prepare(`
      INSERT OR REPLACE INTO embeddings (id, source_type, source_id, vector, model)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, sourceType, sourceId, vectorBlob, model);
  }

  getEmbedding(sourceType: string, sourceId: string): { vector: readonly number[]; model: string } | null {
    const row = this.db.prepare(`
      SELECT vector, model FROM embeddings
      WHERE source_type = ? AND source_id = ?
      ORDER BY created_at DESC, rowid DESC LIMIT 1
    `).get(sourceType, sourceId) as { vector: Buffer; model: string } | undefined;

    if (!row) return null;
    return { vector: decodeVector(row.vector), model: row.model };
  }

  getAllEmbeddings(): Array<{ sourceType: string; sourceId: string; vector: readonly number[]; model: string }> {
    const rows = this.db.prepare(`
      SELECT source_type, source_id, vector, model FROM embeddings
    `).all() as Array<{ source_type: string; source_id: string; vector: Buffer; model: string }>;

    return rows.map((row) => {
      return {
        sourceType: row.source_type,
        sourceId: row.source_id,
        vector: decodeVector(row.vector),
        model: row.model,
      };
    });
  }

  // === Layer Intersection ===

  findByTagsIntersection(tagLayers: ReadonlyArray<ReadonlyArray<string>>, limit: number, scope?: MemoryScope): ExperienceEntry[] {
    if (tagLayers.length === 0) return [];

    const joins: string[] = [];
    const params: unknown[] = [];

    for (let i = 0; i < tagLayers.length; i++) {
      const layer = tagLayers[i];
      if (layer.length === 0) continue;
      const placeholders = layer.map(() => '?').join(',');
      joins.push(
        `JOIN tags t${i} ON t${i}.experience_id = e.id AND t${i}.tag IN (${placeholders})`
      );
      params.push(...layer);
    }

    if (joins.length === 0) return [];

    const sql = `SELECT DISTINCT e.* FROM experiences e ${joins.join(' ')} WHERE ${EXPERIENCE_SCOPE_SQL} ORDER BY e.created_at DESC LIMIT ?`;
    params.push(...scopeParams(scope), limit);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.mapExperience(r));
  }

  // === Delta Learning ===

  upsertExperience(input: ExperienceInput): { isNew: boolean; id: string } {
    return this.db.transaction(() => {
      const existing = this.db.prepare(`
        SELECT id FROM experiences
        WHERE agent = ? AND project = ? AND category = ? AND action = ?
          AND type = ? AND context = ? AND outcome = ? AND severity = ?
          AND correction IS ? AND source_ref IS ? AND session_id = ?
        ORDER BY created_at, id LIMIT 1
      `).get(input.agent, input.project, input.category, input.action,
        input.type, input.context, input.outcome, input.severity ?? 'info',
        input.correction ?? null, input.sourceRef ?? null, input.sessionId ?? '') as { id: string } | undefined;
      if (existing) {
        if (!input.sourceRef?.trim()) {
          this.db.prepare('UPDATE experiences SET frequency = frequency + 1 WHERE id = ?').run(existing.id);
        }
        return { isNew: false, id: existing.id };
      }
      return { isNew: true, id: this.insertExperience(input).id };
    }).immediate();
  }

  // === Tag Similarity ===

  findSimilarTags(tag: string, autoOnly: boolean): Array<{ tag: string; confidence: number }> {
    const threshold = autoOnly ? 0.9 : 0.0;
    const rows = this.db.prepare(`
      SELECT
        CASE WHEN tag_a = ? THEN tag_b ELSE tag_a END as similar_tag,
        confidence
      FROM tag_similarity
      WHERE (tag_a = ? OR tag_b = ?) AND confidence >= ?
      ORDER BY confidence DESC
    `).all(tag, tag, tag, threshold) as Array<{ similar_tag: string; confidence: number }>;

    return rows.map((r) => ({ tag: r.similar_tag, confidence: r.confidence }));
  }

  upsertTagSimilarity(tagA: string, tagB: string): void {
    const [a, b] = tagA < tagB ? [tagA, tagB] : [tagB, tagA];

    const existing = this.db.prepare(
      'SELECT id, confirmed_count FROM tag_similarity WHERE tag_a = ? AND tag_b = ?'
    ).get(a, b) as { id: number; confirmed_count: number } | undefined;

    if (existing) {
      const newCount = existing.confirmed_count + 1;
      const newConfidence = 1 - (1 / (newCount + 1));
      this.db.prepare(`
        UPDATE tag_similarity
        SET confidence = ?, confirmed_count = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(newConfidence, newCount, existing.id);
    } else {
      this.db.prepare(`
        INSERT INTO tag_similarity (tag_a, tag_b, confidence, confirmed_count)
        VALUES (?, ?, 0.5, 1)
      `).run(a, b);
    }
  }

  // === Row mappers ===

  mapExperience(row: Record<string, unknown>): ExperienceEntry {
    return {
      id: row['id'] as string,
      timestamp: row['timestamp'] as string,
      sessionId: row['session_id'] as string,
      agent: row['agent'] as string,
      project: row['project'] as string,
      type: row['type'] as ExperienceEntry['type'],
      category: row['category'] as string,
      severity: row['severity'] as ExperienceEntry['severity'],
      context: row['context'] as string,
      action: row['action'] as string,
      outcome: row['outcome'] as string,
      correction: row['correction'] as string | undefined,
      sourceRef: row['source_ref'] as string | undefined,
      frequency: row['frequency'] as number,
      tokenCost: row['token_cost'] as number,
      createdAt: row['created_at'] as string,
    };
  }

  mapInsight(row: Record<string, unknown>): Insight {
    return {
      id: row['id'] as string,
      createdAt: row['created_at'] as string,
      updatedAt: row['updated_at'] as string,
      agent: row['agent'] as string,
      description: row['description'] as string,
      compressed: row['compressed'] as string,
      tokenCost: row['token_cost'] as number,
      category: row['category'] as string,
      scope: row['scope'] as Insight['scope'],
      importance: row['importance'] as number,
      confidence: row['confidence'] as number,
      effectScore: row['effect_score'] as number,
      status: row['status'] as Insight['status'],
      convertedType: row['converted_type'] as string | undefined,
      convertedRef: row['converted_ref'] as string | undefined,
    };
  }
}
