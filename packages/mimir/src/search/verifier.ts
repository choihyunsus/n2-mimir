// search/verifier.ts — 5-source cross-validation engine (keyword + semantic hybrid)

import type { Claim, VerifiedFact, VerificationStatus } from './types.js';
import { extractKeywords } from './extractor.js';
import type { Embedder } from '../semantic/embedder.js';
import { cosineSimilarity } from '../utils/math.js';

/** Keyword similarity threshold for clustering */
const KEYWORD_SIMILARITY_THRESHOLD = 0.5;

/** Semantic similarity threshold for clustering (cosine) */
const SEMANTIC_SIMILARITY_THRESHOLD = 0.75;

/** Negation words for contradiction detection (EN + KO) */
const NEGATION_WORDS: readonly string[] = [
  'not', "don't", "doesn't", "isn't", "aren't", "won't", "shouldn't",
  'never', 'no longer', 'deprecated', 'removed', 'obsolete',
  '아니', '않', '못', '없', '불가',
];

/** Contradiction detection keyword similarity threshold */
const CONTRADICTION_SIMILARITY_THRESHOLD = 0.4;

/**
 * 5-Source Cross-Validation Engine (Hybrid: keyword + semantic).
 *
 * Measures text agreement across distinct source hostnames.
 * The legacy verified label marks corroboration requiring factual review.
 *
 * @param claimsBySource - Claims grouped by source
 * @param minConfidence - Minimum confidence for 'verified' status
 * @param embedder - Optional Embedder for semantic fallback
 */
export async function verifyClaims(
  claimsBySource: readonly (readonly Claim[])[],
  minConfidence = 0.6,
  embedder?: Embedder,
): Promise<VerifiedFact[]> {
  if (claimsBySource.length === 0) return [];

  const totalSources = new Set(claimsBySource.flat().map(claim => sourceHost(claim.source)).filter(Boolean)).size;
  const allClaims = claimsBySource.flat();

  if (allClaims.length === 0) return [];

  // Step 1: Group similar claims (keyword + optional semantic fallback)
  const clusters = await clusterClaims(allClaims, embedder);

  // Step 2: Score each cluster by source diversity
  const results: VerifiedFact[] = [];

  for (const cluster of clusters) {
    const uniqueSources = new Set(cluster.map((c) => c.source));
    const sourceCount = new Set([...uniqueSources].map(sourceHost).filter(Boolean)).size;
    const confidence = calculateConfidence(sourceCount, totalSources);
    const status = determineStatus(confidence, minConfidence, sourceCount);
    const representative = selectRepresentative(cluster);
    const contradiction = detectContradiction(cluster);

    results.push({
      claim: representative.text,
      confidence: contradiction ? 0.0 : confidence,
      sources: [...uniqueSources],
      status: contradiction ? 'flagged' : status,
      contradiction: contradiction ?? undefined,
    });
  }

  // Sort by confidence descending
  results.sort((a, b) => b.confidence - a.confidence);
  return results;
}

/**
 * Cluster similar claims using keyword overlap + semantic fallback.
 *
 * Flow per pair:
 *   1. Keyword similarity >= 0.5 → same cluster (fast path)
 *   2. Keyword < 0.5 BUT embedder available → cosine >= 0.75 → same cluster
 *   3. Both fail → different clusters
 */
export async function clusterClaims(
  claims: readonly Claim[],
  embedder?: Embedder,
): Promise<Claim[][]> {
  const used = new Set<number>();
  const clusters: Claim[][] = [];

  // Pre-compute embeddings if semantic is available
  const embeddings = await precomputeEmbeddings(claims, embedder);

  for (let i = 0; i < claims.length; i++) {
    if (used.has(i)) continue;

    const cluster: Claim[] = [claims[i]];
    used.add(i);

    const keywordsA = claims[i].keywords.length > 0
      ? claims[i].keywords
      : extractKeywords(claims[i].text);

    for (let j = i + 1; j < claims.length; j++) {
      if (used.has(j)) continue;

      if (claimsMatch(keywordsA, claims[j], embeddings?.[i], embeddings?.[j])) {
        cluster.push(claims[j]);
        used.add(j);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

function claimsMatch(keywords: readonly string[], claim: Claim, left?: readonly number[], right?: readonly number[]): boolean {
  const other = claim.keywords.length > 0 ? claim.keywords : extractKeywords(claim.text);
  if (keywordSimilarity(keywords, other) >= KEYWORD_SIMILARITY_THRESHOLD) return true;
  return !!(left?.length && right?.length && cosineSimilarity(left, right) >= SEMANTIC_SIMILARITY_THRESHOLD);
}

function sourceHost(source: string): string {
  try {
    const url = new URL(source);
    return ['http:', 'https:'].includes(url.protocol) ? url.hostname.toLowerCase().replace(/^www\./, '') : '';
  } catch { return ''; }
}

/**
 * Pre-compute embeddings for all claims (batch, async).
 * Returns null if embedder is not available.
 */
async function precomputeEmbeddings(
  claims: readonly Claim[],
  embedder?: Embedder,
): Promise<(readonly number[])[] | null> {
  if (!embedder?.isAvailable()) return null;

  try {
    const results = await embedder.embedBatch(
      claims.map((c) => c.text),
    );
    return results.map((r) => r?.vector ?? []);
  } catch {
    return null;
  }
}

// cosineSimilarity imported from '../utils/math.js' (shared utility)
// Re-exported for barrel compatibility
export { cosineSimilarity } from '../utils/math.js';

/** Keyword-based similarity between two keyword sets (Jaccard-like) */
export function keywordSimilarity(
  keywordsA: readonly string[],
  keywordsB: readonly string[],
): number {
  if (keywordsA.length === 0 || keywordsB.length === 0) return 0;

  const setA = new Set(keywordsA.map((k) => k.toLowerCase()));
  const setB = new Set(keywordsB.map((k) => k.toLowerCase()));
  const overlap = [...setA].filter((k) => setB.has(k)).length;

  return overlap / Math.min(setA.size, setB.size);
}

/** Calculate confidence score from source agreement ratio */
export function calculateConfidence(agreeCount: number, totalSources: number): number {
  if (!Number.isInteger(agreeCount) || !Number.isInteger(totalSources) || agreeCount <= 0 || totalSources <= 0) return 0;
  const count = Math.min(agreeCount, totalSources);
  if (count >= 5) return 1;
  return [0, 0.2, 0.5, 0.7, 0.9][count];
}

/** Determine verification status from confidence score */
function determineStatus(confidence: number, minConfidence: number, sourceCount: number): VerificationStatus {
  if (sourceCount >= 3 && confidence >= minConfidence) return 'verified';
  if (confidence >= 0.4) return 'pending';
  return 'unverified';
}

/** Select the best representative claim from a cluster (longest + most keywords) */
function selectRepresentative(cluster: readonly Claim[]): Claim {
  return cluster.reduce((best, current) => {
    const bestScore = best.text.length + best.keywords.length * 10;
    const currentScore = current.text.length + current.keywords.length * 10;
    return currentScore > bestScore ? current : best;
  });
}

/** Detect contradictions within a claim cluster */
export function detectContradiction(cluster: readonly Claim[]): string | null {
  if (cluster.length < 2) return null;

  for (let i = 0; i < cluster.length; i++) {
    for (let j = i + 1; j < cluster.length; j++) {
      const textA = cluster[i].text.toLowerCase();
      const textB = cluster[j].text.toLowerCase();

      const aNegated = hasNegation(textA);
      const bNegated = hasNegation(textB);

      if (aNegated !== bNegated) {
        const sim = keywordSimilarity(
          extractKeywords(cluster[i].text),
          extractKeywords(cluster[j].text),
        );
        if (sim >= CONTRADICTION_SIMILARITY_THRESHOLD) {
          return `Conflict: "${cluster[i].text.slice(0, 80)}" vs "${cluster[j].text.slice(0, 80)}"`;
        }
      }
    }
  }

  return null;
}

function hasNegation(text: string): boolean {
  return NEGATION_WORDS.some(word => /^[a-z]/.test(word)
    ? new RegExp(`\\b${word}\\b`, 'i').test(text)
    : text.includes(word));
}
