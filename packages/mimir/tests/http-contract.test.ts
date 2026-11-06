import { it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { Embedder } from '../src/semantic/embedder.js';
import { crawlPage } from '../src/search/crawler.js';
import { readResponseText } from '../src/http.js';
import { search } from '../src/search/engine.js';

let server: Server;
let endpoint: string;
const requests: Array<{ path: string; auth: string | undefined; body: Record<string, unknown> }> = [];

beforeAll(async () => {
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    requests.push({ path: request.url!, auth: request.headers.authorization, body });
    if (request.url === '/slow') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.write('<body>');
      return;
    }
    if (request.url === '/large') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('x'.repeat(2 * 1024 * 1024 + 1));
      return;
    }
    if (request.url?.startsWith('/redirect')) {
      response.writeHead(307, { location: '/v1/embeddings' });
      response.end();
      return;
    }
    const vector = body.model === 'broken' ? ['bad'] : [0.25, 0.5, 0.75];
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(request.url?.endsWith('/api/embeddings')
      ? { embedding: vector } : { data: [{ embedding: vector }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

it('uses actual HTTP JSON contracts, normalizes base paths, authenticates and caches immutable vectors', async () => {
  for (const suffix of ['', '/v1/']) {
    const embedder = new Embedder({ provider: 'openai', model: 'test', endpoint: endpoint + suffix, apiKey: 'synthetic-key' });
    const result = await embedder.embed('input text');
    expect(result?.vector).toEqual([0.25, 0.5, 0.75]);
    expect(requests.at(-1)).toMatchObject({ path: '/v1/embeddings', auth: 'Bearer synthetic-key',
      body: { model: 'test', input: 'input text', encoding_format: 'float' } });
    const count = requests.length;
    expect(await embedder.embed('input text')).toBe(result);
    expect(requests).toHaveLength(count);
    expect(Object.isFrozen(result!.vector)).toBe(true);
  }
  const ollama = new Embedder({ provider: 'ollama', model: 'test', endpoint: endpoint + '/api' });
  expect((await ollama.embed('prompt text'))?.vector).toHaveLength(3);
  expect(requests.at(-1)).toMatchObject({ path: '/api/embeddings', body: { prompt: 'prompt text' } });
});

it('rejects unsupported providers, malformed vectors and credential redirects', async () => {
  const unsupported = new Embedder({ provider: 'anthropic', model: 'test', endpoint });
  expect(unsupported.isAvailable()).toBe(false);
  const broken = new Embedder({ provider: 'openai', model: 'broken', endpoint });
  expect(await broken.embed('text')).toBeNull();
  expect(broken.getLastError()).toContain('Invalid embedding vector');
  const redirected = new Embedder({ provider: 'openai', model: 'test', endpoint: endpoint + '/redirect', apiKey: 'synthetic' });
  const count = requests.length;
  expect(await redirected.embed('text')).toBeNull();
  expect(requests).toHaveLength(count + 1);
});

it('aborts slow response bodies and bounds downloaded page bytes', async () => {
  expect(await crawlPage(endpoint + '/slow', { timeout: 50 })).toBeNull();
  expect(await crawlPage(endpoint + '/large')).toBeNull();
  expect(await crawlPage('file:///unused')).toBeNull();
});

it('reports byte limits even when a transport never finishes cancellation', async () => {
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(2)); },
    cancel() { return new Promise<void>(() => {}); },
  }));
  await expect(readResponseText(response, 1)).rejects.toThrow('HTTP response exceeds byte limit');
  expect(response.body?.locked).toBe(false);
}, 1000);

it('returns failed requests and rejected content types without awaiting transport cancellation', async () => {
  const original = globalThis.fetch;
  let cancellations = 0;
  const response = (status: number, contentType = 'text/html') => new Response(new ReadableStream({
    cancel() { cancellations++; return new Promise<void>(() => {}); },
  }), { status, headers: { 'content-type': contentType } });
  try {
    globalThis.fetch = async () => response(503);
    expect(await crawlPage('http://fixture.invalid/page')).toBeNull();
    expect(await search('fixture', { timeRange: 'y' })).toEqual([]);
    const client = new Embedder({ provider: 'openai', model: 'fixture', endpoint: 'http://fixture.invalid' });
    expect(await client.embed('fixture')).toBeNull();
    expect(client.getLastError()).toContain('HTTP 503');
    globalThis.fetch = async () => response(200, 'application/octet-stream');
    expect(await crawlPage('http://fixture.invalid/page')).toBeNull();
    expect(cancellations).toBe(4);
  } finally { globalThis.fetch = original; }
}, 1000);
