// tracker/scorer — effect tracking + graduation evaluation tests
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MimirDatabase } from '../src/store/database.js';
import { trackEffect, evaluateGraduation } from '../src/tracker/scorer.js';
import { existsSync, unlinkSync } from 'fs';
import Sqlite from 'better-sqlite3';

const TEST_DB = './test-tracker.db';

describe('tracker', () => {
  let db: MimirDatabase;

  beforeEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    db = new MimirDatabase(TEST_DB);
  });

  afterEach(() => {
    db.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  describe('trackEffect', () => {
    it('applies a session once and rejects a conflicting replay', () => {
      const insight = db.insertInsight({ agent: 'a', description: 'd', compressed: 'c', category: 'c' });
      const measurement = { insightId: insight.id, sessionId: 'stable', wasRelevant: true,
        wasFollowed: true, outcome: 'positive' as const };
      trackEffect(db, measurement);
      trackEffect(db, measurement);
      expect(db.getInsight(insight.id)!.importance).toBe(3);
      expect(() => trackEffect(db, { ...measurement, outcome: 'negative' })).toThrow(/Conflicting/);
      expect(db.getInsight(insight.id)!.effectScore).toBe(1);
      expect(() => trackEffect(db, { ...measurement, sessionId: '' })).toThrow();
    });

    it('rolls back the observation when voting fails and permits a complete retry', () => {
      const insight = db.insertInsight({ agent: 'a', description: 'd', compressed: 'c', category: 'c' });
      const measurement = { insightId: insight.id, sessionId: 'retry', wasRelevant: true,
        wasFollowed: true, outcome: 'positive' as const };
      const sql = new Sqlite(TEST_DB);
      try {
        sql.exec("CREATE TRIGGER fail_vote BEFORE UPDATE OF importance ON insights BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
        expect(() => trackEffect(db, measurement)).toThrow(/injected failure/);
        expect(sql.prepare('SELECT COUNT(*) AS count FROM effect_tracking').get()).toEqual({ count: 0 });
        sql.exec('DROP TRIGGER fail_vote');
        trackEffect(db, measurement);
        expect(db.getInsight(insight.id)!.importance).toBe(3);
      } finally { sql.close(); }
    });

    it('should auto-upvote on positive followed outcome', () => {
      const insight = db.insertInsight({ agent: 'a', description: 'd', compressed: 'c', category: 'c' });
      trackEffect(db, { insightId: insight.id, sessionId: 's1', wasRelevant: true, wasFollowed: true, outcome: 'positive' });
      expect(db.getInsight(insight.id)!.importance).toBe(3); // 2 + 1 upvote
    });

    it('should auto-downvote on negative relevant outcome', () => {
      const insight = db.insertInsight({ agent: 'a', description: 'd', compressed: 'c', category: 'c' });
      trackEffect(db, { insightId: insight.id, sessionId: 's1', wasRelevant: true, wasFollowed: false, outcome: 'negative' });
      expect(db.getInsight(insight.id)!.importance).toBe(1); // 2 - 1 downvote
    });

    it('should not change importance on neutral outcome', () => {
      const insight = db.insertInsight({ agent: 'a', description: 'd', compressed: 'c', category: 'c' });
      trackEffect(db, { insightId: insight.id, sessionId: 's1', wasRelevant: true, wasFollowed: true, outcome: 'neutral' });
      expect(db.getInsight(insight.id)!.importance).toBe(2); // unchanged
    });

    it('should update effect score based on recordings', () => {
      const insight = db.insertInsight({ agent: 'a', description: 'd', compressed: 'c', category: 'c' });
      trackEffect(db, { insightId: insight.id, sessionId: 's1', wasRelevant: true, wasFollowed: true, outcome: 'positive' });
      trackEffect(db, { insightId: insight.id, sessionId: 's2', wasRelevant: true, wasFollowed: true, outcome: 'positive' });
      trackEffect(db, { insightId: insight.id, sessionId: 's3', wasRelevant: true, wasFollowed: true, outcome: 'negative' });
      const updated = db.getInsight(insight.id)!;
      // 2 positive out of 3 total = 0.666...
      expect(updated.effectScore).toBeCloseTo(0.67, 1);
    });
  });

  describe('evaluateGraduation', () => {
    it('should graduate insights with importance>=5 and effectScore>=0.8', () => {
      const insight = db.insertInsight({ agent: 'a', description: 'd', compressed: 'c', category: 'c' });
      // importance to 5
      for (let i = 0; i < 3; i++) db.upvoteInsight(insight.id);
      // effect score to 1.0
      for (let i = 0; i < 5; i++) {
        db.recordEffect({ insightId: insight.id, sessionId: `s${i}`, wasRelevant: true, wasFollowed: true, outcome: 'positive' });
      }
      const graduated = evaluateGraduation(db);
      expect(graduated).toContain(insight.id);
      expect(db.getInsight(insight.id)!.status).toBe('graduated');
    });

    it('should not graduate low importance insights', () => {
      const insight = db.insertInsight({ agent: 'a', description: 'd', compressed: 'c', category: 'c' });
      // importance stays 2, effect 1.0
      for (let i = 0; i < 5; i++) {
        db.recordEffect({ insightId: insight.id, sessionId: `s${i}`, wasRelevant: true, wasFollowed: true, outcome: 'positive' });
      }
      const graduated = evaluateGraduation(db);
      expect(graduated).not.toContain(insight.id);
    });

    it('should not graduate low effect score insights', () => {
      const insight = db.insertInsight({ agent: 'a', description: 'd', compressed: 'c', category: 'c' });
      for (let i = 0; i < 3; i++) db.upvoteInsight(insight.id); // imp = 5
      // All negative = effect 0.0
      for (let i = 0; i < 5; i++) {
        db.recordEffect({ insightId: insight.id, sessionId: `s${i}`, wasRelevant: true, wasFollowed: false, outcome: 'negative' });
      }
      const graduated = evaluateGraduation(db);
      expect(graduated).not.toContain(insight.id);
    });
  });
});
