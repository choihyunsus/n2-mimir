// Overlay converter — generates prompt injection text from insights
// Includes question sequence logic (architecture.md §8-9)
import type { Insight } from '../types.js';
import type { RecallConfidence } from '../orchestrator/recall.js';
import { scoreInsight } from '../analyzer/weight.js';

/**
 * Generate a prompt overlay from relevant insights.
 * This is what gets injected when a topic is mentioned.
 * Uses token budget to prevent context overflow.
 */
export function generateOverlay(insights: ReadonlyArray<Insight>, tokenBudget = 500, halfLife = 14): string {
  return buildOverlay(insights, tokenBudget, halfLife).text;
}

export function buildOverlay(insights: ReadonlyArray<Insight>, tokenBudget: number, halfLife: number): { text: string; selectedIds: string[] } {
  if (!Number.isFinite(tokenBudget) || tokenBudget < 0) throw new RangeError('tokenBudget must be finite and nonnegative');
  const scored = insights.map(insight => ({ insight, score: scoreInsight(insight, halfLife) })).sort((a, b) => b.score - a.score);
  const lines = ['⚡ Mímir Experience Overlay:'];
  const selectedIds: string[] = [];
  for (const { insight } of scored) {
    const text = insight.compressed || insight.description;
    const prefix = insight.status === 'graduated' ? '🔒' : insight.importance >= 4 ? '⚠️' : '💡';
    const line = `${prefix} ${text}`;
    if (estimateTokens([...lines, line].join('\n')) > tokenBudget) continue;
    lines.push(line);
    selectedIds.push(insight.id);
  }
  return { text: selectedIds.length ? lines.join('\n') : '', selectedIds };
}

/**
 * Generate question sequence prefix based on recall confidence (architecture.md §8-9).
 *
 * Describes the retrieved records so the host can compare them with the current request.
 */
export function generateQuestionSequencePrefix(
  confidence: RecallConfidence,
  dominantPattern?: string,
  patternCounts?: ReadonlyArray<{ pattern: string; count: number }>,
): string {
  switch (confidence) {
    case 'none':
      return '⚡ 관련 과거 기록을 찾지 못했습니다.';

    case 'ambiguous': {
      if (!patternCounts || patternCounts.length === 0) {
        return '⚡ 과거 기록에 여러 패턴이 있습니다. 현재 요청과 대조하세요.';
      }
      const summary = patternCounts
        .slice(0, 3) // top 3 only
        .map((p) => `${p.pattern.slice(0, 30)}(${p.count}회)`)
        .join(', ');
      return `⚡ 과거 기록의 패턴: ${summary}. 현재 요청과 대조하세요.`;
    }

    case 'clear': {
      const pattern = dominantPattern?.slice(0, 50) ?? '확인됨';
      return `⚡ 과거 기록에서 많이 나타난 패턴: ${pattern}. 현재 요청과 대조하세요.`;
    }
  }
}

/** Rough token estimation (1 token ≈ 4 chars) */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
