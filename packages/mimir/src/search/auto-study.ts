// search/auto-study.ts — Auto Study orchestrator (full pipeline)

import { search } from './engine.js';
import { crawlPages } from './crawler.js';
import { extractClaims } from './extractor.js';
import { verifyClaims } from './verifier.js';
import { DEFAULT_CONFIG } from './types.js';
import type { SearchConfig, AutoStudyResult, VerifiedFact } from './types.js';
import type { Embedder } from '../semantic/embedder.js';

/** Interface for Mimir instance used by Auto Study (avoids circular import) */
interface MimirLike {
  deltaLearn(input: {
    agent?: string;
    project?: string;
    type: string;
    category: string;
    context: string;
    action: string;
    outcome: string;
    correction?: string;
    sourceRef?: string;
    sessionId?: string;
  }): { isNew: boolean; id: string };
}

/** Category detection keyword map */
const CATEGORY_MAP: readonly { keywords: readonly string[]; name: string }[] = [
  { keywords: ['react', 'vue', 'angular', 'next', 'frontend', 'css', 'html'], name: 'frontend' },
  { keywords: ['node', 'express', 'fastapi', 'backend', 'server', 'api'], name: 'backend' },
  { keywords: ['python', 'javascript', 'typescript', 'rust', 'go'], name: 'programming_language' },
  { keywords: ['database', 'sql', 'mongo', 'postgres', 'sqlite', 'redis'], name: 'database' },
  { keywords: ['docker', 'kubernetes', 'deploy', 'ci/cd', 'devops'], name: 'devops' },
  { keywords: ['ai', 'ml', 'llm', 'gpt', 'model', 'neural', 'training'], name: 'ai_ml' },
  { keywords: ['security', 'auth', 'encrypt', 'cors', 'csrf'], name: 'security' },
  { keywords: ['design', 'ui', 'ux', 'figma', 'tailwind'], name: 'design' },
  { keywords: ['test', 'jest', 'vitest', 'cypress', 'playwright'], name: 'testing' },
];

/**
 * Auto Study Pipeline — fully automated learning from web search.
 *
 * Pipeline:
 *   1. Search (DuckDuckGo HTML)
 *   2. Crawl (top N pages)
 *   3. Extract (claims from each page)
 *   4. Verify (5-source cross-validation)
 *   5. Store (verified facts → Mimir DB)
 */
export async function autoStudy(
  topic: string,
  mimir: MimirLike | null,
  config: SearchConfig = {},
  embedder?: Embedder,
): Promise<AutoStudyResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  const result: AutoStudyResult = {
    topic,
    semanticMode: !!embedder?.isAvailable(),
    searchResults: 0,
    pagesCrawled: 0,
    claimsExtracted: 0,
    factsVerified: 0,
    factsPending: 0,
    factsRejected: 0,
    experiencesSaved: 0,
  };

  // ── Step 1: Search ──
  // Auto-select Tavily when TAVILY_API_KEY is set and no provider is explicitly configured
  const searchCfg: SearchConfig = (!cfg.provider && process.env.TAVILY_API_KEY)
    ? { ...cfg, provider: 'tavily', tavilyApiKey: process.env.TAVILY_API_KEY }
    : cfg;
  const searchResults = await search(topic, searchCfg);
  result.searchResults = searchResults.length;
  if (searchResults.length === 0) return result;

  // ── Step 2: Crawl top pages ──
  const urls = searchResults.map((r) => r.url);
  const pages = await crawlPages(urls, cfg);
  result.pagesCrawled = pages.length;
  if (pages.length === 0) return result;

  // ── Step 3: Extract claims from each page ──
  const claimsBySource = pages
    .map((page) => extractClaims(page.content, topic, page.url))
    .filter((claims) => claims.length > 0);

  result.claimsExtracted = claimsBySource.flat().length;
  if (claimsBySource.length === 0) return result;

  // ── Step 4: 5-source cross-validation (keyword + semantic hybrid) ──
  const verifiedFacts = await verifyClaims(claimsBySource, cfg.minConfidence, embedder);

  for (const fact of verifiedFacts) {
    switch (fact.status) {
      case 'verified': result.factsVerified++; break;
      case 'pending': result.factsPending++; break;
      default: result.factsRejected++; break;
    }
  }

  // ── Step 5: Store verified facts as Mimir experiences ──
  if (mimir) {
    result.experiencesSaved = storeVerifiedFacts(mimir, topic, verifiedFacts);
  }

  return result;
}

/**
 * Store verified facts as Mimir experiences via delta learning.
 * Only stores facts with confidence >= 0.5.
 */
export function storeVerifiedFacts(
  mimir: MimirLike,
  topic: string,
  facts: readonly VerifiedFact[],
): number {
  let savedCount = 0;

  for (const fact of facts) {
    if (fact.confidence < 0.5) continue;

    const experienceType = fact.status === 'flagged' ? 'correction' : 'pattern';
    const sourceList = fact.sources.slice(0, 3).join(', ');

    try {
      const result = mimir.deltaLearn({
        agent: 'auto-study',
        project: `study-${topic.toLowerCase().replace(/\s+/g, '-').slice(0, 30)}`,
        type: experienceType,
        category: detectStudyCategory(topic),
        context: `Auto-study: ${topic} (${fact.sources.length} sources)`,
        action: fact.claim.slice(0, 500),
        outcome: `Verified by ${fact.sources.length} sources (confidence: ${fact.confidence})`,
        correction: fact.contradiction ?? undefined,
        sourceRef: sourceList,
        sessionId: new Date().toISOString(),
      });

      if (result.isNew) savedCount++;
    } catch {
      // Delta learning may reject duplicates — that's fine
    }
  }

  return savedCount;
}

/** Detect study category from topic keywords (best match) */
export function detectStudyCategory(topic: string): string {
  const lower = topic.toLowerCase();
  let bestName = 'general';
  let bestScore = 0;

  for (const cat of CATEGORY_MAP) {
    const score = cat.keywords.filter((k) => lower.includes(k)).length;
    if (score > bestScore) {
      bestScore = score;
      bestName = cat.name;
    }
  }

  return bestName;
}
