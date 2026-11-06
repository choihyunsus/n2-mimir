// Insight store — insight lifecycle management
import type { MimirDatabase } from '../store/database.js';
import type { Insight, InsightFilter, MemoryScope } from '../types.js';

/** Graduation threshold */
const GRADUATION_IMPORTANCE = 5;
const GRADUATION_EFFECT_SCORE = 0.8;

/**
 * Check and graduate eligible insights.
 * Graduated insights have been repeatedly validated and should be
 * converted to enforced rules (Ark/Clotho).
 */
export function checkGraduation(db: MimirDatabase, scope: MemoryScope = {}): Insight[] {
  const candidates = db.queryInsights({
    ...scope,
    status: 'active',
    minImportance: GRADUATION_IMPORTANCE,
  });

  const graduated: Insight[] = [];

  for (const insight of candidates) {
    if (insight.effectScore >= GRADUATION_EFFECT_SCORE && db.reasoning.latestConclusion(insight.id)?.isVerified !== false) {
      graduated.push(insight);
    }
  }

  return graduated;
}

/** Get active insights for a given filter */
export function getActiveInsights(db: MimirDatabase, filter: InsightFilter): Insight[] {
  return db.queryInsights({ ...filter, status: 'active' });
}

/** Get graduated insights (ready for rule conversion) */
export function getGraduatedInsights(db: MimirDatabase): Insight[] {
  return db.queryInsights({ status: 'graduated' });
}

/**
 * Retire dormant insights — cleanup for edge cases where DB auto-retirement missed.
 * Note: downvoteInsight() SQL already sets status='retired' when importance <= 1.
 * This function handles any inconsistent state (e.g. importance=0 but still 'active').
 */
export function retireDormantInsights(db: MimirDatabase, scope: MemoryScope = {}): number {
  const candidates = db.queryInsights({ ...scope, status: 'active', limit: 100 });
  let retired = 0;

  for (const insight of candidates) {
    if (insight.importance <= 1) {
      // Force retirement for inconsistent state (should already be retired by DB)
      db.downvoteInsight(insight.id);
      retired++;
    }
  }

  return retired;
}
