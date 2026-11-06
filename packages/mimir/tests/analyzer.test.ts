// analyzer — comparator (contrast pairs) + detector (patterns) + weight tests
import { describe, it, expect } from 'vitest';
import { findContrastPairs } from '../src/analyzer/comparator.js';
import { detectRepeatedPatterns } from '../src/analyzer/detector.js';
import { timeWeight, scoreInsight, rankExperiences } from '../src/analyzer/weight.js';
import type { ExperienceEntry, Insight } from '../src/types.js';

function makeExp(overrides: Partial<ExperienceEntry>): ExperienceEntry {
  return {
    id: Math.random().toString(36).slice(2),
    timestamp: new Date().toISOString(),
    sessionId: 's1',
    agent: 'worker',
    project: 'test',
    type: 'success',
    category: 'coding_pattern',
    severity: 'info',
    context: 'test context',
    action: 'test action',
    outcome: 'test outcome',
    frequency: 1,
    tokenCost: 10,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('comparator', () => {
  it('should find contrast pairs in same category', () => {
    const exps = [
      makeExp({ type: 'failure', category: 'coding', action: 'used &&', outcome: 'error' }),
      makeExp({ type: 'success', category: 'coding', action: 'used ;', outcome: 'worked' }),
    ];
    const pairs = findContrastPairs(exps);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].failure.action).toBe('used &&');
    expect(pairs[0].success.action).toBe('used ;');
  });

  it('should not pair across different categories', () => {
    const exps = [
      makeExp({ type: 'failure', category: 'coding', action: 'x', outcome: 'fail' }),
      makeExp({ type: 'success', category: 'deployment', action: 'y', outcome: 'ok' }),
    ];
    const pairs = findContrastPairs(exps);
    expect(pairs).toHaveLength(0);
  });

  it('should include corrections as failures', () => {
    const exps = [
      makeExp({ type: 'correction', category: 'path', action: 'wrong path', outcome: 'fixed', correction: 'use right path' }),
      makeExp({ type: 'success', category: 'path', action: 'right path', outcome: 'worked' }),
    ];
    const pairs = findContrastPairs(exps);
    expect(pairs).toHaveLength(1);
  });

  it('should return empty for no failures', () => {
    const exps = [
      makeExp({ type: 'success', category: 'c', action: 'a', outcome: 'b' }),
      makeExp({ type: 'success', category: 'c', action: 'c', outcome: 'd' }),
    ];
    expect(findContrastPairs(exps)).toHaveLength(0);
  });
});

describe('detector', () => {
  it('should detect repeated failure patterns', () => {
    const exps = [
      makeExp({ type: 'failure', category: 'path', action: 'access deploy folder' }),
      makeExp({ type: 'failure', category: 'path', action: 'access deploy folder' }),
      makeExp({ type: 'failure', category: 'path', action: 'access deploy folder' }),
    ];
    const patterns = detectRepeatedPatterns(exps);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].count).toBe(3);
  });

  it('should respect minCount', () => {
    const exps = [
      makeExp({ type: 'failure', category: 'c', action: 'same action' }),
    ];
    expect(detectRepeatedPatterns(exps, 2)).toHaveLength(0);
  });

  it('should group by category + action', () => {
    const exps = [
      makeExp({ type: 'failure', category: 'a', action: 'act1' }),
      makeExp({ type: 'failure', category: 'a', action: 'act1' }),
      makeExp({ type: 'failure', category: 'b', action: 'act1' }),
      makeExp({ type: 'failure', category: 'b', action: 'act1' }),
    ];
    const patterns = detectRepeatedPatterns(exps);
    expect(patterns).toHaveLength(2);
  });

  it('should sort by count descending', () => {
    const exps = [
      makeExp({ type: 'failure', category: 'a', action: 'few' }),
      makeExp({ type: 'failure', category: 'a', action: 'few' }),
      makeExp({ type: 'correction', category: 'b', action: 'many' }),
      makeExp({ type: 'correction', category: 'b', action: 'many' }),
      makeExp({ type: 'correction', category: 'b', action: 'many' }),
    ];
    const patterns = detectRepeatedPatterns(exps);
    expect(patterns[0].count).toBe(3);
  });
});

describe('weight', () => {
  it('should return ~1.0 for just-created item', () => {
    const w = timeWeight(new Date().toISOString());
    expect(w).toBeGreaterThan(0.95);
  });

  it('should decay over time', () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const w = timeWeight(twoWeeksAgo, 1.0, 14);
    expect(w).toBeCloseTo(0.5, 1);
  });

  it('should apply base score multiplier', () => {
    const w = timeWeight(new Date().toISOString(), 4.0);
    expect(w).toBeGreaterThan(3.8);
  });

  it('should score insight considering importance and confidence', () => {
    const insight: Insight = {
      id: 'x', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      agent: 'a', description: 'd', compressed: 'c', tokenCost: 5, category: 'c',
      scope: 'project', importance: 5, confidence: 0.8, effectScore: 0.5, status: 'active',
    };
    const score = scoreInsight(insight);
    expect(score).toBeGreaterThan(0);
  });

  it('should rank experiences with critical higher', () => {
    const exps = [
      makeExp({ severity: 'info', createdAt: new Date().toISOString() }),
      makeExp({ severity: 'critical', createdAt: new Date().toISOString() }),
    ];
    const ranked = rankExperiences(exps);
    expect(ranked[0].severity).toBe('critical');
  });
});
