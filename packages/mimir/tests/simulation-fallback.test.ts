// Simulation 2: FallbackStore direct verification
// Tests every method of the extracted FallbackStore class independently
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FallbackStore } from '../src/store/database-fallback.js';
import Database from 'better-sqlite3';
import { existsSync, unlinkSync } from 'fs';

const TEST_DB = './test-sim-fallback.db';

describe('Simulation 2: FallbackStore Direct Verification', () => {
  let store: FallbackStore;
  let rawDb: Database.Database;

  beforeEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    rawDb = new Database(TEST_DB);
    store = new FallbackStore(rawDb);
  });

  afterEach(() => {
    rawDb.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  // --- CRUD ---

  it('should insert and map experience correctly', () => {
    const exp = store.insertExperience({
      agent: 'test-agent', project: 'test-project', type: 'failure',
      category: 'coding_pattern', severity: 'error',
      context: 'testing context', action: 'testing action',
      outcome: 'testing outcome', correction: 'fix it',
      sessionId: 'session-001',
    });

    expect(exp.id).toBeTruthy();
    expect(exp.agent).toBe('test-agent');
    expect(exp.project).toBe('test-project');
    expect(exp.type).toBe('failure');
    expect(exp.category).toBe('coding_pattern');
    expect(exp.severity).toBe('error');
    expect(exp.context).toBe('testing context');
    expect(exp.action).toBe('testing action');
    expect(exp.outcome).toBe('testing outcome');
    expect(exp.correction).toBe('fix it');
    expect(exp.tokenCost).toBeGreaterThan(0);
    expect(exp.frequency).toBe(1);
    expect(exp.createdAt).toBeTruthy();
  });

  it('should query with multiple filters', () => {
    store.insertExperience({ agent: 'a', project: 'p1', type: 'success', category: 'c1', context: 'x', action: 'y', outcome: 'z' });
    store.insertExperience({ agent: 'a', project: 'p2', type: 'failure', category: 'c2', severity: 'critical', context: 'x', action: 'y', outcome: 'z' });
    store.insertExperience({ agent: 'b', project: 'p1', type: 'failure', category: 'c1', context: 'x', action: 'y', outcome: 'z' });

    // Multi-filter
    const result = store.queryExperiences({ project: 'p1', agent: 'a', type: 'success' });
    expect(result).toHaveLength(1);
    expect(result[0].project).toBe('p1');
    expect(result[0].agent).toBe('a');
  });

  // --- FTS5 ---

  it('should search via FTS5 full-text search', () => {
    store.insertExperience({ agent: 'a', project: 'p', type: 'failure', category: 'c', context: 'PowerShell terminal', action: 'used && operator', outcome: 'syntax error occurred' });
    store.insertExperience({ agent: 'a', project: 'p', type: 'success', category: 'c', context: 'Bash terminal', action: 'used && operator', outcome: 'worked fine' });

    const results = store.searchExperiences('PowerShell', 10);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].experience.context).toContain('PowerShell');
    expect(results[0].rank).toBe(1);
  });

  // --- Tags ---

  it('should set, get frequencies, and find by tags', () => {
    const e1 = store.insertExperience({ agent: 'a', project: 'p', type: 'success', category: 'c', context: 'x', action: 'y', outcome: 'z' });
    const e2 = store.insertExperience({ agent: 'a', project: 'p', type: 'failure', category: 'c', context: 'x', action: 'y', outcome: 'z' });

    store.setTags(e1.id, [{ level: 1, tag: 'coding' }, { level: 2, tag: 'typescript' }]);
    store.setTags(e2.id, [{ level: 1, tag: 'coding' }, { level: 2, tag: 'python' }]);

    // Frequency check
    const freqs = store.getTagFrequencies(['coding', 'typescript', 'python'], 10);
    const codingFreq = freqs.find((f) => f.tag === 'coding');
    expect(codingFreq?.frequency).toBe(2); // coding appears in both

    // Find by tag
    const pythonExps = store.findExperiencesByTags(['python'], 10);
    expect(pythonExps).toHaveLength(1);
    expect(pythonExps[0].id).toBe(e2.id);
  });

  // --- Layer Intersection ---

  it('should find experiences by multi-layer tag intersection', () => {
    const e1 = store.insertExperience({ agent: 'a', project: 'p', type: 'success', category: 'c', context: 'x', action: 'y', outcome: 'z' });
    const e2 = store.insertExperience({ agent: 'a', project: 'p', type: 'failure', category: 'c', context: 'x', action: 'y', outcome: 'z' });
    const e3 = store.insertExperience({ agent: 'a', project: 'p', type: 'pattern', category: 'c', context: 'x', action: 'y', outcome: 'z' });

    store.setTags(e1.id, [{ level: 1, tag: 'lang:ts' }, { level: 2, tag: 'tool:vscode' }]);
    store.setTags(e2.id, [{ level: 1, tag: 'lang:ts' }, { level: 2, tag: 'tool:cursor' }]);
    store.setTags(e3.id, [{ level: 1, tag: 'lang:py' }, { level: 2, tag: 'tool:vscode' }]);

    // Intersection: lang:ts AND tool:vscode → only e1
    const result = store.findByTagsIntersection([['lang:ts'], ['tool:vscode']], 10);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(e1.id);

    // Intersection: lang:ts → e1 + e2
    const result2 = store.findByTagsIntersection([['lang:ts']], 10);
    expect(result2).toHaveLength(2);
  });

  // --- Delta Learning ---

  it('should upsert: new insert then frequency++', () => {
    const r1 = store.upsertExperience({
      agent: 'a', project: 'p', type: 'pattern', category: 'workflow',
      context: 'c', action: 'run typecheck', outcome: 'catches errors',
    });
    expect(r1.isNew).toBe(true);

    const r2 = store.upsertExperience({
      agent: 'a', project: 'p', type: 'pattern', category: 'workflow',
      context: 'c', action: 'run typecheck', outcome: 'catches errors',
    });
    expect(r2.isNew).toBe(false);
    expect(r2.id).toBe(r1.id);

    // Verify frequency incremented
    const exp = store.getExperience(r1.id);
    expect(exp!.frequency).toBe(2);
  });

  // --- Tag Similarity ---

  it('should track tag similarity with increasing confidence', () => {
    store.upsertTagSimilarity('typescript', 'javascript');
    let similar = store.findSimilarTags('typescript', false);
    expect(similar.length).toBeGreaterThanOrEqual(1);
    const firstConfidence = similar[0].confidence;

    // Upsert again → confidence should increase
    store.upsertTagSimilarity('typescript', 'javascript');
    similar = store.findSimilarTags('typescript', false);
    expect(similar[0].confidence).toBeGreaterThan(firstConfidence);
  });

  // --- Insight Lifecycle ---

  it('should handle full insight lifecycle: create → upvote → downvote → retire', () => {
    const insight = store.insertInsight({
      agent: 'worker', description: 'Always use ; in PowerShell',
      compressed: '; not &&', category: 'coding_pattern',
    });
    expect(insight.importance).toBe(2); // default
    expect(insight.status).toBe('active');

    // Upvote ×3
    store.upvoteInsight(insight.id);
    store.upvoteInsight(insight.id);
    store.upvoteInsight(insight.id);
    let updated = store.getInsight(insight.id)!;
    expect(updated.importance).toBe(5);

    // Downvote ×5 → importance drops to 0 → retired
    for (let i = 0; i < 5; i++) store.downvoteInsight(insight.id);
    updated = store.getInsight(insight.id)!;
    expect(updated.importance).toBe(0);
    expect(updated.status).toBe('retired');
  });

  // --- Embeddings ---

  it('should store/retrieve embeddings with Float32 precision', () => {
    const vector = [0.12345, 0.67890, -0.11111, 0.99999, 0.00001];
    store.storeEmbedding('experience', 'exp-sim-001', vector, 'test-model');

    const result = store.getEmbedding('experience', 'exp-sim-001');
    expect(result).not.toBeNull();
    expect(result!.model).toBe('test-model');
    expect(result!.vector.length).toBe(5);

    // Float32 precision check
    for (let i = 0; i < vector.length; i++) {
      expect(Math.abs(Number(result!.vector[i]) - vector[i])).toBeLessThan(0.0001);
    }

    // getAllEmbeddings
    store.storeEmbedding('insight', 'ins-sim-001', [1, 2, 3], 'model2');
    const all = store.getAllEmbeddings();
    expect(all.length).toBe(2);
  });

  // --- Effect Tracking ---

  it('should calculate effect score correctly', () => {
    const insight = store.insertInsight({
      agent: 'a', description: 'test', compressed: 't', category: 'c',
    });

    // 3 positive, 1 negative → score = 3/4 = 0.75
    store.recordEffect({ insightId: insight.id, sessionId: 's1', wasRelevant: true, wasFollowed: true, outcome: 'positive' });
    store.recordEffect({ insightId: insight.id, sessionId: 's2', wasRelevant: true, wasFollowed: true, outcome: 'positive' });
    store.recordEffect({ insightId: insight.id, sessionId: 's3', wasRelevant: true, wasFollowed: true, outcome: 'positive' });
    store.recordEffect({ insightId: insight.id, sessionId: 's4', wasRelevant: true, wasFollowed: false, outcome: 'negative' });

    const updated = store.getInsight(insight.id)!;
    expect(updated.effectScore).toBe(0.75);
  });
});
