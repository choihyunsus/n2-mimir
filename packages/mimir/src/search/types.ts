// search/types.ts — Type definitions for Auto Study pipeline
// All types converted from JSDoc @typedef to TypeScript interfaces

/** DuckDuckGo search result */
export interface SearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

/** Crawled page content */
export interface CrawledPage {
  readonly url: string;
  readonly title: string;
  readonly content: string;
  readonly fetchedAt: string;
  readonly contentLength: number;
}

/** Extracted claim from crawled content */
export interface Claim {
  readonly text: string;
  readonly source: string;
  readonly context: string;
  readonly keywords: readonly string[];
}

/** Verification status for cross-validated facts */
export type VerificationStatus = 'verified' | 'pending' | 'unverified' | 'flagged';

/** Claim with heuristic source-agreement evidence. Verification is a review signal. */
export interface VerifiedFact {
  readonly claim: string;
  readonly confidence: number;
  readonly sources: readonly string[];
  readonly status: VerificationStatus;
  readonly contradiction?: string;
}

/** Auto Study pipeline result summary */
export interface AutoStudyResult {
  readonly topic: string;
  readonly semanticMode?: boolean;
  searchResults: number;  // mutable: accumulated during pipeline
  pagesCrawled: number;   // mutable: accumulated during pipeline
  claimsExtracted: number;
  factsVerified: number;
  factsPending: number;
  factsRejected: number;
  experiencesSaved: number;
}

/** Search configuration */
export interface SearchConfig {
  readonly project?: string;
  readonly agent?: string;
  readonly maxResults?: number;
  readonly maxCrawlPages?: number;
  readonly minConfidence?: number;
  readonly maxContentLength?: number;
  readonly timeout?: number;
  readonly userAgent?: string;
  readonly timeRange?: string;
  readonly llm?: {
    readonly provider: string;
    readonly model: string;
    readonly endpoint?: string;
  };
}

/** Default search configuration */
export const DEFAULT_CONFIG: Readonly<Required<Omit<SearchConfig, 'llm' | 'project' | 'agent'>>> = {
  maxResults: 10,
  maxCrawlPages: 5,
  minConfidence: 0.6,
  maxContentLength: 5000,
  timeout: 10000,
  timeRange: '3m',
  userAgent: 'N2-Mimir/3.0 (+https://github.com/choihyunsus/n2-mimir)',
} as const;

export function resolveSearchConfig(config: SearchConfig) {
  const resolved = { ...DEFAULT_CONFIG, ...config };
  const limits = { maxResults: 50, maxCrawlPages: 20, maxContentLength: 100000, timeout: 60000 };
  for (const key of Object.keys(limits) as Array<keyof typeof limits>) {
    if (!Number.isInteger(resolved[key]) || resolved[key] < 1 || resolved[key] > limits[key]) {
      throw new Error(`Invalid search option ${key}`);
    }
  }
  if (!Number.isFinite(resolved.minConfidence) || resolved.minConfidence < 0 || resolved.minConfidence > 1) {
    throw new Error('Invalid search confidence threshold');
  }
  for (const key of ['project', 'agent'] as const) {
    if (resolved[key] !== undefined && (typeof resolved[key] !== 'string' || !resolved[key]!.trim())) {
      throw new Error(`Invalid search scope ${key}`);
    }
  }
  return resolved;
}
