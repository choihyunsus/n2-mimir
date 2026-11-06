// store/database — CRUD, FTS5, tags, voting, effect tracking tests
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MimirDatabase } from '../src/store/database.js';
import { existsSync, unlinkSync } from 'fs';

const TEST_DB = './test-store.db';

describe('MimirDatabase', () => {
  let db: MimirDatabase;

  beforeEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    db = new MimirDatabase(TEST_DB);
  });

  afterEach(() => {
    db.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  // === Experience CRUD ===

  describe('insertExperience', () => {
    it('should insert and return an experience', () => {
      const exp = db.insertExperience({
        agent: 'worker', project: 'test', type: 'failure',
        category: 'coding_pattern', context: 'test context',
        action: 'test action', outcome: 'test outcome',
      });
      expect(exp.id).toBeTruthy();
      expect(exp.agent).toBe('worker');
      expect(exp.project).toBe('test');
      expect(exp.type).toBe('failure');
      expect(exp.tokenCost).toBeGreaterThan(0);
    });

    it('should auto-generate UUID', () => {
      const e1 = db.insertExperience({
        agent: 'a', project: 'p', type: 'success',
        category: 'c', context: 'x', action: 'y', outcome: 'z',
      });
      const e2 = db.insertExperience({
        agent: 'a', project: 'p', type: 'success',
        category: 'c', context: 'x', action: 'y', outcome: 'z',
      });
      expect(e1.id).not.toBe(e2.id);
    });
  });

  describe('getExperience', () => {
    it('should return undefined for non-existent ID', () => {
      expect(db.getExperience('non-existent')).toBeUndefined();
    });

    it('should return inserted experience', () => {
      const inserted = db.insertExperience({
        agent: 'worker', project: 'test', type: 'correction',
        category: 'file_system', context: 'ctx', action: 'act',
        outcome: 'out', correction: 'fix it',
      });
      const found = db.getExperience(inserted.id);
      expect(found).toBeDefined();
      expect(found!.correction).toBe('fix it');
    });
  });

  describe('queryExperiences', () => {
    it('should filter by project', () => {
      db.insertExperience({ agent: 'a', project: 'p1', type: 'success', category: 'c', context: 'x', action: 'y', outcome: 'z' });
      db.insertExperience({ agent: 'a', project: 'p2', type: 'success', category: 'c', context: 'x', action: 'y', outcome: 'z' });
      const results = db.queryExperiences({ project: 'p1' });
      expect(results).toHaveLength(1);
      expect(results[0].project).toBe('p1');
    });

    it('should filter by type and severity', () => {
      db.insertExperience({ agent: 'a', project: 'p', type: 'failure', category: 'c', severity: 'critical', context: 'x', action: 'y', outcome: 'z' });
      db.insertExperience({ agent: 'a', project: 'p', type: 'success', category: 'c', severity: 'info', context: 'x', action: 'y', outcome: 'z' });
      const results = db.queryExperiences({ type: 'failure', severity: 'critical' });
      expect(results).toHaveLength(1);
    });

    it('should respect limit', () => {
      for (let i = 0; i < 10; i++) {
        db.insertExperience({ agent: 'a', project: 'p', type: 'success', category: 'c', context: 'x', action: `action${i}`, outcome: 'z' });
      }
      expect(db.queryExperiences({ limit: 3 })).toHaveLength(3);
    });
  });

  // === FTS5 Search ===

  describe('searchExperiences', () => {
    it('should find experiences by keyword', () => {
      db.insertExperience({ agent: 'a', project: 'p', type: 'failure', category: 'c', context: 'PowerShell terminal', action: 'used && operator', outcome: 'syntax error' });
      db.insertExperience({ agent: 'a', project: 'p', type: 'success', category: 'c', context: 'Python script', action: 'used print', outcome: 'worked fine' });
      const results = db.searchExperiences('PowerShell');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].experience.context).toContain('PowerShell');
    });

    it('should return empty for no match', () => {
      db.insertExperience({ agent: 'a', project: 'p', type: 'success', category: 'c', context: 'test', action: 'test', outcome: 'test' });
      const results = db.searchExperiences('xyznonexistent');
      expect(results).toHaveLength(0);
    });
  });

  // === Insight CRUD ===

  describe('insertInsight', () => {
    it('should create insight with default values', () => {
      const insight = db.insertInsight({
        agent: 'worker', description: 'Use ; instead of &&',
        compressed: '; not &&', category: 'coding_pattern',
      });
      expect(insight.importance).toBe(2);
      expect(insight.confidence).toBe(0.5);
      expect(insight.effectScore).toBe(0);
      expect(insight.status).toBe('active');
    });
  });

  describe('queryInsights', () => {
    it('should filter by status', () => {
      db.insertInsight({ agent: 'a', description: 'd1', compressed: 'c1', category: 'c' });
      const active = db.queryInsights({ status: 'active' });
      expect(active).toHaveLength(1);
      const graduated = db.queryInsights({ status: 'graduated' });
      expect(graduated).toHaveLength(0);
    });

    it('should filter by minImportance', () => {
      const insight = db.insertInsight({ agent: 'a', description: 'd', compressed: 'c', category: 'c' });
      db.upvoteInsight(insight.id); // imp = 3
      db.upvoteInsight(insight.id); // imp = 4
      db.upvoteInsight(insight.id); // imp = 5
      expect(db.queryInsights({ minImportance: 5 })).toHaveLength(1);
      expect(db.queryInsights({ minImportance: 6 })).toHaveLength(0);
    });
  });

  // === Voting ===

  describe('upvoteInsight / downvoteInsight', () => {
    it('should increase importance on upvote', () => {
      const insight = db.insertInsight({ agent: 'a', description: 'd', compressed: 'c', category: 'c' });
      db.upvoteInsight(insight.id);
      const updated = db.getInsight(insight.id)!;
      expect(updated.importance).toBe(3);
    });

    it('should decrease importance on downvote', () => {
      const insight = db.insertInsight({ agent: 'a', description: 'd', compressed: 'c', category: 'c' });
      db.downvoteInsight(insight.id);
      const updated = db.getInsight(insight.id)!;
      expect(updated.importance).toBe(1);
    });

    it('should retire insight when importance reaches 0', () => {
      const insight = db.insertInsight({ agent: 'a', description: 'd', compressed: 'c', category: 'c' });
      db.downvoteInsight(insight.id); // 1
      db.downvoteInsight(insight.id); // 0 → retired
      const updated = db.getInsight(insight.id)!;
      expect(updated.importance).toBe(0);
      expect(updated.status).toBe('retired');
    });
  });

  describe('graduateInsight', () => {
    it('should graduate and set converted fields', () => {
      const insight = db.insertInsight({ agent: 'a', description: 'd', compressed: 'c', category: 'c' });
      db.graduateInsight(insight.id, 'ark_rule', 'rule-123');
      const updated = db.getInsight(insight.id)!;
      expect(updated.status).toBe('graduated');
      expect(updated.convertedType).toBe('ark_rule');
      expect(updated.convertedRef).toBe('rule-123');
    });
  });

  // === Tags ===

  describe('tags', () => {
    it('should set and retrieve tag frequencies', () => {
      const exp = db.insertExperience({ agent: 'a', project: 'p', type: 'success', category: 'c', context: 'x', action: 'y', outcome: 'z' });
      db.setTags(exp.id, [{ level: 1, tag: 'coding' }, { level: 2, tag: 'typescript' }]);
      const freqs = db.getTagFrequencies(['coding', 'typescript']);
      expect(freqs).toHaveLength(2);
    });

    it('should find experiences by tags', () => {
      const e1 = db.insertExperience({ agent: 'a', project: 'p', type: 'success', category: 'c', context: 'x', action: 'y', outcome: 'z' });
      const e2 = db.insertExperience({ agent: 'a', project: 'p', type: 'failure', category: 'c', context: 'x', action: 'y', outcome: 'z' });
      db.setTags(e1.id, [{ level: 1, tag: 'video' }]);
      db.setTags(e2.id, [{ level: 1, tag: 'coding' }]);
      const results = db.findExperiencesByTags(['video']);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(e1.id);
    });
  });

  // === Effect Tracking ===

  describe('recordEffect', () => {
    it('should record and update effect score', () => {
      const insight = db.insertInsight({ agent: 'a', description: 'd', compressed: 'c', category: 'c' });
      db.recordEffect({ insightId: insight.id, sessionId: 's1', wasRelevant: true, wasFollowed: true, outcome: 'positive' });
      db.recordEffect({ insightId: insight.id, sessionId: 's2', wasRelevant: true, wasFollowed: true, outcome: 'positive' });
      const updated = db.getInsight(insight.id)!;
      expect(updated.effectScore).toBe(1.0);
    });
  });

  // === Stats ===

  describe('getStats', () => {
    it('should return correct counts', () => {
      db.insertExperience({ agent: 'a', project: 'p', type: 'success', category: 'c', context: 'x', action: 'y', outcome: 'z' });
      db.insertInsight({ agent: 'a', description: 'd', compressed: 'c', category: 'c' });
      const stats = db.getStats();
      expect(stats.experiences).toBe(1);
      expect(stats.insights).toBe(1);
    });
  });
});
