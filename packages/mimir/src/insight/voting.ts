// Insight voting — UPVOTE/DOWNVOTE management
import type { MimirDatabase } from '../store/database.js';
import type { InsightOperation } from '../types.js';

/**
 * Apply insight operations to the database.
 * Handles ADD, UPVOTE, DOWNVOTE operations from insight generation.
 */
export function applyOperations(
  db: MimirDatabase,
  operations: ReadonlyArray<InsightOperation>,
): { applied: number; created: number; skipped: number; errors: Array<{ operationIndex: number; message: string }> } {
  let applied = 0;
  let created = 0;
  let skipped = 0;
  const errors: Array<{ operationIndex: number; message: string }> = [];

  for (const [operationIndex, op] of operations.entries()) {
    try {
      switch (op.op) {
        case 'ADD':
          db.insertInsight(op.insight);
          applied++;
          created++;
          break;
        case 'UPVOTE':
          if (op.sourceIds) {
            if (db.reinforceInsight(op.insightId, op.sourceIds) > 0) applied++;
            else skipped++;
            break;
          }
          db.upvoteInsight(op.insightId);
          applied++;
          break;
        case 'DOWNVOTE':
          db.downvoteInsight(op.insightId);
          applied++;
          break;
      }
    } catch (error) {
      skipped++;
      errors.push({ operationIndex, message: error instanceof Error ? error.message : String(error) });
    }
  }

  return { applied, created, skipped, errors };
}

/**
 * Find duplicate insights by checking category + similar description.
 * Returns the ID of existing insight for UPVOTE instead of ADD.
 */
export function findDuplicateInsight(
  db: MimirDatabase,
  category: string,
  description: string,
  agent?: string,
  project?: string,
  scope?: import('../types.js').InsightScope,
): string | null {
  const existing = db.queryInsights({
    category,
    agent,
    project,
    scope,
    status: 'active',
    limit: 20,
  });

  for (const insight of existing) {
    if (description.trim() && insight.description.trim() === description.trim()) {
      return insight.id;
    }
  }

  return null;
}

/**
 * Deduplicate insight operations — convert ADDs to UPVOTEs when similar exists.
 */
export function deduplicateOperations(
  db: MimirDatabase,
  operations: ReadonlyArray<InsightOperation>,
): InsightOperation[] {
  return operations.map((op) => {
    if (op.op !== 'ADD') return op;

    const existingId = findDuplicateInsight(db, op.insight.category, op.insight.description,
      op.insight.agent, op.insight.project, op.insight.scope);
    if (existingId) {
      return { op: 'UPVOTE', insightId: existingId, sourceIds: op.insight.sourceIds } as const;
    }

    return op;
  });
}
