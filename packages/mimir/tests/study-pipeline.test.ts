import { it, expect, vi } from 'vitest';
import { Mimir } from '../src/index.js';
import { verifyClaims } from '../src/search/verifier.js';
import { extractClaims } from '../src/search/extractor.js';
import { parseSearchResults } from '../src/search/engine.js';
import { storeVerifiedFacts } from '../src/search/auto-study.js';

const sentence = 'SQLite provides durable transactions and preserves committed records after a process restart.';

it('runs search, crawl, extraction, corroboration, scoped storage and replay through the public API', async () => {
  const mimir = new Mimir({ dbPath: ':memory:' });
  const urls = Array.from({ length: 5 }, (_, index) => `https://source${index}.example/article`);
  const searchHtml = urls.map(url => `<div class="result__body"><a class="result__a" href="${url}">SQLite reference</a></div>`).join('');
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = input.toString();
    if (url.startsWith('https://html.duckduckgo.com/')) return new Response(searchHtml);
    if (urls.includes(url)) return new Response(`<html><title>SQLite</title><article>${sentence}</article></html>`,
      { headers: { 'content-type': 'text/html' } });
    throw new Error('Unexpected test request');
  }));
  try {
    const result = await mimir.autoStudy('SQLite transactions', { project: 'demo', agent: 'worker' });
    expect(result).toMatchObject({ searchResults: 5, pagesCrawled: 5, claimsExtracted: 5,
      factsVerified: 1, experiencesSaved: 1 });
    expect((await mimir.autoStudy('SQLite transactions', { project: 'demo', agent: 'worker' })).experiencesSaved).toBe(0);
    const observations = mimir.queryExperiences({ project: 'demo', agent: 'worker' });
    expect(observations).toHaveLength(1);
    expect(observations[0].frequency).toBe(1);
    expect(observations[0].context).toContain(urls[4]);
    expect(observations[0].outcome).toContain('factual review required');
  } finally { vi.unstubAllGlobals(); mimir.close(); }
});

it('counts distinct hosts, flags explicit contradiction and preserves rejected evidence outside learned facts', async () => {
  const repeated = Array.from({ length: 5 }, (_, index) => extractClaims(sentence, 'SQLite', `https://one.example/${index}`));
  expect((await verifyClaims(repeated))[0]).toMatchObject({ status: 'unverified', confidence: 0.2 });
  const contrary = sentence.replace('provides durable', 'does not provide durable');
  const grouped = [sentence, sentence, contrary].map((text, index) => extractClaims(text, 'SQLite', `https://source${index}.example/`));
  const facts = await verifyClaims(grouped);
  expect(facts[0].status).toBe('flagged');
  const deltaLearn = vi.fn();
  expect(storeVerifiedFacts({ deltaLearn }, 'SQLite', facts)).toBe(0);
  expect(deltaLearn).not.toHaveBeenCalled();
});

it('ignores malformed redirect links and non-HTTP search results', () => {
  const results = parseSearchResults('<div class="result__body"><a class="result__a" href="//duckduckgo.com/l/?uddg=%bad">bad</a>' +
    '<div class="result__body"><a class="result__a" href="file:///private">bad</a>', 10);
  expect(results).toEqual([]);
});
