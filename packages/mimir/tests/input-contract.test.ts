import { it, expect } from 'vitest';
import { MimirDatabase } from '../src/store/database.js';
import { normalize } from '../src/collector/normalizer.js';

it('uses the same bounded literal FTS contract for punctuation, Unicode, OR and closed databases', () => {
  const db = new MimirDatabase(':memory:');
  const scope = { project: 'demo', agent: 'worker' };
  try {
    const one = db.insertExperience({ ...scope, type: 'pattern', category: 'test', context: '東京',
      action: 'alpha', outcome: 'reported' });
    const two = db.insertExperience({ ...scope, type: 'pattern', category: 'test', context: '서울',
      action: 'beta', outcome: 'reported' });
    expect(db.searchExperiences('alpha OR beta', 10, scope)).toHaveLength(2);
    expect(db.searchExperiences('東京:', 10, scope)[0].experience.id).toBe(one.id);
    expect(db.searchExperiences('"서울"', 10, scope)[0].experience.id).toBe(two.id);
    expect(db.searchExperiences('* ()', 10, scope)).toEqual([]);
    expect(() => db.queryExperiences({ limit: -1 })).toThrow();
    expect(() => db.queryInsights({ limit: Infinity })).toThrow();
    expect(() => db.searchExperiences('a'.repeat(4097))).toThrow();
  } finally { db.close(); }
  expect(() => db.searchExperiences('alpha')).toThrow();
  db.close();
});

it('avoids substring-based success and recognizes explicitly negative outcomes', () => {
  expect(normalize({ action: 'network connection', outcome: 'pending' })).toBeNull();
  expect(normalize({ action: 'Run command', outcome: 'did not work' })?.type).toBe('failure');
  expect(normalize({ action: 'Run command', outcome: 'test passed' })?.type).toBe('success');
});

it('keeps Unicode token estimates and optional owner defaults consistent across engines', () => {
  const db = new MimirDatabase(':memory:');
  try {
    const value = { type: 'success' as const, category: 'test', context: '한글', action: '🙂', outcome: '통과' };
    const observation = db.insertExperience(value);
    expect(observation.agent).toBe('default');
    expect(observation.project).toBe('default');
    expect(observation.tokenCost).toBe(Math.ceil(`${value.context} ${value.action} ${value.outcome} `.length / 4));
    const insight = db.insertInsight({ agent: 'worker', category: 'test', description: '한글 설명입니다', compressed: '' });
    expect(insight.tokenCost).toBe(Math.ceil('한글 설명입니다'.length / 4));
    expect(() => db.insertExperience({ ...value, action: 1 } as never)).toThrow(/string/);
  } finally { db.close(); }
});
