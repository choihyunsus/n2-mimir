// Ollama and OpenAI-compatible embedding client with bounded caching and I/O.
import type { LlmConfig } from '../types.js';
import { createHash } from 'node:crypto';
import { httpUrl, readResponseText } from '../http.js';

export interface EmbeddingResult {
  readonly vector: readonly number[];
  readonly model: string;
}

const CACHE_LIMIT = 256;
const MAX_INPUT_CHARS = 65536;
const MAX_DIMENSIONS = 65536;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const BATCH_CONCURRENCY = 3;

export class Embedder {
  private readonly config?: LlmConfig;
  private readonly cache = new Map<string, EmbeddingResult>();
  private lastError: string | null = null;

  constructor(config?: LlmConfig) {
    this.config = config ? { ...config } : undefined;
    if (config?.endpoint) httpUrl(config.endpoint);
  }

  isAvailable(): boolean {
    return !!(this.config?.endpoint && this.config.model &&
      ['ollama', 'openai'].includes(this.config.provider));
  }

  getLastError(): string | null { return this.lastError; }

  async embed(text: string): Promise<EmbeddingResult | null> {
    if (!this.isAvailable()) return null;
    try {
      if (typeof text !== 'string' || !text.trim() || text.length > MAX_INPUT_CHARS) {
        throw new Error('Embedding input must contain 1–65536 characters');
      }
      const cached = this.embedSync(text);
      if (cached) return cached;
      const vector = await this.callApi(text);
      if (!Array.isArray(vector) || vector.length === 0 || vector.length > MAX_DIMENSIONS ||
          !vector.every(value => typeof value === 'number' && Number.isFinite(value))) {
        throw new Error('Invalid embedding vector in response');
      }
      const result = Object.freeze({ vector: Object.freeze([...vector]), model: this.config!.model });
      this.cache.set(this.cacheKey(text), result);
      if (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
      this.lastError = null;
      return result;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Embedding request failed';
      return null;
    }
  }

  embedSync(text: string): EmbeddingResult | null {
    return this.cache.get(this.cacheKey(text)) ?? null;
  }

  private cacheKey(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }

  async embedBatch(texts: readonly string[]): Promise<(EmbeddingResult | null)[]> {
    const results: (EmbeddingResult | null)[] = [];
    for (let index = 0; index < texts.length; index += BATCH_CONCURRENCY) {
      results.push(...await Promise.all(texts.slice(index, index + BATCH_CONCURRENCY).map(text => this.embed(text))));
    }
    return results;
  }

  private async callApi(text: string): Promise<unknown> {
    const { provider, model, endpoint, apiKey, timeoutMs = 10000 } = this.config!;
    const url = httpUrl(endpoint!);
    const base = url.pathname.replace(/\/+$/, '');
    const openai = provider === 'openai';
    url.pathname = openai
      ? `${base.endsWith('/v1') ? base : `${base}/v1`}/embeddings`
      : `${base.endsWith('/api') ? base : `${base}/api`}/embeddings`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await fetch(url, {
      method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify(openai ? { model, input: text, encoding_format: 'float' } : { model, prompt: text }),
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error(`Embedding request failed with HTTP ${response.status}`);
    }
    const data = JSON.parse(await readResponseText(response, MAX_RESPONSE_BYTES));
    return openai ? data.data?.[0]?.embedding : data.embedding;
  }
}
