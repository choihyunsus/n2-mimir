// Effect scorer — track whether injected insights actually improved behavior
import type { MimirDatabase } from '../store/database.js';
import type { EffectMeasurement, MemoryScope } from '../types.js';

/**
 * Record that an insight was used in a session and measure its effect.
 * This feeds back into the voting system — effective insights get upvoted,
 * ineffective ones get downvoted.
 */
export function trackEffect(
  db: MimirDatabase,
  measurement: EffectMeasurement,
): void {
  db.recordEffect(measurement, true);
}

/**
 * Batch evaluate all active insights for graduation eligibility.
 * Called after digest to check if any insights should be graduated.
 */
export function evaluateGraduation(db: MimirDatabase, scope: MemoryScope = {}): string[] {
  const candidates = db.queryInsights({
    ...scope,
    status: 'active',
    minImportance: 5,
    limit: 50,
  });

  const graduatedIds: string[] = [];

  for (const insight of candidates) {
    if (insight.effectScore >= 0.8 && db.reasoning.latestConclusion(insight.id)?.isVerified !== false) {
      // Mark as graduated — converter will pick it up
      db.graduateInsight(insight.id, 'pending', '');
      graduatedIds.push(insight.id);
    }
  }

  return graduatedIds;
}
