// search/extractor.ts — Fact/claim extraction from crawled text (pattern-based, no LLM)

import type { Claim } from './types.js';

/** Noise patterns to reject navigation/UI text — pre-compiled for performance */
const NOISE_PATTERNS: readonly RegExp[] = [
  /^(click|tap|subscribe|sign up|log in|cookie)/i,
  /^(menu|home|about|contact|privacy|terms)/i,
  /\b(copyright|©|all rights reserved)\b/i,
  /^(share|tweet|follow|like)\b/i,
  /(accept cookies|cookie policy|consent)/i,
];

/** Factual indicator patterns — declarative statement markers */
const FACTUAL_INDICATORS: readonly RegExp[] = [
  /\bis\b/, /\bare\b/, /\bwas\b/, /\bwere\b/,
  /\bcan\b/, /\bshould\b/, /\bmust\b/, /\bwill\b/,
  /\bprovides?\b/, /\bsupports?\b/, /\benables?\b/,
  /\busing\b/, /\bimplements?\b/, /\ballows?\b/,
  /이다/, /한다/, /된다/, /있다/, /없다/,
];

/** Code-related content pattern */
const CODE_PATTERN = /`[^`]+`|\b(function|class|import|const|let)\b/;

/** Numeric data pattern (statistics, versions, measurements) */
const NUMERIC_DATA_PATTERN = /\d+(\.\d+)?(%|ms|MB|KB|GB|x|fps)/i;

/** Sentence split pattern — handles English and Korean sentence endings */
const SENTENCE_SPLIT_PATTERN = /(?<=[.!?。])\s+/;

/** Stop words for keyword extraction */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'need',
  'this', 'that', 'these', 'those', 'with', 'from', 'into',
  'for', 'and', 'but', 'not', 'you', 'all', 'its', 'they',
  'their', 'what', 'which', 'who', 'when', 'where', 'how',
  'each', 'every', 'both', 'few', 'more', 'most', 'other',
  'some', 'such', 'only', 'own', 'same', 'than', 'too',
  'very', 'just', 'also', 'about', 'between', 'through',
]);

/** Max claims extracted per page */
const MAX_CLAIMS_PER_PAGE = 15;
const MIN_SENTENCE_LENGTH = 20;

/**
 * Extract key claims/facts from crawled page content.
 * Strategy: split → score by topic relevance → filter noise → return top claims.
 */
export function extractClaims(content: string, topic: string, sourceUrl: string): Claim[] {
  const sentences = splitSentences(content);
  const topicKeywords = extractKeywords(topic);
  const scored: Array<{ sentence: string; score: number }> = [];

  for (const sentence of sentences) {
    if (!isValidClaim(sentence)) continue;

    const score = scoreSentence(sentence, topicKeywords);
    if (score > 0) {
      scored.push({ sentence, score });
    }
  }

  // Sort by relevance score, take top claims
  scored.sort((a, b) => b.score - a.score);
  const topClaims = scored.slice(0, MAX_CLAIMS_PER_PAGE);

  return topClaims.map(({ sentence }) => ({
    text: sentence.trim(),
    source: sourceUrl,
    context: findContext(content, sentence),
    keywords: extractKeywords(sentence),
  }));
}

/**
 * Split text into sentences using multi-language delimiters.
 * Filters sentences by length: 20 ≤ length ≤ 500.
 */
export function splitSentences(text: string): string[] {
  const raw = text.split(SENTENCE_SPLIT_PATTERN);

  return raw
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_SENTENCE_LENGTH && s.length <= 500);
}

/** Check if a sentence is a valid claim (not noise/navigation text) */
export function isValidClaim(sentence: string): boolean {
  if (sentence.length < MIN_SENTENCE_LENGTH || sentence.length > 500) return false;

  // Reject navigation/UI text
  for (const pattern of NOISE_PATTERNS) {
    if (pattern.test(sentence)) return false;
  }

  // Must contain at least 3 meaningful words (> 3 chars)
  const words = sentence.split(/\s+/).filter((w) => w.length > 3);
  return words.length >= 3;
}

/**
 * Score a sentence's relevance to the study topic.
 * Higher score = more relevant to the topic.
 */
export function scoreSentence(sentence: string, topicKeywords: readonly string[]): number {
  const lower = sentence.toLowerCase();
  let score = 0;

  // Keyword match: +2 per topic keyword found
  for (const keyword of topicKeywords) {
    if (lower.includes(keyword.toLowerCase())) {
      score += 2;
    }
  }

  // Factual indicator bonus: +1 for declarative statements (once)
  for (const pattern of FACTUAL_INDICATORS) {
    if (pattern.test(lower)) {
      score += 1;
      break;
    }
  }

  // Code-related content bonus
  if (CODE_PATTERN.test(sentence)) {
    score += 1;
  }

  // Numeric data bonus
  if (NUMERIC_DATA_PATTERN.test(sentence)) {
    score += 1;
  }

  return score;
}

/**
 * Extract meaningful keywords from text.
 * Filters out stop words and short words, deduplicates.
 */
export function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    .filter((w, i, arr) => arr.indexOf(w) === i) // Deduplicate
    .slice(0, 20);
}

/** Find surrounding context for a claim in the original text */
function findContext(fullText: string, sentence: string): string {
  const idx = fullText.indexOf(sentence.slice(0, 30));
  if (idx === -1) return sentence;

  const start = Math.max(0, idx - 100);
  const end = Math.min(fullText.length, idx + sentence.length + 100);
  return fullText.slice(start, end).trim();
}
