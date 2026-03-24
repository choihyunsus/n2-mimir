// search/index.ts — barrel export for Auto Study module

export { autoStudy, storeVerifiedFacts, detectStudyCategory } from './auto-study.js';
export { search, searchWithTavily, searchAuto, parseSearchResults, extractActualUrl, fetchWithTimeout } from './engine.js';
export { crawlPage, crawlPages, extractContent, extractTitle } from './crawler.js';
export { extractClaims, splitSentences, extractKeywords, scoreSentence, isValidClaim } from './extractor.js';
export {
  verifyClaims, clusterClaims, keywordSimilarity,
  cosineSimilarity, calculateConfidence, detectContradiction,
} from './verifier.js';
export { DEFAULT_CONFIG } from './types.js';
export type {
  SearchResult, CrawledPage, Claim, VerifiedFact,
  VerificationStatus, AutoStudyResult, SearchConfig, SearchProvider,
} from './types.js';
