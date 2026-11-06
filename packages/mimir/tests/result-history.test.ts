// Preserve distinct observations and calculate effect scores over the intended window.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { FallbackStore } from '../src/store/database-fallback.js';

describe('experience and evaluation history', () => {
  it('keeps failure and success for the same action as separate observations', () => {
    const connection = new Database(':memory:');
    const store = new FallbackStore(connection);
    try {
      const common = { agent: 'alpha', project: 'one', category: 'testing', context: 'same context', action: 'run tests' };
      const failure = store.upsertExperience({ ...common, type: 'failure', outcome: 'failed' });
      const success = store.upsertExperience({ ...common, type: 'success', outcome: 'passed' });
      expect(success.isNew).toBe(true);
      expect(success.id).not.toBe(failure.id);
      const repeated = store.upsertExperience({ ...common, type: 'failure', outcome: 'failed' });
      expect(repeated.id).toBe(failure.id);
      expect(store.getExperience(failure.id)?.frequency).toBe(2);
      expect(store.getExperience(success.id)?.outcome).toBe('passed');
    } finally { connection.close(); }
  });

  it('uses the ten latest effects with deterministic ties', () => {
    const connection = new Database(':memory:');
    const store = new FallbackStore(connection);
    try {
      const insight = store.insertInsight({ agent: 'alpha', category: 'testing', description: 'lesson', compressed: 'lesson' });
      for (let index = 0; index < 20; index += 1) {
        store.recordEffect({ insightId: insight.id, sessionId: `session-${index}`,
          wasRelevant: true, wasFollowed: true, outcome: index < 10 ? 'negative' : 'positive' });
      }
      expect(store.getInsight(insight.id)?.effectScore).toBe(1);
    } finally { connection.close(); }
  });
});
