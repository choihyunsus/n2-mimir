// Time-based weight calculation — architecture.md section 8-1
import type { ExperienceEntry, Insight } from '../types.js';
import { timestampMillis } from './temporal.js';

const DEFAULT_HALF_LIFE = 14; // 14 days

/**
 * Calculate time-weighted score for an experience or insight.
 * Recent items score higher. Uses exponential decay with configurable half-life.
 *
 * formula: score = base * 2^(-daysSince / halfLife)
 */
export function timeWeight(
  createdAt: string,
  baseScore = 1.0,
  halfLife = DEFAULT_HALF_LIFE,
): number {
  if (!Number.isFinite(halfLife) || halfLife <= 0 || !Number.isFinite(baseScore)) throw new Error('Invalid time weight parameters');
  const instant = timestampMillis(createdAt);
  if (!Number.isFinite(instant)) return 0;
  const daysSince = Math.max(0, (Date.now() - instant) / (1000 * 60 * 60 * 24));
  return baseScore * Math.pow(2, -daysSince / halfLife);
}

/** Score an insight considering importance, confidence, and recency */
export function scoreInsight(
  insight: Insight,
  halfLife = DEFAULT_HALF_LIFE,
): number {
  const recency = timeWeight(insight.updatedAt, 1.0, halfLife);
  return insight.importance * insight.confidence * recency * (1 + insight.effectScore);
}

/** Score and sort experiences by relevance + recency */
export function rankExperiences(
  experiences: ReadonlyArray<ExperienceEntry>,
  halfLife = DEFAULT_HALF_LIFE,
): ExperienceEntry[] {
  return [...experiences].sort((a, b) => {
    const scoreA = timeWeight(a.createdAt, severityMultiplier(a.severity), halfLife);
    const scoreB = timeWeight(b.createdAt, severityMultiplier(b.severity), halfLife);
    return scoreB - scoreA;
  });
}

/** Severity multiplier — critical experiences weigh more */
function severityMultiplier(severity: string): number {
  switch (severity) {
    case 'critical': return 4.0;
    case 'error': return 2.0;
    case 'warning': return 1.5;
    default: return 1.0;
  }
}
