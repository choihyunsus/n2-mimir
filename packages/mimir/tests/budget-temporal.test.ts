import { it, expect } from 'vitest';
import { assemble } from '../src/orchestrator/assembler.js';
import { buildOverlay } from '../src/converter/overlay.js';
import { freshnessWeight } from '../src/analyzer/temporal.js';
import { timeWeight } from '../src/analyzer/weight.js';
import { MimirDatabase } from '../src/store/database.js';
import type { Insight } from '../src/types.js';

it('keeps tiny overlay budgets and selected IDs consistent with rendered items', () => {
  const insight: Insight = { id: 'one', agent: 'worker', createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z', category: 'test', description: 'A historical observation',
    compressed: 'Observation', confidence: 0.7, importance: 2, effectScore: 0.5,
    tokenCost: 1, status: 'active', scope: 'agent' };
  for (const budget of [0, 1, 10, 30, 50, 100]) {
    const result = assemble({ confidence: 'clear', dominantPattern: 'Observed action',
      experiences: [], insights: [insight], tagChain: [], ftsResults: [] }, budget);
    expect(result.totalTokens).toBe(Math.ceil(result.overlay.length / 4));
    expect(result.totalTokens).toBeLessThanOrEqual(budget);
    expect(result.selectedIds.includes('one')).toBe(result.overlay.includes('Observation'));
  }
  expect(buildOverlay([insight], 0, 14)).toEqual({ text: '', selectedIds: [] });
  expect(() => buildOverlay([], NaN, 14)).toThrow();
});

it('uses UTC SQLite dates, clamps future dates and ranks categories before query limits', () => {
  const now = Date.parse('2026-01-11T00:00:00Z');
  expect(freshnessWeight('2026-01-01 00:00:00', 'general', now)).toBeCloseTo(1 / 1.1);
  expect(freshnessWeight('bad-date', 'general', now)).toBe(0);
  expect(freshnessWeight('2027-01-01T00:00:00Z', 'general', now)).toBe(1);
  expect(freshnessWeight('2026-01-01T00:00:00Z', 'architecture', now))
    .toBeGreaterThan(freshnessWeight('2026-01-01T00:00:00Z', 'library_api', now));
  expect(timeWeight('bad-date')).toBe(0);
  expect(() => timeWeight('2026-01-01T00:00:00Z', 1, 0)).toThrow();
  const db = new MimirDatabase(':memory:');
  try {
    const scope = { project: 'demo', agent: 'worker' };
    const older = db.insertExperience({ ...scope, type: 'success', category: 'library_api', context: 'old', action: 'old', outcome: 'old' });
    const fresh = db.insertExperience({ ...scope, type: 'success', category: 'library_api', context: 'new', action: 'new', outcome: 'new' });
    db.reasoning.connection.execute("UPDATE experiences SET created_at='2020-01-01T00:00:00Z' WHERE id=?", [older.id]);
    expect(db.maintenance.freshExperiences(scope, 'library_api', 1)[0].experience.id).toBe(fresh.id);
    expect(db.maintenance.browseInsights({ ...scope, query: '***' }).total).toBe(0);
  } finally { db.close(); }
});
