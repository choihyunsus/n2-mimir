// Cascading Recall — architecture.md section 8-3 + 8-8 (intersection) + 8-9 (question sequence)
// When a topic is given, recall relevant experiences through multiple search paths
import type { MimirDatabase } from '../store/database.js';
import type { RecallResult, ExperienceEntry, Insight, MemoryScope } from '../types.js';
import { classify, extractSearchTerms, decomposeQuery } from './classifier.js';
import type { Embedder } from '../semantic/embedder.js';
import { cosineSimilarity } from '../utils/math.js';

/** Recall confidence level — drives question sequence behavior (§8-9) */
export type RecallConfidence = 'none' | 'ambiguous' | 'clear';

/** Extended recall result with confidence metadata for question sequence */
export interface RecallResultWithConfidence extends RecallResult {
  readonly confidence: RecallConfidence;
  readonly dominantPattern?: string;
  readonly patternCounts?: ReadonlyArray<{ pattern: string; count: number }>;
}

/**
 * Cascading Recall: the core of Mímir's "experience just comes to you" mechanism.
 *
 * When the user mentions a topic:
 * 1. Classify → determine domains
 * 2. Decompose → split composite query into layers (§8-8)
 * 3. Intersection search → multi-layer AND (if composite)
 * 4. FTS5 search → full-text keyword match
 * 5. Tag search → hierarchical tag chain recall
 * 6. Category filter → direct category match on insights
 * 7. Merge & deduplicate
 * 8. Assess confidence → drive question sequence (§8-9)
 *
 * All in ~10ms thanks to SQLite indexes.
 */
export function recall(
  db: MimirDatabase, topic: string, project?: string, agent?: string,
  limit = 20, embedder?: Embedder,
): RecallResultWithConfidence {
  const scope = { project, agent };
  const searchTerms = extractSearchTerms(topic);
  const intersection = intersectLayers(db, decomposeQuery(topic), scope, limit);
  const ftsQuery = searchTerms.join(' OR ');
  const ftsResults = ftsQuery ? db.searchExperiences(ftsQuery, limit, scope) : [];
  const tagChain = db.getTagFrequencies(searchTerms, limit, scope);
  const tagged = db.findExperiencesByTags(searchTerms, limit, scope);
  const semantic = semanticExperiences(db, topic, scope, limit, embedder);
  const recent = project ? db.queryExperiences({ ...scope, limit }) : [];
  const experienceMap = new Map<string, ExperienceEntry>();
  for (const experience of [...intersection, ...ftsResults.map(item => item.experience), ...tagged, ...semantic, ...recent]) {
    if (inScope(experience, scope) && !experienceMap.has(experience.id)) experienceMap.set(experience.id, experience);
  }
  const experiences = [...experienceMap.values()];
  return { experiences, tagChain, insights: scopedInsights(db, classify(topic), scope, limit),
    ftsResults, ...assessConfidence(db, experiences) };
}

function inScope(experience: ExperienceEntry, scope: MemoryScope): boolean {
  return (scope.project === undefined || experience.project === scope.project)
    && (scope.agent === undefined || experience.agent === scope.agent);
}

function intersectLayers(db: MimirDatabase, layers: readonly (readonly string[])[], scope: MemoryScope, limit: number): ExperienceEntry[] {
  if (layers.length < 2) return [];
  const expanded = layers.map(layer => layer.flatMap(tag => [tag, ...db.findSimilarTags(tag, true).map(item => item.tag)]));
  return db.findExperiencesByTagsIntersection(expanded, limit, scope);
}

function scopedInsights(db: MimirDatabase, categories: readonly string[], scope: MemoryScope, limit: number): Insight[] {
  const insights = categories.flatMap(category => db.queryInsights({ ...scope, category,
    status: 'active', limit: Math.ceil(limit / categories.length) }));
  insights.push(...db.queryInsights({ ...scope, status: 'graduated', limit: 10 }));
  return [...new Map(insights.map(insight => [insight.id, insight])).values()];
}

function semanticExperiences(db: MimirDatabase, topic: string, scope: MemoryScope, limit: number, embedder?: Embedder): ExperienceEntry[] {
  if (!embedder?.isAvailable()) return [];
  const query = embedder.embedSync(topic);
  if (!query) return [];
  const scored: Array<{ experience: ExperienceEntry; score: number }> = [];
  for (const stored of db.getAllEmbeddings()) {
    if (stored.model !== query.model || stored.sourceType !== 'experience') continue;
    const experience = db.getExperience(stored.sourceId);
    if (!experience || !inScope(experience, scope)) continue;
    const score = cosineSimilarity(query.vector, stored.vector);
    if (score > 0.7) scored.push({ experience, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(item => item.experience);
}

interface Cluster { pattern: string; count: number; vector?: readonly number[]; model?: string; tokens: Set<string> }

function matchesCluster(cluster: Cluster, vector: ReturnType<MimirDatabase['getEmbedding']>, tokens: Set<string>): boolean {
  if (vector && cluster.vector && vector.model === cluster.model) {
    return cosineSimilarity(vector.vector, cluster.vector) >= 0.85;
  }
  const intersection = [...tokens].filter(token => cluster.tokens.has(token)).length;
  const union = tokens.size + cluster.tokens.size - intersection;
  return (union === 0 ? 1 : intersection / union) >= 0.7;
}

/**
 * Assess recall confidence based on experience count and pattern clarity.
 * Drives the question sequence behavior (architecture.md §8-9).
 */
function assessConfidence(
  db: MimirDatabase,
  experiences: ReadonlyArray<ExperienceEntry>,
): {
  confidence: RecallConfidence;
  dominantPattern?: string;
  patternCounts?: Array<{ pattern: string; count: number }>;
} {
  if (experiences.length === 0) {
    return { confidence: 'none' };
  }

  const clusters: Cluster[] = [];
  for (const experience of experiences) {
    const vector = db.getEmbedding('experience', experience.id);
    const tokens = new Set(experience.action.toLowerCase().match(/[\w\u3131-\u318E\uAC00-\uD7A3]+/g) ?? []);
    const cluster = clusters.find(item => matchesCluster(item, vector, tokens));
    if (cluster) cluster.count++;
    else clusters.push({ pattern: experience.action, count: 1, vector: vector?.vector, model: vector?.model, tokens });
  }

  const sorted = clusters
    .sort((a, b) => b.count - a.count)
    .map((c) => ({ pattern: c.pattern, count: c.count }));

  if (sorted.length === 0) {
    return { confidence: 'none' };
  }

  // Clear pattern: dominant action has > 50% of experiences, or only 1 pattern
  const total = experiences.length;
  const topRatio = sorted[0].count / total;

  if (sorted.length === 1 || topRatio >= 0.5) {
    return {
      confidence: 'clear',
      dominantPattern: sorted[0].pattern,
      patternCounts: sorted,
    };
  }

  return {
    confidence: 'ambiguous',
    patternCounts: sorted,
  };
}
