// search/auto-study.ts — Auto Study orchestrator (full pipeline)

import { search } from './engine.js';
import { crawlPages } from './crawler.js';
import { extractClaims } from './extractor.js';
import { verifyClaims } from './verifier.js';
import { resolveSearchConfig } from './types.js';
import { createHash } from 'node:crypto';
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
 * Auto Study Pipeline — search, extract, compare sources, and store reviewable candidates.
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
  const cfg = resolveSearchConfig(config);

  const result = emptyStudyResult(topic, !!embedder?.isAvailable());

  // ── Step 1: Search ──
  const searchResults = await search(topic, cfg);
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
    result.experiencesSaved = storeVerifiedFacts(mimir, topic, verifiedFacts, cfg);
  }

  return result;
}

/**
 * Store verified facts as Mimir experiences via delta learning.
 * Stores corroborated candidates meeting the configured threshold. Preserves source URLs.
 */
export function storeVerifiedFacts(
  mimir: MimirLike,
  topic: string,
  facts: readonly VerifiedFact[],
  config: SearchConfig = {},
): number {
  const cfg = resolveSearchConfig(config);
  let savedCount = 0;

  for (const fact of facts) {
    if (fact.status !== 'verified' || !Number.isFinite(fact.confidence) || fact.confidence < cfg.minConfidence) continue;

    const sources = [...new Set(fact.sources)].sort();
    const evidenceId = createHash('sha256').update(JSON.stringify([topic, fact.claim, sources])).digest('hex');
    const result = mimir.deltaLearn({
      agent: cfg.agent ?? 'auto-study',
      project: cfg.project ?? `study-${topic.toLowerCase().replace(/\s+/g, '-').slice(0, 30)}`,
      type: 'pattern', category: detectStudyCategory(topic),
      context: `Web study candidate for ${topic}. Sources: ${sources.join(', ')}`,
      action: fact.claim,
      outcome: `Source-agreement score ${fact.confidence}; factual review required`,
      sourceRef: `web-study:${evidenceId}`, sessionId: evidenceId,
    });
    if (result.isNew) savedCount++;
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

function emptyStudyResult(topic: string, semanticMode: boolean): AutoStudyResult {
  return { topic, semanticMode, searchResults: 0, pagesCrawled: 0, claimsExtracted: 0,
    factsVerified: 0, factsPending: 0, factsRejected: 0, experiencesSaved: 0 };
}
