// orchestrator — classifier, recall, assembler tests
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { classify, extractSearchTerms } from '../src/orchestrator/classifier.js';
import { recall } from '../src/orchestrator/recall.js';
import { assemble } from '../src/orchestrator/assembler.js';
import { MimirDatabase } from '../src/store/database.js';
import { existsSync, unlinkSync } from 'fs';

const TEST_DB = './test-orchestrator.db';

describe('classifier', () => {
  it('should classify coding topics', () => {
    const cats = classify('refactor the code module');
    expect(cats).toContain('coding_pattern');
  });

  it('should classify deployment topics', () => {
    const cats = classify('npm publish build');
    expect(cats).toContain('deployment');
  });

  it('should classify Korean topics', () => {
    const cats = classify('코드 리팩터 함수');
    expect(cats).toContain('coding_pattern');
  });

  it('should return general for unknown topics', () => {
    const cats = classify('xyzzy random gibberish');
    expect(cats).toEqual(['general']);
  });

  it('should sort by match count', () => {
    const cats = classify('deploy build publish npm vercel');
    expect(cats[0]).toBe('deployment');
  });
});

describe('extractSearchTerms', () => {
  it('should remove stop words', () => {
    const terms = extractSearchTerms('the build is failing');
    expect(terms).not.toContain('the');
    expect(terms).not.toContain('is');
    expect(terms).toContain('build');
    expect(terms).toContain('failing');
  });

  it('should handle Korean stop words', () => {
    const terms = extractSearchTerms('이것을 빌드 하다');
    expect(terms).not.toContain('이');
    expect(terms).toContain('빌드');
  });

  it('should lowercase and clean', () => {
    const terms = extractSearchTerms('PowerShell TERMINAL');
    expect(terms).toContain('powershell');
    expect(terms).toContain('terminal');
  });
});

describe('recall', () => {
  let db: MimirDatabase;

  beforeEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    db = new MimirDatabase(TEST_DB);
  });

  afterEach(() => {
    db.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  it('should return empty for empty database', () => {
    const result = recall(db, 'anything');
    expect(result.experiences).toHaveLength(0);
    expect(result.insights).toHaveLength(0);
  });

  it('should find experiences via FTS5', () => {
    db.insertExperience({
      agent: 'worker', project: 'test', type: 'failure', category: 'coding',
      context: 'PowerShell scripting', action: 'used && operator', outcome: 'syntax error',
    });
    const result = recall(db, 'PowerShell operator');
    expect(result.ftsResults.length).toBeGreaterThanOrEqual(1);
  });

  it('should find experiences by project filter', () => {
    db.insertExperience({
      agent: 'worker', project: 'demo-project', type: 'success', category: 'coding',
      context: 'test', action: 'test action here', outcome: 'test outcome here',
    });
    const result = recall(db, 'test', 'demo-project');
    expect(result.experiences.length).toBeGreaterThanOrEqual(1);
  });

  it('should include graduated insights', () => {
    const insight = db.insertInsight({ agent: 'a', description: 'd', compressed: 'c', category: 'coding' });
    db.graduateInsight(insight.id, 'ark_rule', 'ref');
    const result = recall(db, 'anything');
    expect(result.insights.some((i) => i.status === 'graduated')).toBe(true);
  });
});

describe('assembler', () => {
  it('should assemble overlay within budget', () => {
    const result = assemble({
      experiences: [],
      tagChain: [],
      insights: [{
        id: '1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        agent: 'a', description: 'test insight', compressed: 'short', tokenCost: 5,
        category: 'c', scope: 'project', importance: 3, confidence: 0.8,
        effectScore: 0.5, status: 'active',
      }],
      ftsResults: [],
      confidence: 'none',
    }, 500);
    expect(result.totalTokens).toBeLessThanOrEqual(500);
    expect(result.insightCount).toBe(1);
  });

  it('should respect token budget limit', () => {
    const bigInsights = Array.from({ length: 20 }, (_, i) => ({
      id: String(i), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      agent: 'a', description: 'x'.repeat(200), compressed: 'y'.repeat(100), tokenCost: 25,
      category: 'c', scope: 'project' as const, importance: 3, confidence: 0.8,
      effectScore: 0.5, status: 'active' as const,
    }));
    const result = assemble({
      experiences: [], tagChain: [], insights: bigInsights, ftsResults: [],
      confidence: 'none',
    }, 100);
    expect(result.totalTokens).toBeLessThanOrEqual(100);
  });
});
