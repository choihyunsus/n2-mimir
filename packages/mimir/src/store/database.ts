// MimirDatabase — Rust-first, better-sqlite3 fallback
// Architecture: Rust core handles all I/O via napi-rs bindings.
// If native module unavailable, falls back to better-sqlite3 (TS).

import type {
  ExperienceEntry, ExperienceInput, ExperienceFilter,
  Insight, InsightInput, InsightFilter,
  TagChain, TagFrequency, RankedExperience,
  EffectMeasurement,
} from '../types.js';
import type { MemoryScope } from '../types.js';
import { getNativeBinding } from './native.js';
import type { NativeBinding } from './native.js';
import { FallbackStore } from './database-fallback.js';
import type BetterSqlite3 from 'better-sqlite3';
// ESM-CJS interop: better-sqlite3 is a native CJS module,
// createRequire is needed to load it from ESM context.
import { createRequire } from 'node:module';
import { extensionConnection } from './connection.js';
import { ReasoningStore } from '../reasoning/store.js';
import { StudyStore } from '../learning/study.js';
import { MaintenanceStore } from '../learning/maintenance.js';
import { sanitizeFtsQuery, validateReadLimit } from './fts.js';
import { experienceInput, validateInsightInput } from './validate.js';

const DEFAULT_RECALL_LIMIT = 20;

/**
 * MimirDatabase — hybrid Rust/TS database wrapper.
 *
 * Strategy:
 * - If Rust native module is available → delegates all operations to Rust (rusqlite)
 * - If not → falls back to better-sqlite3 (TypeScript) via FallbackStore
 *
 * This ensures the package works even without compiled Rust bindings,
 * while providing maximum performance when they're available.
 */
export class MimirDatabase {
  readonly reasoning: ReasoningStore;
  readonly study: StudyStore;
  readonly maintenance: MaintenanceStore;
  private closed = false;

  get isClosed(): boolean { return this.closed; }
  private readonly native: NativeBinding | null;
  private readonly nativeHandle: number | null;
  private readonly fallback: FallbackStore | null;
  private readonly mode: 'rust' | 'fallback';

  constructor(dbPath: string) {
    this.native = getNativeBinding();

    if (this.native) {
      this.nativeHandle = this.native.openDatabase(dbPath);
      this.fallback = null;
      this.mode = 'rust';
    } else {
      this.nativeHandle = null;
      const connection = this.loadBetterSqlite3(dbPath);
      try { this.fallback = new FallbackStore(connection); }
      catch (error) { connection.close(); throw error; }
      this.mode = 'fallback';
    }
    try {
      this.reasoning = new ReasoningStore(extensionConnection(this.native, this.nativeHandle, this.fallback?.db));
      this.study = new StudyStore(this);
      this.maintenance = new MaintenanceStore(this);
    } catch (error) { this.close(); throw error; }
  }

  /** Load better-sqlite3 with ESM/CJS interop */
  private loadBetterSqlite3(dbPath: string): BetterSqlite3.Database {
    let loadModule: NodeRequire;
    if (typeof import.meta.url === 'string' && import.meta.url !== '') {
      loadModule = createRequire(import.meta.url);
    } else {
      // CJS context: require is natively available (tsup bundles __require shim)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      loadModule = require;
    }
    let Database: typeof BetterSqlite3;
    try {
      Database = loadModule('better-sqlite3') as typeof BetterSqlite3;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[n2-mimir] Failed to load better-sqlite3: ${msg}\n\n` +
        `Install it with: npm install better-sqlite3\n` +
        `Requirements: Node.js >= 20, Python 3, C++ Build Tools\n` +
        `  - Windows: Visual Studio C++ Build Tools\n` +
        `  - macOS: xcode-select --install\n` +
        `  - Linux: sudo apt-get install build-essential python3`,
      );
    }
    return new Database(dbPath);
  }

  /** Get current engine mode */
  getMode(): 'rust' | 'fallback' {
    return this.mode;
  }

  // === Experience CRUD ===

  insertExperience(input: ExperienceInput): ExperienceEntry {
    input = experienceInput(input);
    if (this.native && this.nativeHandle !== null) {
      const id = this.native.insertExperience(this.nativeHandle, JSON.stringify(input));
      const json = this.native.getExperience(this.nativeHandle, id);
      return JSON.parse(json) as ExperienceEntry;
    }
    return this.fallback!.insertExperience(input);
  }

  getExperience(id: string): ExperienceEntry | undefined {
    if (this.native && this.nativeHandle !== null) {
      const json = this.native.getExperience(this.nativeHandle, id);
      return json ? JSON.parse(json) as ExperienceEntry : undefined;
    }
    return this.fallback!.getExperience(id);
  }

  queryExperiences(filter: ExperienceFilter): ExperienceEntry[] {
    validateReadLimit(filter.limit ?? 100);
    if (this.native && this.nativeHandle !== null) {
      const json = this.native.queryExperiences(this.nativeHandle, JSON.stringify(filter));
      return JSON.parse(json) as ExperienceEntry[];
    }
    return this.fallback!.queryExperiences(filter);
  }

  // === FTS5 Search ===

  searchExperiences(query: string, limit = DEFAULT_RECALL_LIMIT, scope?: MemoryScope): RankedExperience[] {
    validateReadLimit(limit);
    query = sanitizeFtsQuery(query);
    if (this.native && this.nativeHandle !== null) {
      const json = this.native.searchExperiences(this.nativeHandle, query, limit, JSON.stringify(scope ?? {}));
      return JSON.parse(json) as RankedExperience[];
    }
    return this.fallback!.searchExperiences(query, limit, scope);
  }

  // === Insight CRUD ===

  insertInsight(input: InsightInput): Insight {
    validateInsightInput(input);
    return this.reasoning.connection.transaction(() => {
      const insight = this.insertInsightRow(input);
      if (input.sourceIds?.length) this.reasoning.buildInsightChain(insight.id);
      return this.getInsight(insight.id)!;
    });
  }

  private insertInsightRow(input: InsightInput): Insight {
    if (this.native && this.nativeHandle !== null) {
      const id = this.native.insertInsight(this.nativeHandle, JSON.stringify(input));
      const json = this.native.getInsight(this.nativeHandle, id);
      return JSON.parse(json) as Insight;
    }
    return this.fallback!.insertInsight(input);
  }

  getInsight(id: string): Insight | undefined {
    if (this.native && this.nativeHandle !== null) {
      const json = this.native.getInsight(this.nativeHandle, id);
      return json ? JSON.parse(json) as Insight : undefined;
    }
    return this.fallback!.getInsight(id);
  }

  reinforceInsight(id: string, sources: ReadonlyArray<string>): number {
    return this.reasoning.connection.transaction(() => {
      const added = this.reinforceInsightRow(id, sources);
      this.reasoning.buildInsightChain(id);
      return added;
    });
  }

  private reinforceInsightRow(id: string, sources: ReadonlyArray<string>): number {
    if (this.native && this.nativeHandle !== null) {
      return this.native.reinforceInsight(this.nativeHandle, id, JSON.stringify(sources));
    }
    return this.fallback!.reinforceInsight(id, sources);
  }

  queryInsights(filter: InsightFilter): Insight[] {
    validateReadLimit(filter.limit ?? 50);
    if (this.native && this.nativeHandle !== null) {
      const json = this.native.queryInsights(this.nativeHandle, JSON.stringify(filter));
      return JSON.parse(json) as Insight[];
    }
    return this.fallback!.queryInsights(filter);
  }

  // === Voting ===

  upvoteInsight(id: string): void {
    if (this.native && this.nativeHandle !== null) {
      this.native.upvoteInsight(this.nativeHandle, id);
      return;
    }
    this.fallback!.upvoteInsight(id);
  }

  downvoteInsight(id: string): void {
    if (this.native && this.nativeHandle !== null) {
      this.native.downvoteInsight(this.nativeHandle, id);
      return;
    }
    this.fallback!.downvoteInsight(id);
  }

  graduateInsight(id: string, convertedType: string, convertedRef: string): void {
    if (this.native && this.nativeHandle !== null) {
      this.native.graduateInsight(this.nativeHandle, id, convertedType, convertedRef);
      return;
    }
    this.fallback!.graduateInsight(id, convertedType, convertedRef);
  }

  // === Tags ===

  setTags(experienceId: string, tags: ReadonlyArray<TagChain>): void {
    if (this.native && this.nativeHandle !== null) {
      this.native.setTags(this.nativeHandle, experienceId, JSON.stringify(tags));
      return;
    }
    this.fallback!.setTags(experienceId, tags);
  }

  getTagFrequencies(tags: ReadonlyArray<string>, limit = 50, scope?: MemoryScope): TagFrequency[] {
    validateReadLimit(limit);
    if (this.native && this.nativeHandle !== null) {
      const json = this.native.getTagFrequencies(this.nativeHandle, JSON.stringify(tags), limit, JSON.stringify(scope ?? {}));
      return JSON.parse(json) as TagFrequency[];
    }
    return this.fallback!.getTagFrequencies(tags, limit, scope);
  }

  findExperiencesByTags(tags: ReadonlyArray<string>, limit = DEFAULT_RECALL_LIMIT, scope?: MemoryScope): ExperienceEntry[] {
    validateReadLimit(limit);
    if (this.native && this.nativeHandle !== null) {
      const json = this.native.findExperiencesByTags(this.nativeHandle, JSON.stringify(tags), limit, JSON.stringify(scope ?? {}));
      return JSON.parse(json) as ExperienceEntry[];
    }
    return this.fallback!.findExperiencesByTags(tags, limit, scope);
  }

  // === Effect tracking ===

  recordEffect(measurement: EffectMeasurement, applyVote = false): boolean {
    if (this.native && this.nativeHandle !== null) {
      return this.native.recordEffect(this.nativeHandle, JSON.stringify(measurement), applyVote);
    }
    return this.fallback!.recordEffect(measurement, applyVote);
  }

  // === Embeddings (Tier 2 semantic search) ===

  storeEmbedding(sourceType: 'experience' | 'insight', sourceId: string, vector: readonly number[], model: string): void {
    if (this.native && this.nativeHandle !== null) {
      this.native.storeEmbedding(this.nativeHandle, sourceType, sourceId, JSON.stringify(vector), model);
      return;
    }
    this.fallback!.storeEmbedding(sourceType, sourceId, vector, model);
  }

  getEmbedding(sourceType: string, sourceId: string): { vector: readonly number[]; model: string } | null {
    if (this.native && this.nativeHandle !== null) {
      const json = this.native.getEmbedding(this.nativeHandle, sourceType, sourceId);
      if (!json) return null;
      return JSON.parse(json) as { vector: number[]; model: string };
    }
    return this.fallback!.getEmbedding(sourceType, sourceId);
  }

  getAllEmbeddings(): Array<{ sourceType: string; sourceId: string; vector: readonly number[]; model: string }> {
    if (this.fallback) return this.fallback.getAllEmbeddings();
    return JSON.parse(this.native!.getAllEmbeddings(this.nativeHandle!));
  }

  // === Utility ===

  getStats(): { experiences: number; insights: number; tags: number } {
    if (this.native && this.nativeHandle !== null) {
      return JSON.parse(this.native.getStats(this.nativeHandle));
    }
    return this.fallback!.getStats();
  }

  close(): void {
    if (this.closed) return;
    if (this.native && this.nativeHandle !== null) {
      this.native.closeDatabase(this.nativeHandle);
    } else if (this.fallback) {
      this.fallback.db.close();
    }
    this.closed = true;
  }

  // === Layer Intersection (architecture.md §8-8) ===

  findExperiencesByTagsIntersection(
    tagLayers: ReadonlyArray<ReadonlyArray<string>>,
    limit = DEFAULT_RECALL_LIMIT,
    scope?: MemoryScope,
  ): ExperienceEntry[] {
    validateReadLimit(limit);
    if (tagLayers.length === 0) return [];
    if (this.native && this.nativeHandle !== null) {
      const json = this.native.findExperiencesByTagsIntersection(this.nativeHandle, JSON.stringify(tagLayers), limit, JSON.stringify(scope ?? {}));
      return JSON.parse(json) as ExperienceEntry[];
    }
    return this.fallback!.findByTagsIntersection(tagLayers, limit, scope);
  }

  // === Delta Learning (architecture.md §8-8 Step 5) ===

  upsertExperience(input: ExperienceInput): { isNew: boolean; id: string } {
    input = experienceInput(input);
    if (this.native && this.nativeHandle !== null) {
      const json = this.native.upsertExperience(this.nativeHandle, JSON.stringify(input));
      return JSON.parse(json) as { isNew: boolean; id: string };
    }
    return this.fallback!.upsertExperience(input);
  }

  // === Tag Similarity (architecture.md §8-8) ===

  findSimilarTags(tag: string, autoOnly = false): Array<{ tag: string; confidence: number }> {
    if (this.native && this.nativeHandle !== null) {
      const json = this.native.findSimilarTags(this.nativeHandle, tag, autoOnly);
      return JSON.parse(json) as Array<{ tag: string; confidence: number }>;
    }
    return this.fallback!.findSimilarTags(tag, autoOnly);
  }

  upsertTagSimilarity(tagA: string, tagB: string): void {
    if (this.native && this.nativeHandle !== null) {
      this.native.upsertTagSimilarity(this.nativeHandle, tagA, tagB);
      return;
    }
    this.fallback!.upsertTagSimilarity(tagA, tagB);
  }
}
