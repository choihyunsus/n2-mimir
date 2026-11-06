// Scope predicates are applied before query limits, using bound values exclusively.
import type { MemoryScope } from '../types.js';

export function requireScope(scope: MemoryScope): asserts scope is Required<MemoryScope> {
  scopeParams(scope);
  if (scope.agent === undefined || scope.project === undefined) throw new Error('Explicit project and agent are required');
}

export const EXPERIENCE_SCOPE_SQL = '(? IS NULL OR e.project = ?) AND (? IS NULL OR e.agent = ?)';

export function scopeParams(scope: MemoryScope = {}): Array<string | null> {
  for (const value of [scope.project, scope.agent]) {
    if (value !== undefined && (typeof value !== 'string' || !value.trim())) {
      throw new TypeError('Scope identifiers must be nonempty strings');
    }
  }
  return [scope.project ?? null, scope.project ?? null, scope.agent ?? null, scope.agent ?? null];
}
