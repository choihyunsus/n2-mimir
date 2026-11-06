// Project ownership and evidence replay must remain consistent in a shared database.
import { describe, it, expect } from 'vitest';
import { MimirDatabase } from '../src/store/database.js';
import { applyOperations } from '../src/insight/voting.js';

describe('insight provenance', () => {
  it('keeps project insights scoped and rolls back invalid source ownership', () => {
    const db = new MimirDatabase(':memory:');
    try {
      const source = db.insertExperience({ agent: 'alpha', project: 'one', type: 'failure',
        category: 'testing', context: 'context', action: 'test', outcome: 'failed' });
      const other = db.insertExperience({ agent: 'beta', project: 'two', type: 'success',
        category: 'testing', context: 'context', action: 'test', outcome: 'passed' });
      const input = { agent: 'alpha', project: 'one', category: 'testing', description: 'candidate', compressed: 'candidate' };
      const insight = db.insertInsight({ ...input, sourceIds: [source.id] });
      expect(db.queryInsights({ project: 'one', agent: 'alpha' }).map(item => item.id)).toEqual([insight.id]);
      expect(db.queryInsights({ project: 'two', agent: 'alpha' })).toEqual([]);
      expect(() => db.insertInsight({ ...input, sourceIds: [source.id, other.id] })).toThrow();
      expect(() => db.insertInsight({ ...input, sourceIds: ['missing'] })).toThrow();
      expect(db.getStats().insights).toBe(1);
    } finally { db.close(); }
  });

  it('reinforces only for new evidence and replays without increasing importance', () => {
    const db = new MimirDatabase(':memory:');
    try {
      const input = { agent: 'alpha', project: 'one', type: 'failure' as const,
        category: 'testing', context: 'context', action: 'test', outcome: 'failed' };
      const first = db.insertExperience(input);
      const second = db.insertExperience({ ...input, action: 'another test' });
      const insight = db.insertInsight({ agent: 'alpha', project: 'one', category: 'testing',
        description: 'candidate', compressed: 'candidate', sourceIds: [first.id] });
      const repeated = applyOperations(db, [{ op: 'UPVOTE', insightId: insight.id, sourceIds: [first.id] }]);
      expect(repeated).toEqual({ applied: 0, created: 0, skipped: 1, errors: [] });
      const fresh = [{ op: 'UPVOTE' as const, insightId: insight.id, sourceIds: [first.id, second.id] }];
      expect(applyOperations(db, fresh).applied).toBe(1);
      expect(applyOperations(db, fresh).applied).toBe(0);
      expect(db.getInsight(insight.id)?.importance).toBe(3);
    } finally { db.close(); }
  });

  it('applies owner scope before FTS and tag limits', () => {
    const db = new MimirDatabase(':memory:');
    try {
      const own = db.insertExperience({ agent: 'alpha', project: 'one', type: 'success',
        category: 'testing', context: 'keyword', action: 'test', outcome: 'passed' });
      db.setTags(own.id, [{ level: 1, tag: 'keyword' }]);
      for (let index = 0; index < 30; index += 1) {
        const foreign = db.insertExperience({ agent: 'beta', project: 'two', type: 'failure',
          category: 'testing', context: 'keyword', action: `keyword ${index}`, outcome: 'keyword' });
        db.setTags(foreign.id, [{ level: 1, tag: 'keyword' }]);
      }
      const scope = { project: 'one', agent: 'alpha' };
      expect(db.searchExperiences('keyword', 1, scope).map(item => item.experience.id)).toEqual([own.id]);
      expect(db.findExperiencesByTags(['keyword'], 1, scope).map(item => item.id)).toEqual([own.id]);
      expect(db.getTagFrequencies(['keyword'], 1, scope)[0].frequency).toBe(1);
    } finally { db.close(); }
  });
});
