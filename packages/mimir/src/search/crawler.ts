// search/crawler.ts — URL content extractor (article body extraction)

import { resolveSearchConfig } from './types.js';
import { readResponseText } from '../http.js';
import type { CrawledPage, SearchConfig } from './types.js';
import { fetchWithTimeout } from './engine.js';

/**
 * Crawl a URL and extract clean text content.
 * Focuses on article/main content, strips navigation and ads.
 */
export async function crawlPage(
  url: string,
  config: SearchConfig = {},
): Promise<CrawledPage | null> {
  const cfg = resolveSearchConfig(config);

  try {
    const signal = AbortSignal.timeout(cfg.timeout);
    const response = await fetchWithTimeout(url, {
      signal,
      headers: {
        'User-Agent': cfg.userAgent,
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8',
      },
    }, cfg.timeout);

    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok || !contentType.includes('text/html')) {
      void response.body?.cancel().catch(() => undefined);
      return null;
    }

    const html = await readResponseText(response, undefined, signal);
    const title = extractTitle(html);
    const content = extractContent(html, cfg.maxContentLength);

    if (content.length < 50) return null; // Too short, likely empty/error page

    return {
      url,
      title,
      content,
      fetchedAt: new Date().toISOString(),
      contentLength: content.length,
    };
  } catch {
    return null; // Network error, timeout, etc.
  }
}

/**
 * Crawl multiple URLs in parallel with concurrency limit.
 * Batch size of 3 for polite crawling.
 */
export async function crawlPages(
  urls: readonly string[],
  config: SearchConfig = {},
): Promise<CrawledPage[]> {
  const cfg = resolveSearchConfig(config);
  const targetUrls = [...new Set(urls)].slice(0, cfg.maxCrawlPages);
  const batchSize = 3;

  const results: CrawledPage[] = [];

  for (let i = 0; i < targetUrls.length; i += batchSize) {
    const batch = targetUrls.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((batchUrl) => crawlPage(batchUrl, cfg)),
    );
    for (const result of batchResults) {
      if (result) results.push(result);
    }
  }

  return results;
}

/** Extract page title from HTML <title> tag */
export function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : '';
}

/**
 * Extract main content from HTML.
 * Priority: <article> > <main> > <div role="main"> > <body>
 * Strips scripts, styles, nav, header, footer, aside.
 */
export function extractContent(html: string, maxLength: number): string {
  // Step 1: Remove noise elements entirely
  let cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const content = mainContainer(cleaned);

  // Step 3: Strip remaining HTML tags and clean whitespace
  const text = content
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  return text.slice(0, maxLength);
}

function mainContainer(html: string): string {
  const containers = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<div[^>]*role="main"[^>]*>([\s\S]*?)<\/div>/i,
    /<body[^>]*>([\s\S]*?)<\/body>/i,
  ];
  for (const pattern of containers) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  return html;
}
