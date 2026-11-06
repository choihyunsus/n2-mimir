// ExpeL comparator — find success/failure pairs in the same category
import type { ExperienceEntry, ContrastPair } from '../types.js';

/**
 * Find contrast pairs (success vs failure in same category).
 * This is the core ExpeL mechanism — comparing what went wrong with
 * what went right to extract actionable insights.
 */
export function findContrastPairs(
  experiences: ReadonlyArray<ExperienceEntry>,
): ContrastPair[] {
  const byCategory = new Map<string, { successes: ExperienceEntry[]; failures: ExperienceEntry[] }>();

  for (const exp of experiences) {
    const key = JSON.stringify([exp.project, exp.agent, exp.category]);
    const entry = byCategory.get(key) ?? { successes: [], failures: [] };
    if (exp.type === 'success') entry.successes.push(exp);
    if (exp.type === 'failure' || exp.type === 'correction') entry.failures.push(exp);
    byCategory.set(key, entry);
  }

  const pairs: ContrastPair[] = [];

  for (const { successes, failures } of byCategory.values()) {
    // Pair each failure with the closest success (by time)
    for (const failure of failures) {
      const failTime = new Date(failure.createdAt).getTime();
      let closest: ExperienceEntry | null = null;
      let minDiff = Infinity;

      for (const success of successes) {
        const diff = Math.abs(new Date(success.createdAt).getTime() - failTime);
        if (diff < minDiff) {
          minDiff = diff;
          closest = success;
        }
      }

      if (closest) {
        pairs.push({ failure, success: closest, category: failure.category });
      }
    }
  }

  return pairs;
}
