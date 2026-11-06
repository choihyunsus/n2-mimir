// n2-Mímir Public API — standalone experience learning engine
import type {
  MimirConfig, ExperienceInput, ExperienceFilter,
  RawExperience, AssemblyResult, TagChain,
  InsightFilter, Insight, ExperienceAdapter,
} from './types.js';
import { MimirDatabase } from './store/database.js';
import { normalize } from './collector/normalizer.js';
import { GenericAdapter } from './collector/adapters/generic.js';
import { findContrastPairs } from './analyzer/comparator.js';
import { detectRepeatedPatterns } from './analyzer/detector.js';
import { generateFromContrasts, generateFromPatterns } from './insight/generator.js';
import { applyOperations, deduplicateOperations } from './insight/voting.js';
import { retireDormantInsights } from './insight/store.js';
import { recall } from './orchestrator/recall.js';
import type { RecallResultWithConfidence } from './orchestrator/recall.js';
import { classify, extractSearchTerms } from './orchestrator/classifier.js';
import { assemble } from './orchestrator/assembler.js';
import { evaluateGraduation } from './tracker/scorer.js';
import { Embedder } from './semantic/embedder.js';
import { embedAndStore, experienceToText, insightToText, semanticSearch } from './semantic/search.js';
import { autoStudy as runAutoStudy } from './search/auto-study.js';
import type { AutoStudyResult, SearchConfig } from './search/types.js';
import { extractCandidates, storeMemories } from './learning/auto-extract.js';
import type { SessionMessage, MemoryCandidate } from './learning/auto-extract.js';
import type { MemoryScope } from './types.js';

const DEFAULT_CONFIG: Required<MimirConfig> = {
  dbPath: './mimir.db',
  tokenBudget: 500,
  halfLife: 14,
  llm: { provider: 'ollama', model: '', endpoint: '' },
};

/**
 * Mimir — Experience Learning Engine
 *
 * Usage:
 * ```typescript
 * const mimir = new Mimir({ dbPath: './my-experiences.db' });
 *
 * // Add experience
 * mimir.addExperience({ ... });
 *
 * // When user mentions a topic → recall related experience
 * const result = mimir.recall('PowerShell scripting');
 *
 * // Run digest to analyze and generate insights
 * await mimir.digest({ project: 'my-app' });
 *
 * // Get overlay for prompt injection
 * const overlay = mimir.overlay('my-app');
 * ```
 */
export class Mimir {
  private readonly db: MimirDatabase;
  private readonly config: Required<MimirConfig>;
  private readonly adapters: ExperienceAdapter[] = [];
  private readonly genericAdapter: GenericAdapter;
  private readonly embedder: Embedder;

  get reasoning() { return this.db.reasoning; }
  get study() { return this.db.study; }
  get maintenance() { return this.db.maintenance; }

  autoExtract(messages: readonly SessionMessage[], scope: Required<MemoryScope>,
    accept?: (candidate: MemoryCandidate) => boolean): number {
    return storeMemories(this.db, scope, extractCandidates(messages), accept);
  }

  constructor(config?: MimirConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<MimirConfig>;
    this.embedder = new Embedder(this.config.llm);
    this.db = new MimirDatabase(this.config.dbPath);
    this.genericAdapter = new GenericAdapter();
    this.adapters.push(this.genericAdapter);
  }

  /** Register an external experience adapter */
  registerAdapter(adapter: ExperienceAdapter): void {
    this.adapters.push(adapter);
  }

  // === Core API: Experience ===

  /** Add a single experience directly */
  addExperience(input: ExperienceInput): void {
    const filled = this.fillDefaults(input);
    const entry = this.db.insertExperience(filled);
    // Auto-tag generation (architecture.md §8-5 — hybrid method 1: keyword extraction)
    this.autoTag(entry.id, filled);
    // Background embedding (fire-and-forget — doesn't block)
    if (this.embedder.isAvailable()) {
      void embedAndStore(this.db, this.embedder, 'experience', entry.id, experienceToText(entry))
        .catch(error => console.error('[n2-mimir] Embedding storage failed:', error));
    }
  }

  /** Add raw experience (auto-normalized) */
  addRawExperience(raw: RawExperience): boolean {
    const normalized = normalize(raw);
    if (!normalized) return false;
    this.db.insertExperience(normalized);
    return true;
  }

  /** Query stored experiences */
  queryExperiences(filter: ExperienceFilter): ReturnType<MimirDatabase['queryExperiences']> {
    return this.db.queryExperiences(filter);
  }

  // === Core API: Delta Learning (architecture.md §8-8 Step 5) ===

  /**
   * Delta learn: upsert experience (if similar exists → frequency++, else insert).
   * Call this during digest to avoid duplicate experiences.
   */
  deltaLearn(input: ExperienceInput): { isNew: boolean; id: string } {
    const filled = this.fillDefaults(input);
    const result = this.db.upsertExperience(filled);
    // Auto-tag for new experiences only (existing ones already have tags)
    if (result.isNew) {
      this.autoTag(result.id, filled);
    }
    return result;
  }

  // === Core API: Tag Similarity (architecture.md §8-8) ===

  /** Record user-confirmed tag similarity */
  confirmTagSimilarity(tagA: string, tagB: string): void {
    this.db.upsertTagSimilarity(tagA, tagB);
  }

  /** Find similar tags (autoOnly=true → only high-confidence auto-match) */
  findSimilarTags(tag: string, autoOnly = false): Array<{ tag: string; confidence: number }> {
    return this.db.findSimilarTags(tag, autoOnly);
  }

  // === Core API: Recall (the main mechanism) ===

  /**
   * Recall relevant experiences for a given topic.
   * THIS is what fires when the user says something —
   * the orchestrator searches and assembles automatically.
   * Includes confidence level for question sequence (§8-9).
   */
  recall(topic: string, project?: string, agent?: string): RecallResultWithConfidence {
    return recall(this.db, topic, project, agent, 20, this.embedder);
  }

  /**
   * Async recall with full semantic search.
   * Use this when you want cosine similarity results from Ollama embeddings.
   */
  async recallAsync(topic: string, project?: string, agent?: string): Promise<RecallResultWithConfidence> {
    const baseResult = this.recall(topic, project, agent);

    // If semantic search available, enrich with cosine similarity results
    if (this.embedder.isAvailable()) {
      const semanticResults = await semanticSearch(this.db, this.embedder, topic, 10, { project, agent });
      const experienceMap = new Map(baseResult.experiences.map((e) => [e.id, e]));

      for (const sr of semanticResults) {
        if (sr.sourceType === 'experience' && !experienceMap.has(sr.sourceId)) {
          const exp = this.db.getExperience(sr.sourceId);
          if (exp) experienceMap.set(exp.id, exp);
        }
      }

      return { ...baseResult, experiences: [...experienceMap.values()] };
    }

    return baseResult;
  }

  /**
   * Get assembled overlay ready for prompt injection.
   * Calls recall + assemble in one step.
   * Includes question sequence prefix based on confidence.
   */
  overlay(topic: string, project?: string, agent?: string): AssemblyResult {
    const result = this.recall(topic, project, agent);
    return assemble(result, this.config.tokenBudget, this.config.halfLife);
  }

  // === Core API: Digest ===

  /**
   * Digest: collect experiences → analyze patterns → generate insights.
   * Call this at end of session or periodically.
   * Uses delta learning for experience deduplication.
   */
  async digest(options: { project: string; agent?: string }): Promise<{
    collected: number;
    contrasts: number;
    patterns: number;
    insightsCreated: number;
    insightsUpdated: number;
    graduated: string[];
    collectionErrors: Array<{ adapterIndex: number; message: string }>;
    insightErrors: Array<{ operationIndex: number; message: string }>;
    rejected: number;
  }> {
    const collection = await this.collectExperiences(options);

    // Step 2: Analyze recent experiences
    const recentExperiences = this.db.queryExperiences({
      project: options.project,
      agent: options.agent,
      limit: 100,
    });

    const contrastPairs = findContrastPairs(recentExperiences);
    const repeatedPatterns = detectRepeatedPatterns(recentExperiences);

    // Step 3: Generate insight operations
    const contrastOps = generateFromContrasts(contrastPairs);
    const patternOps = generateFromPatterns(repeatedPatterns);
    const allOps = [...contrastOps, ...patternOps];

    // Step 4: Deduplicate (convert ADD to UPVOTE if similar exists)
    const dedupedOps = deduplicateOperations(this.db, allOps);

    // Step 5: Apply operations
    const { applied, created, errors: insightErrors } = applyOperations(this.db, dedupedOps);

    // Step 6: Check graduation + retire dormant
    const graduated = evaluateGraduation(this.db, options);
    retireDormantInsights(this.db, options);

    await this.embedRecent(options);

    return {
      ...collection,
      contrasts: contrastPairs.length,
      patterns: repeatedPatterns.length,
      insightsCreated: created,
      insightsUpdated: applied - created,
      insightErrors,
      graduated,
    };
  }

  private async collectExperiences(options: { project: string; agent?: string }): Promise<{
    collected: number; rejected: number; collectionErrors: Array<{ adapterIndex: number; message: string }>;
  }> {
    // Step 1: Collect from all adapters concurrently (with delta learning)
    let collected = 0;
    let rejected = 0;
    const collectionErrors: Array<{ adapterIndex: number; message: string }> = [];
    const collectionPromises = this.adapters.map(async adapter =>
      adapter.collect(options.project, options.agent ?? 'default')
    );

    const results = await Promise.allSettled(collectionPromises);

    for (const [adapterIndex, result] of results.entries()) {
      try {
        if (result.status === 'rejected') throw result.reason;
        const rawExperiences = result.value;
        for (const raw of rawExperiences) {
          const normalized = normalize({ ...raw, project: raw.project ?? options.project,
            agent: raw.agent ?? options.agent ?? 'default' });
          if (!normalized || normalized.project !== options.project ||
              normalized.agent !== (options.agent ?? 'default')) { rejected++; continue; }
          const upsertResult = this.db.upsertExperience(normalized);
          if (upsertResult.isNew) collected++;
        }
        await this.adapters[adapterIndex].acknowledge?.(rawExperiences);
      } catch (error) {
        collectionErrors.push({ adapterIndex, message: error instanceof Error ? error.message : String(error) });
      }
    }

    return { collected, rejected, collectionErrors };
  }

  private async embedRecent(options: { project: string; agent?: string }): Promise<void> {
    // Step 7: Batch embed new experiences and insights (Tier 2 — if semantic available)
    if (this.embedder.isAvailable()) {
      const newExperiences = this.db.queryExperiences({
        project: options.project, agent: options.agent, limit: 50,
      });
      // Filter to un-embedded experiences only, then batch embed
      const unembeddedExps = newExperiences.filter(
        (exp) => !this.db.getEmbedding('experience', exp.id),
      );
      if (unembeddedExps.length > 0) {
        const expTexts = unembeddedExps.map((exp) => experienceToText(exp));
        const expResults = await this.embedder.embedBatch(expTexts);
        for (let i = 0; i < unembeddedExps.length; i++) {
          const result = expResults[i];
          if (result) {
            this.db.storeEmbedding('experience', unembeddedExps[i].id, result.vector, result.model);
          }
        }
      }

      const activeInsights = this.db.queryInsights({ ...options, status: 'active', limit: 50 });
      const unembeddedIns = activeInsights.filter(
        (ins) => !this.db.getEmbedding('insight', ins.id),
      );
      if (unembeddedIns.length > 0) {
        const insTexts = unembeddedIns.map((ins) => insightToText(ins));
        const insResults = await this.embedder.embedBatch(insTexts);
        for (let i = 0; i < unembeddedIns.length; i++) {
          const result = insResults[i];
          if (result) {
            this.db.storeEmbedding('insight', unembeddedIns[i].id, result.vector, result.model);
          }
        }
      }
    }

  }

  // === Insight access ===

  /** Query insights */
  queryInsights(filter: InsightFilter): Insight[] {
    return this.db.queryInsights(filter);
  }

  /** Get graduated insights (ready for rule conversion) */
  getGraduatedInsights(): Insight[] {
    return this.db.queryInsights({ status: 'graduated' });
  }

  /** Get database statistics */
  getStats(): { experiences: number; insights: number; tags: number } {
    return this.db.getStats();
  }

  /** Upvote an insight (increase importance) */
  upvoteInsight(id: string): void {
    this.db.upvoteInsight(id);
  }

  /** Downvote an insight (decrease importance, may retire) */
  downvoteInsight(id: string): void {
    this.db.downvoteInsight(id);
  }

  // === Private helpers ===

  /** Fill optional agent/project with defaults for standalone usage */
  private fillDefaults(input: ExperienceInput): ExperienceInput & { agent: string; project: string } {
    return {
      ...input,
      agent: input.agent ?? 'default',
      project: input.project ?? 'default',
    };
  }

  /**
   * Auto-generate hierarchical tags from experience content.
   * architecture.md §8-5 Method 1: keyword extraction (fast, instant)
   * Level 1 = category, Level 2 = extracted keywords from text
   */
  private autoTag(experienceId: string, input: ExperienceInput): void {
    const tags: TagChain[] = [];

    // Level 1: category tag
    tags.push({ level: 1, tag: input.category });

    // Level 1: classify domain from text (may add extra category-level tags)
    const text = `${input.context} ${input.action} ${input.outcome}`;
    const domains = classify(text);
    for (const domain of domains) {
      if (domain !== input.category && domain !== 'general') {
        tags.push({ level: 1, tag: domain });
      }
    }

    // Level 2: search terms extracted from text
    const terms = extractSearchTerms(text);
    for (const term of terms.slice(0, 10)) {
      tags.push({ level: 2, tag: term });
    }

    // Level 2: project name as tag (for project-scoped retrieval)
    if (input.project) {
      tags.push({ level: 2, tag: input.project.toLowerCase() });
    }

    // Deduplicate tags (same level+tag can appear from multiple extraction paths)
    const seen = new Set<string>();
    const uniqueTags = tags.filter((t) => {
      const key = `${t.level}:${t.tag}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (uniqueTags.length > 0) {
      this.db.setTags(experienceId, uniqueTags);
    }
  }

  // === Core API: Auto Study (architecture.md §9 — web-based learning) ===

  /**
   * Auto Study: search web → crawl → extract claims → cross-validate → store.
   * Fully automated learning pipeline using DuckDuckGo HTML search.
   */
  async autoStudy(topic: string, config?: SearchConfig): Promise<AutoStudyResult> {
    const embedder = this.embedder.isAvailable() ? this.embedder : undefined;
    return runAutoStudy(topic, this, config, embedder);
  }

  /** Close database */
  close(): void {
    this.db.close();
  }
}

// Re-export types for consumers
export type {
  ExperienceEntry, ExperienceInput, ExperienceFilter,
  Insight, InsightInput, InsightFilter,
  RawExperience, RecallResult, AssemblyResult,
  MimirConfig, ExperienceAdapter, LlmConfig, MemoryScope,
} from './types.js';

// Re-export recall types
export type { RecallResultWithConfidence, RecallConfidence } from './orchestrator/recall.js';

// Re-export semantic types
export { Embedder } from './semantic/embedder.js';
export type { EmbeddingResult } from './semantic/embedder.js';
export type { SemanticResult } from './semantic/search.js';

// Re-export search/auto-study types
export type { AutoStudyResult, SearchConfig, SearchResult, VerifiedFact } from './search/types.js';

// Re-export orchestrator utilities
export { assemble } from './orchestrator/assembler.js';

export { LedgerAdapter } from './collector/adapters/ledger.js';
export { JsonlAdapter, GenericAdapter } from './collector/index.js';
export { classifyMemory, extractCandidates, toFrontmatter, toIndexEntry } from './learning/auto-extract.js';
export type { SessionMessage, MemoryCandidate, MemoryType } from './learning/auto-extract.js';
export type { StudyEntry, StudySession, StudyResult } from './learning/study.js';
export type { AtomInput, AtomType, ReasoningAtom } from './reasoning/store.js';
export type { VerificationOutcome } from './reasoning/chain.js';
export type { BrowseRequest } from './learning/maintenance.js';
export { freshnessWeight, decayRateFor } from './analyzer/temporal.js';
export type { ReasoningStore } from './reasoning/store.js';
export type { StudyStore } from './learning/study.js';
export type { MaintenanceStore } from './learning/maintenance.js';
