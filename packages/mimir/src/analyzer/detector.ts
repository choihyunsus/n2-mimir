// Repeated pattern detector — find actions that keep failing
import type { ExperienceEntry, RepeatedPattern } from '../types.js';

/**
 * Detect repeated failure patterns.
 * When the same action keeps failing in the same category,
 * that's a strong signal for insight generation.
 */
export function detectRepeatedPatterns(
  experiences: ReadonlyArray<ExperienceEntry>,
  minCount = 2,
): RepeatedPattern[] {
  // Group failures by category + action (normalized)
  const groups = new Map<string, ExperienceEntry[]>();

  for (const exp of experiences) {
    if (exp.type !== 'failure' && exp.type !== 'correction') continue;
    const key = JSON.stringify([exp.project, exp.agent, exp.category, normalizeAction(exp.action)]);
    const group = groups.get(key) ?? [];
    group.push(exp);
    groups.set(key, group);
  }

  const patterns: RepeatedPattern[] = [];

  for (const exps of groups.values()) {
    if (exps.length >= minCount) {
      patterns.push({
        category: exps[0].category,
        action: exps[0].action,
        count: exps.length,
        experiences: exps,
      });
    }
  }

  // Sort by count descending — most repeated first
  return patterns.sort((a, b) => b.count - a.count);
}

/** Normalize action text for comparison (lowercase, trim, collapse spaces) */
function normalizeAction(action: string): string {
  return action.toLowerCase().trim().replace(/\s+/g, ' ').slice(0, 100);
}
