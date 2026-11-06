// n2-Mímir core type definitions — standalone distribution (no Soul dependency)

// === Experience types ===

/** Experience type classification */
export type ExperienceType = 'success' | 'failure' | 'correction' | 'pattern';

/** Severity level */
export type Severity = 'critical' | 'error' | 'warning' | 'info';

/** Experience entry — the atomic unit of learning */
export interface ExperienceEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly sessionId: string;
  readonly agent: string;
  readonly project: string;
  readonly type: ExperienceType;
  readonly category: string;
  readonly severity: Severity;
  readonly context: string;
  readonly action: string;
  readonly outcome: string;
  readonly correction?: string;
  readonly sourceRef?: string;
  readonly frequency: number;
  readonly tokenCost: number;
  readonly createdAt: string;
}

/** Experience input for insertion */
export interface ExperienceInput {
  /** Agent name (default: 'default') */
  readonly agent?: string;
  /** Project name (default: 'default') */
  readonly project?: string;
  readonly type: ExperienceType;
  readonly category: string;
  readonly severity?: Severity;
  readonly context: string;
  readonly action: string;
  readonly outcome: string;
  readonly correction?: string;
  readonly sourceRef?: string;
  readonly sessionId?: string;
}

/** Experience query filter */
export interface MemoryScope {
  readonly project?: string;
  readonly agent?: string;
}

export interface ExperienceFilter extends MemoryScope {
  readonly category?: string;
  readonly type?: ExperienceType;
  readonly severity?: Severity;
  readonly since?: string;
  readonly limit?: number;
}

// === Insight types ===

/** Insight scope */
export type InsightScope = 'global' | 'project' | 'agent';

/** Insight lifecycle status */
export type InsightStatus = 'active' | 'dormant' | 'retired' | 'graduated';

/** Insight — learned pattern extracted from experience */
export interface Insight {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly agent: string;
  readonly description: string;
  readonly compressed: string;
  readonly tokenCost: number;
  readonly category: string;
  readonly scope: InsightScope;
  readonly importance: number;
  readonly confidence: number;
  readonly effectScore: number;
  readonly status: InsightStatus;
  readonly convertedType?: string;
  readonly convertedRef?: string;
}

/** Insight input for creation */
export interface InsightInput {
  readonly project?: string;
  readonly sourceIds?: ReadonlyArray<string>;
  readonly agent: string;
  readonly description: string;
  readonly compressed: string;
  readonly tokenCost?: number;
  readonly category: string;
  readonly scope?: InsightScope;
}

/** Insight query filter */
export interface InsightFilter {
  readonly id?: string;
  readonly project?: string;
  readonly agent?: string;
  readonly category?: string;
  readonly scope?: InsightScope;
  readonly status?: InsightStatus;
  readonly minImportance?: number;
  readonly limit?: number;
}

// === Tag types ===

/** Hierarchical tag chain */
export interface TagChain {
  readonly level: number;
  readonly tag: string;
}

/** Tag frequency for recall ranking */
export interface TagFrequency {
  readonly level: number;
  readonly tag: string;
  readonly frequency: number;
}

// === Analyzer types ===

/** Contrast pair for ExpeL comparison learning */
export interface ContrastPair {
  readonly failure: ExperienceEntry;
  readonly success: ExperienceEntry;
  readonly category: string;
}

/** Insight operation from analysis */
export type InsightOperation =
  | { readonly op: 'ADD'; readonly insight: InsightInput }
  | { readonly op: 'UPVOTE'; readonly insightId: string; readonly sourceIds?: ReadonlyArray<string> }
  | { readonly op: 'DOWNVOTE'; readonly insightId: string };

/** Repeated failure pattern */
export interface RepeatedPattern {
  readonly category: string;
  readonly action: string;
  readonly count: number;
  readonly experiences: ReadonlyArray<ExperienceEntry>;
}

// === Orchestrator types ===

/** BM25-ranked experience from FTS5 search */
export interface RankedExperience {
  readonly experience: ExperienceEntry;
  readonly rank: number;
}

/** Cascading recall result — what comes back when a topic is given */
export interface RecallResult {
  readonly experiences: ReadonlyArray<ExperienceEntry>;
  readonly tagChain: ReadonlyArray<TagFrequency>;
  readonly insights: ReadonlyArray<Insight>;
  readonly ftsResults: ReadonlyArray<RankedExperience>;
}

/** Assembled overlay ready for prompt injection */
export interface AssemblyResult {
  readonly overlay: string;
  readonly totalTokens: number;
  readonly insightCount: number;
  readonly selectedIds: ReadonlyArray<string>;
}

/** Scored insight for budget-based sorting */
export interface ScoredInsight {
  readonly insight: Insight;
  readonly score: number;
  readonly tokenCost: number;
}

// === Quality gate types ===

/** Raw experience before normalization */
export interface RawExperience {
  readonly sessionId?: string;
  readonly action: string;
  readonly outcome: string;
  readonly context?: string;
  readonly type?: string;
  readonly category?: string;
  readonly severity?: string;
  readonly correction?: string;
  readonly timestamp?: string;
  readonly agent?: string;
  readonly project?: string;
  readonly sourceRef?: string;
  readonly [key: string]: unknown;
}

/** Quality gate verdict */
export type QualityVerdict =
  | { readonly result: 'ACCEPT'; readonly entry: ExperienceEntry }
  | { readonly result: 'ACCEPT_LOW'; readonly entry: ExperienceEntry; readonly reason: string }
  | { readonly result: 'REJECT'; readonly reason: string }
  | { readonly result: 'MERGE'; readonly existingId: string; readonly additionalContext: string };

// === Effect tracking ===

/** Effect measurement for tracking insight usefulness */
export interface EffectMeasurement {
  readonly insightId: string;
  readonly sessionId: string;
  readonly wasRelevant: boolean;
  readonly wasFollowed: boolean;
  readonly outcome: 'positive' | 'neutral' | 'negative';
}

// === Configuration ===

/** LLM provider config (for insight generation) */
export interface LlmConfig {
  readonly provider: 'ollama' | 'openai' | 'anthropic';
  readonly model: string;
  readonly endpoint?: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
}

/** Mímir config — standalone mode */
export interface MimirConfig {
  readonly dbPath?: string;
  readonly tokenBudget?: number;
  readonly halfLife?: number;
  readonly llm?: LlmConfig;
}

// === Adapter interface — adapters must implement this ===

/** Experience adapter for pluggable data sources */
export interface ExperienceAdapter {
  /** Collect raw experiences from the data source */
  collect(project: string, agent: string): Promise<ReadonlyArray<RawExperience>>;
  /** Acknowledge observations only after storage succeeds. Collect must be retryable. */
  acknowledge?(experiences: ReadonlyArray<RawExperience>): void | Promise<void>;
}
