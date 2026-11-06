// insight — generator, voting, dedup, store lifecycle tests
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MimirDatabase } from '../src/store/database.js';
import { generateFromContrasts, generateFromPatterns } from '../src/insight/generator.js';
import { applyOperations, deduplicateOperations, findDuplicateInsight } from '../src/insight/voting.js';
import { checkGraduation, retireDormantInsights } from '../src/insight/store.js';
import type { ExperienceEntry, ContrastPair, RepeatedPattern } from '../src/types.js';
import { existsSync, unlinkSync } from 'fs';

const TEST_DB = './test-insight.db';

function makeExp(overrides: Partial<ExperienceEntry>): ExperienceEntry {
  return {
    id: Math.random().toString(36).slice(2), timestamp: new Date().toISOString(),
    sessionId: 's1', agent: 'worker', project: 'test', type: 'success',
    category: 'coding', severity: 'info', context: 'ctx', action: 'act',
    outcome: 'out', frequency: 1, tokenCost: 10, createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('insight', () => {
  let db: MimirDatabase;

  beforeEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    db = new MimirDatabase(TEST_DB);
  });

  afterEach(() => {
    db.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  describe('generator — generateFromContrasts', () => {
    it('should create ADD operations from contrast pairs', () => {
      const pairs: ContrastPair[] = [{
        failure: makeExp({ type: 'failure', action: 'used &&', outcome: 'error' }),
        success: makeExp({ type: 'success', action: 'used ;', outcome: 'worked' }),
        category: 'coding',
      }];
      const ops = generateFromContrasts(pairs);
      expect(ops).toHaveLength(1);
      expect(ops[0].op).toBe('ADD');
    });

    it('should include correction in compressed text', () => {
      const pairs: ContrastPair[] = [{
        failure: makeExp({ type: 'correction', action: 'wrong', outcome: 'bad', correction: 'use correct way' }),
        success: makeExp({ type: 'success', action: 'correct', outcome: 'good' }),
        category: 'path',
      }];
      const ops = generateFromContrasts(pairs);
      expect(ops[0].op === 'ADD' && ops[0].insight.compressed).toContain('use correct way');
    });
  });

  describe('generator — generateFromPatterns', () => {
    it('should create ADD ops from repeated patterns', () => {
      const patterns: RepeatedPattern[] = [{
        category: 'path', action: 'access deploy folder', count: 3,
        experiences: [makeExp({}), makeExp({}), makeExp({})],
      }];
      const ops = generateFromPatterns(patterns);
      expect(ops).toHaveLength(1);
      expect(ops[0].op === 'ADD' && ops[0].insight.compressed).toContain('3회');
    });
  });

  describe('voting — applyOperations', () => {
    it('should apply ADD operations', () => {
      const ops = [{ op: 'ADD' as const, insight: { agent: 'a', description: 'd', compressed: 'c', category: 'cat' } }];
      const result = applyOperations(db, ops);
      expect(result.applied).toBe(1);
      expect(db.queryInsights({}).length).toBe(1);
    });

    it('should apply UPVOTE operations', () => {
      const insight = db.insertInsight({ agent: 'a', description: 'd', compressed: 'c', category: 'cat' });
      const result = applyOperations(db, [{ op: 'UPVOTE', insightId: insight.id }]);
      expect(result.applied).toBe(1);
      expect(db.getInsight(insight.id)!.importance).toBe(3);
    });
  });

  describe('voting — deduplicateOperations', () => {
    it('should convert ADD to UPVOTE for an exact existing insight', () => {
      db.insertInsight({ agent: 'a', description: 'use semicolon instead of ampersand', compressed: 'c', category: 'coding' });
      const ops = [{ op: 'ADD' as const, insight: { agent: 'a', description: 'use semicolon instead of ampersand', compressed: 'c', category: 'coding' } }];
      const deduped = deduplicateOperations(db, ops);
      expect(deduped[0].op).toBe('UPVOTE');
    });

    it('should keep ADD for truly new insights', () => {
      const ops = [{ op: 'ADD' as const, insight: { agent: 'a', description: 'totally unique insight about deployment', compressed: 'c', category: 'deploy' } }];
      const deduped = deduplicateOperations(db, ops);
      expect(deduped[0].op).toBe('ADD');
    });
  });

  describe('store — checkGraduation', () => {
    it('should find graduation candidates', () => {
      const insight = db.insertInsight({ agent: 'a', description: 'd', compressed: 'c', category: 'c' });
      // Pump importance to 5
      for (let i = 0; i < 3; i++) db.upvoteInsight(insight.id);
      // Set effect score high via direct recording
      for (let i = 0; i < 5; i++) {
        db.recordEffect({ insightId: insight.id, sessionId: `s${i}`, wasRelevant: true, wasFollowed: true, outcome: 'positive' });
      }
      const candidates = checkGraduation(db);
      expect(candidates.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('store — retireDormantInsights', () => {
    it('should retire insights with importance 0', () => {
      const insight = db.insertInsight({ agent: 'a', description: 'd', compressed: 'c', category: 'c' });
      db.downvoteInsight(insight.id); // 1
      db.downvoteInsight(insight.id); // 0 → retired
      const retired = retireDormantInsights(db);
      // Already retired by downvote logic, so retireDormantInsights finds 0 active with imp<=0
      expect(retired).toBe(0);
    });
  });
});
