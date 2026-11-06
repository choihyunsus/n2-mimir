// Insight generator — LLM-based insight extraction from experience patterns
import type { ContrastPair, RepeatedPattern, InsightOperation, InsightInput } from '../types.js';

/**
 * Generate insight operations from contrast pairs (ExpeL method).
 * If LLM is not available, falls back to template-based generation.
 */
export function generateFromContrasts(
  pairs: ReadonlyArray<ContrastPair>,
): InsightOperation[] {
  const operations: InsightOperation[] = [];

  for (const pair of pairs) {
    if (pair.failure.agent !== pair.success.agent || pair.failure.project !== pair.success.project) continue;
    const description = [
      `[${pair.category}] `,
      `실패: ${truncate(pair.failure.action, 80)} → ${truncate(pair.failure.outcome, 80)}`,
      pair.failure.correction ? ` | 교정: ${truncate(pair.failure.correction, 80)}` : '',
      ` | 성공: ${truncate(pair.success.action, 80)} → ${truncate(pair.success.outcome, 80)}`,
    ].join('');

    const compressed = pair.failure.correction
      ? `${pair.category}: ${truncate(pair.failure.correction, 120)}`
      : `${pair.category}: ${truncate(pair.success.action, 60)} (not ${truncate(pair.failure.action, 60)})`;

    const insight: InsightInput = {
      agent: pair.failure.agent,
      project: pair.failure.project,
      sourceIds: [pair.failure.id, pair.success.id],
      description,
      compressed,
      category: pair.category,
      scope: 'project',
    };

    operations.push({ op: 'ADD', insight });
  }

  return operations;
}

/**
 * Generate insight operations from repeated patterns.
 * Repeated failures = strong signal, higher importance.
 */
export function generateFromPatterns(
  patterns: ReadonlyArray<RepeatedPattern>,
): InsightOperation[] {
  const operations: InsightOperation[] = [];

  for (const pattern of patterns) {
    const latest = pattern.experiences[0];
    if (pattern.experiences.some(item => item.agent !== latest.agent || item.project !== latest.project)) continue;
    const description = `[${pattern.category}] 반복 실패 (${pattern.count}회): ${truncate(pattern.action, 100)}`;
    const compressed = `⚠️ ${pattern.category}: "${truncate(pattern.action, 80)}" — ${pattern.count}회 반복 실패`;

    const insight: InsightInput = {
      agent: latest.agent,
      project: latest.project,
      sourceIds: [...new Set(pattern.experiences.map(item => item.id))],
      description,
      compressed,
      category: pattern.category,
      scope: 'project',
    };

    operations.push({ op: 'ADD', insight });
  }

  return operations;
}

/** Truncate text without breaking words */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const truncated = text.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > maxLen * 0.5 ? truncated.slice(0, lastSpace) : truncated) + '...';
}
