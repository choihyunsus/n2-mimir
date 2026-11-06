// converter/overlay — overlay generation + token budget tests
import { describe, it, expect } from 'vitest';
import { generateOverlay } from '../src/converter/overlay.js';
import type { Insight } from '../src/types.js';

function makeInsight(overrides: Partial<Insight> = {}): Insight {
  return {
    id: Math.random().toString(36).slice(2),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    agent: 'worker', description: 'test insight description', compressed: 'test compressed',
    tokenCost: 5, category: 'coding', scope: 'project', importance: 3,
    confidence: 0.8, effectScore: 0.5, status: 'active',
    ...overrides,
  };
}

describe('overlay', () => {
  it('should return empty for no insights', () => {
    expect(generateOverlay([])).toBe('');
  });

  it('should generate overlay text', () => {
    const insights = [makeInsight({ compressed: 'use ; not &&' })];
    const result = generateOverlay(insights);
    expect(result).toContain('Mímir');
    expect(result).toContain('use ; not &&');
  });

  it('should respect token budget', () => {
    const insights = Array.from({ length: 50 }, (_, i) =>
      makeInsight({ compressed: `insight number ${i} with some extra text to use tokens` })
    );
    const result = generateOverlay(insights, 50); // Very small budget
    const lines = result.split('\n').filter(Boolean);
    expect(lines.length).toBeLessThan(50); // Should truncate
  });

  it('should use 🔒 prefix for graduated insights', () => {
    const insights = [makeInsight({ status: 'graduated', compressed: 'graduated rule' })];
    const result = generateOverlay(insights);
    expect(result).toContain('🔒');
  });

  it('should use ⚠️ prefix for high importance', () => {
    const insights = [makeInsight({ importance: 5, compressed: 'important thing' })];
    const result = generateOverlay(insights);
    expect(result).toContain('⚠️');
  });

  it('should use 💡 prefix for normal importance', () => {
    const insights = [makeInsight({ importance: 2, compressed: 'normal' })];
    const result = generateOverlay(insights);
    expect(result).toContain('💡');
  });
});
