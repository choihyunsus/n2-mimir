// search/engine.ts — Search engine with DuckDuckGo (default) and Tavily (optional) providers

import { DEFAULT_CONFIG } from './types.js';
import type { SearchResult, SearchConfig } from './types.js';

/** Native DuckDuckGo date filter values */
const NATIVE_DATE_FILTERS = new Set(['d', 'w', 'm', 'y']);

/** Custom month-based date ranges */
const CUSTOM_MONTH_RANGES: Readonly<Record<string, number>> = { '3m': 3, '6m': 6 };

/** Default cascading date ranges (narrow → wide) */
const DATE_RANGE_CASCADE = ['3m', '6m', 'y'] as const;

/**
 * Search DuckDuckGo via HTML parsing.
 * Cascading date filter: tries narrow range first, expands if no results.
 */
export async function search(
  query: string,
  config: SearchConfig = {},
): Promise<readonly SearchResult[]> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const encodedQuery = encodeURIComponent(query);

  // Build cascading date ranges: start from configured range, expand outward
  const startIdx = DATE_RANGE_CASCADE.indexOf(cfg.timeRange as typeof DATE_RANGE_CASCADE[number]);
  const cascade: readonly string[] = startIdx >= 0
    ? DATE_RANGE_CASCADE.slice(startIdx)
    : [cfg.timeRange, ...DATE_RANGE_CASCADE];

  for (const range of cascade) {
    const dateFilter = buildDateFilter(range);
    const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}${dateFilter}`;

    const response = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': cfg.userAgent,
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8',
      },
    }, cfg.timeout);

    if (!response.ok) {
      continue; // Silent failure — expand to next date range
    }

    const html = await response.text();
    const results = parseSearchResults(html, cfg.maxResults);

    if (results.length > 0) return results;
    // No results → expand to next range
  }

  return []; // All ranges exhausted
}

/**
 * Build DuckDuckGo date filter parameter.
 * Native values: d, w, m, y → direct pass.
 * Custom values: 3m, 6m → computed date range (df=YYYY-MM-DD..YYYY-MM-DD).
 */
function buildDateFilter(range: string): string {
  if (!range) return '';

  // Native DuckDuckGo values
  if (NATIVE_DATE_FILTERS.has(range)) {
    return `&df=${range}`;
  }

  // Custom ranges: calculate from today
  const months = CUSTOM_MONTH_RANGES[range];
  if (months) {
    const now = new Date();
    const from = new Date(now);
    from.setMonth(from.getMonth() - months);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = now.toISOString().slice(0, 10);
    return `&df=${fromStr}..${toStr}`;
  }

  return '';
}

/**
 * Parse DuckDuckGo HTML search results page.
 * Extracts title, URL, and snippet from each result block.
 */
export function parseSearchResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // DuckDuckGo HTML uses class="result__body" to delimit results
  // Split on that class name to isolate each result block
  const resultBlocks = html.split(/result__body/g);

  for (let i = 1; i < resultBlocks.length && results.length < maxResults; i++) {
    const block = resultBlocks[i];

    // Extract URL from result__a link
    const urlMatch = block.match(/class="result__a"[^>]*href="([^"]+)"/)
      ?? block.match(/href="([^"]+)"[^>]*class="result__a"/);
    if (!urlMatch) continue;

    let url = urlMatch[1];
    url = extractActualUrl(url);
    if (!url || url.includes('duckduckgo.com')) continue;

    // Extract title text
    const titleMatch = block.match(/class="result__a"[^>]*>([^<]+)</);
    const title = titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : '';

    // Extract snippet text
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)(?:<\/a>|<\/td>|<\/div>)/);
    const snippet = snippetMatch
      ? decodeHtmlEntities(stripHtmlTags(snippetMatch[1]).trim())
      : '';

    if (title && url) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

/**
 * Extract actual URL from DuckDuckGo redirect wrapper.
 * DDG wraps URLs like: //duckduckgo.com/l/?uddg=https%3A%2F%2Factual-url.com
 */
export function extractActualUrl(ddgUrl: string): string {
  if (!ddgUrl) return '';

  // Direct URL (no redirect wrapper)
  if (ddgUrl.startsWith('http') && !ddgUrl.includes('duckduckgo.com/l/')) {
    return ddgUrl;
  }

  // Extract from DDG redirect: ?uddg=<encoded url>
  const uddgMatch = ddgUrl.match(/[?&]uddg=([^&]+)/);
  if (uddgMatch) {
    return decodeURIComponent(uddgMatch[1]);
  }

  // Fallback: protocol-relative URL
  if (ddgUrl.startsWith('//')) {
    return `https:${ddgUrl}`;
  }

  return ddgUrl;
}

/** Strip HTML tags from text */
function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

/** Decode common HTML entities */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Fetch with timeout support using AbortController.
 * Clean cancellation on timeout.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Search using Tavily API.
 * Requires TAVILY_API_KEY env var or explicit apiKey in config.
 * Maps Tavily results to the existing SearchResult interface.
 */
export async function searchWithTavily(
  query: string,
  config: SearchConfig = {},
): Promise<readonly SearchResult[]> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  const { tavily } = await import('@tavily/core');
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY environment variable is required for Tavily search');
  }

  const client = tavily({ apiKey });
  const response = await client.search(query, {
    maxResults: cfg.maxResults,
    searchDepth: 'basic',
    topic: 'general',
  });

  return (response.results ?? []).map((r: { title?: string; url?: string; content?: string }) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.content ?? '',
  }));
}

/**
 * Auto-dispatching search: picks Tavily or DuckDuckGo based on config/env.
 *
 * Priority:
 *   1. config.searchProvider === 'tavily' → Tavily
 *   2. config.searchProvider === 'duckduckgo' → DuckDuckGo
 *   3. config.searchProvider === 'auto' (or unset) → Tavily if TAVILY_API_KEY is set, else DuckDuckGo
 */
export async function searchAuto(
  query: string,
  config: SearchConfig = {},
): Promise<readonly SearchResult[]> {
  const provider = config.searchProvider ?? 'auto';

  if (provider === 'tavily') {
    return searchWithTavily(query, config);
  }

  if (provider === 'duckduckgo') {
    return search(query, config);
  }

  // 'auto' mode: use Tavily if API key is available, otherwise DuckDuckGo
  if (process.env.TAVILY_API_KEY) {
    return searchWithTavily(query, config);
  }

  return search(query, config);
}
