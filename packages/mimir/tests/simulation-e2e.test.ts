// Simulation 1: E2E Pipeline — Mimir class full flow verification
// addExperience → recall → overlay → digest → stats
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Mimir } from '../src/index.js';
import { existsSync, unlinkSync } from 'fs';

const TEST_DB = './test-sim-e2e.db';

describe('Simulation 1: E2E Pipeline', () => {
  let mimir: Mimir;

  beforeEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    mimir = new Mimir({ dbPath: TEST_DB });
  });

  afterEach(() => {
    mimir.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  it('should complete full lifecycle: add → recall → overlay → digest', async () => {
    // Step 1: Add failure experience (addExperience returns void)
    mimir.addExperience({
      agent: 'worker', project: 'n2-mimir', type: 'failure',
      category: 'coding_pattern', severity: 'error',
      context: 'PowerShell terminal scripting',
      action: 'Used && operator to chain commands',
      outcome: 'Syntax error: && is not supported in PowerShell',
      correction: 'Use semicolon (;) instead of && in PowerShell',
    });

    // Step 2: Add success experience (same category)
    mimir.addExperience({
      agent: 'worker', project: 'n2-mimir', type: 'success',
      category: 'coding_pattern', severity: 'info',
      context: 'PowerShell terminal scripting',
      action: 'Used semicolon to chain commands',
      outcome: 'Commands executed successfully in PowerShell',
    });

    // Verify both were stored
    const stats1 = mimir.getStats();
    expect(stats1.experiences).toBe(2);

    // Step 3: Recall by topic
    const recallResult = mimir.recall('PowerShell operator');
    expect(recallResult).toBeDefined();
    // Should find experiences via FTS5 or project query
    const totalFound = recallResult.experiences.length + recallResult.ftsResults.length;
    expect(totalFound).toBeGreaterThanOrEqual(1);

    // Step 4: Generate overlay
    const overlayResult = mimir.overlay('PowerShell', 'n2-mimir', 'worker');
    expect(overlayResult).toBeDefined();
    expect(overlayResult.totalTokens).toBeGreaterThanOrEqual(0);

    // Step 5: Digest (analyze patterns + generate insights)
    const digestResult = await mimir.digest({ project: 'n2-mimir', agent: 'worker' });
    expect(digestResult).toBeDefined();
    // With success+failure pair, should find contrast pairs
    expect(digestResult.contrasts).toBeGreaterThanOrEqual(1);

    // Step 6: Verify stats
    const stats2 = mimir.getStats();
    expect(stats2.experiences).toBe(2);
  });

  it('should handle delta learning (upsert)', () => {
    // First insert
    const result1 = mimir.deltaLearn({
      agent: 'worker', project: 'test', type: 'pattern',
      category: 'workflow', context: 'test',
      action: 'Always run typecheck before build',
      outcome: 'Catches errors early',
    });
    expect(result1.isNew).toBe(true);

    // Second insert with same action — should upsert
    const result2 = mimir.deltaLearn({
      agent: 'worker', project: 'test', type: 'pattern',
      category: 'workflow', context: 'test',
      action: 'Always run typecheck before build',
      outcome: 'Catches errors early',
    });
    expect(result2.isNew).toBe(false);
    expect(result2.id).toBe(result1.id);

    // Stats should show only 1 experience (upserted)
    const stats = mimir.getStats();
    expect(stats.experiences).toBe(1);
  });

  it('should handle multiple projects independently', () => {
    mimir.addExperience({
      agent: 'worker', project: 'projectA', type: 'success',
      category: 'coding_pattern', context: 'A ctx',
      action: 'action in project A', outcome: 'result in A',
    });
    mimir.addExperience({
      agent: 'worker', project: 'projectB', type: 'failure',
      category: 'coding_pattern', context: 'B ctx',
      action: 'action in project B', outcome: 'result in B',
    });

    // Verify both stored
    expect(mimir.getStats().experiences).toBe(2);

    // Project-filtered query should isolate
    const expA = mimir.queryExperiences({ project: 'projectA' });
    const expB = mimir.queryExperiences({ project: 'projectB' });
    expect(expA).toHaveLength(1);
    expect(expB).toHaveLength(1);
    expect(expA[0].project).toBe('projectA');
    expect(expB[0].project).toBe('projectB');
  });
});
