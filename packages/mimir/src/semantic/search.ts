// Semantic search — cosine similarity based vector search
// Searches stored embeddings in the database against a query vector

import type { MimirDatabase } from '../store/database.js';
import type { Embedder } from './embedder.js';
import type { ExperienceEntry, Insight, MemoryScope } from '../types.js';
import { cosineSimilarity } from '../utils/math.js';

/** Semantic search result */
export interface SemanticResult {
  readonly sourceType: 'experience' | 'insight';
  readonly sourceId: string;
  readonly similarity: number;
}

/**
 * Semantic search: embed query text → compare with stored vectors via cosine similarity.
 * Returns empty array if Embedder is inactive.
 */
export async function semanticSearch(
  db: MimirDatabase,
  embedder: Embedder,
  query: string,
  limit = 10,
  scope: MemoryScope = {},
): Promise<readonly SemanticResult[]> {
  if (!embedder.isAvailable()) return [];

  const queryEmbedding = await embedder.embed(query);
  if (!queryEmbedding) return [];

  // Fetch all embeddings from DB and compute cosine similarity
  // (sufficient for small DBs, Rust core's batch_cosine_similarity for large-scale)
  const allEmbeddings = db.getAllEmbeddings();
  if (allEmbeddings.length === 0) return [];

  const results: SemanticResult[] = allEmbeddings
    .filter(embedding => {
      if (embedding.model !== queryEmbedding.model) return false;
      if (embedding.sourceType === 'insight') {
        return db.queryInsights({ ...scope, id: embedding.sourceId, limit: 1 }).length === 1;
      }
      const experience = db.getExperience(embedding.sourceId);
      return !!experience && (scope.project === undefined || experience.project === scope.project)
        && (scope.agent === undefined || experience.agent === scope.agent);
    })
    .map((emb) => ({
      sourceType: emb.sourceType as 'experience' | 'insight',
      sourceId: emb.sourceId,
      similarity: cosineSimilarity(queryEmbedding.vector, emb.vector),
    }))
    .filter((r) => r.similarity > 0.3) // minimum similarity threshold
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  return results;
}

/**
 * Embed an experience or insight and store in DB.
 * Skips if embedding already exists.
 */
export async function embedAndStore(
  db: MimirDatabase,
  embedder: Embedder,
  sourceType: 'experience' | 'insight',
  sourceId: string,
  text: string,
): Promise<boolean> {
  if (!embedder.isAvailable() || db.isClosed) return false;

  // Check if embedding already exists
  const existing = db.getEmbedding(sourceType, sourceId);
  if (existing) return false;

  const result = await embedder.embed(text);
  if (!result || db.isClosed) return false;

  db.storeEmbedding(sourceType, sourceId, result.vector, result.model);
  return true;
}

/**
 * Convert experience to text for embedding.
 * Combines context + action + outcome for meaningful vector generation.
 */
export function experienceToText(exp: ExperienceEntry): string {
  const parts = [exp.context, exp.action, exp.outcome];
  if (exp.correction) parts.push(exp.correction);
  return parts.join(' ');
}

/** Convert insight to text for embedding */
export function insightToText(insight: Insight): string {
  return insight.description;
}

