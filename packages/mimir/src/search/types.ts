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

/** Verified fact after 5-source cross-validation */
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

/** Search provider type */
export type SearchProvider = 'duckduckgo' | 'tavily';

/** Search configuration */
export interface SearchConfig {
  readonly maxResults?: number;
  readonly maxCrawlPages?: number;
  readonly minConfidence?: number;
  readonly maxContentLength?: number;
  readonly timeout?: number;
  readonly userAgent?: string;
  readonly timeRange?: string;
  readonly provider?: SearchProvider;
  readonly tavilyApiKey?: string;
  readonly llm?: {
    readonly provider: string;
    readonly model: string;
    readonly endpoint?: string;
  };
}

/** Default search configuration */
export const DEFAULT_CONFIG: Readonly<Required<Omit<SearchConfig, 'llm' | 'provider' | 'tavilyApiKey'>>> = {
  maxResults: 10,
  maxCrawlPages: 5,
  minConfidence: 0.6,
  maxContentLength: 5000,
  timeout: 10000,
  timeRange: '3m',
  userAgent: 'Mozilla/5.0 (compatible; N2-Mimir/1.0; +https://github.com/n2-project)',
} as const;
