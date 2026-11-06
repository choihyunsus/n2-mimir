// Validate dynamic callers consistently before selecting either SQLite backend.
import type { ExperienceInput, InsightInput } from '../types.js';
import { scopeParams } from './scope.js';

export function experienceInput(input: ExperienceInput): ExperienceInput & { agent: string; project: string } {
  const value = { ...input, agent: input.agent ?? 'default', project: input.project ?? 'default' };
  scopeParams(value);
  for (const key of ['category', 'context', 'action', 'outcome'] as const) {
    if (typeof value[key] !== 'string') throw new TypeError(`Experience ${key} must be a string`);
  }
  for (const key of ['correction', 'sourceRef', 'sessionId'] as const) {
    if (value[key] != null && typeof value[key] !== 'string') throw new TypeError(`Experience ${key} must be a string`);
  }
  if (!['success', 'failure', 'correction', 'pattern'].includes(value.type)) throw new TypeError('Invalid experience type');
  if (!['info', 'warning', 'error', 'critical'].includes(value.severity ?? 'info')) throw new TypeError('Invalid experience severity');
  return value;
}

export function validateInsightInput(input: InsightInput): void {
  scopeParams(input);
  if (typeof input.agent !== 'string' || !input.agent.trim()) throw new TypeError('Insight agent is required');
  for (const key of ['description', 'compressed', 'category'] as const) {
    if (typeof input[key] !== 'string') throw new TypeError(`Insight ${key} must be a string`);
  }
  if (!['project', 'agent', 'global'].includes(input.scope ?? 'project')) throw new TypeError('Invalid insight scope');
  if (input.tokenCost != null && (!Number.isSafeInteger(input.tokenCost) || input.tokenCost < 0)) {
    throw new TypeError('Insight token cost must be a nonnegative integer');
  }
}
