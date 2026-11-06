// Shared Soul storage must keep explicitly scoped recall inside its owner boundary.
import { describe, it, expect } from 'vitest';
import { MimirDatabase } from '../src/store/database.js';
import { recall } from '../src/orchestrator/recall.js';

describe('explicit recall ownership', () => {
  it('filters FTS, tags, project fallback and graduated insights by the requested owner', () => {
    const db = new MimirDatabase(':memory:');
    try {
      for (const [agent, project] of [['alpha', 'one'], ['beta', 'one'], ['alpha', 'two']]) {
        const item = db.insertExperience({ agent, project, type: 'failure', category: 'testing',
          context: 'shared keyword', action: 'test keyword fails', outcome: 'error keyword' });
        db.setTags(item.id, [{ level: 1, tag: 'keyword' }]);
      }
      const foreign = db.insertInsight({ agent: 'beta', category: 'testing',
        description: 'foreign graduated insight', compressed: 'foreign', scope: 'agent' });
      db.graduateInsight(foreign.id, 'overlay', 'test-reference');
      const result = recall(db, 'test keyword', 'one', 'alpha');
      expect(result.experiences.length).toBeGreaterThan(0);
      expect(result.experiences.every(item => item.project === 'one' && item.agent === 'alpha')).toBe(true);
      expect(result.insights.some(item => item.id === foreign.id)).toBe(false);
    } finally { db.close(); }
  });
});
