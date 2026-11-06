// Assemble complete memory items within the documented character-based token estimate.
import type { AssemblyResult } from '../types.js';
import type { RecallResultWithConfidence } from './recall.js';
import { buildOverlay, generateQuestionSequencePrefix } from '../converter/overlay.js';

export function assemble(result: RecallResultWithConfidence, tokenBudget = 500, halfLife = 14): AssemblyResult {
  if (!Number.isFinite(tokenBudget) || tokenBudget < 0) throw new RangeError('tokenBudget must be finite and nonnegative');
  const prefix = generateQuestionSequencePrefix(result.confidence, result.dominantPattern, result.patternCounts);
  const prefixCost = Math.ceil(prefix.length / 4);
  if (prefixCost > tokenBudget) return { overlay: '', totalTokens: 0, insightCount: 0, selectedIds: [] };
  const remaining = Math.max(0, Math.floor(tokenBudget - prefixCost - 1));
  const insightBudget = Math.floor(remaining * 0.7);
  const insight = buildOverlay(result.insights, insightBudget, halfLife);
  const initial = [prefix, insight.text].filter(Boolean).join('\n');
  const experiences: string[] = [];
  let overlay = initial;
  for (const experience of result.experiences.slice(0, 5)) {
    const line = `• [${experience.type}] ${experience.action.slice(0, 60)} → ${experience.outcome.slice(0, 60)}`;
    const section = `📋 관련 경험:\n${[...experiences, line].join('\n')}`;
    const candidate = `${initial}\n${section}`;
    if (Math.ceil(section.length / 4) > remaining - insightBudget || Math.ceil(candidate.length / 4) > tokenBudget) continue;
    experiences.push(line);
    overlay = candidate;
  }
  return { overlay, totalTokens: Math.ceil(overlay.length / 4), insightCount: insight.selectedIds.length, selectedIds: insight.selectedIds };
}
