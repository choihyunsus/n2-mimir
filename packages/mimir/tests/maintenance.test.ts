import { it, expect } from 'vitest';
import { MimirDatabase } from '../src/store/database.js';

const scope = { project: 'demo', agent: 'worker' };
function source(db: MimirDatabase, project = scope.project) {
  return db.insertExperience({ agent: scope.agent, project, type: 'success', category: 'test',
    context: JSON.stringify({ details: '\n한글'.repeat(200) }), action: 'Store test data', outcome: 'success' });
}

it('merges exact scoped advice while preserving source records and conflicting advice', () => {
  const db = new MimirDatabase(':memory:');
  try {
    const first = source(db);
    const second = source(db);
    const other = source(db, 'other');
    const input = { ...scope, category: 'test', description: 'Always verify before publishing', compressed: 'Verify output' };
    const one = db.insertInsight({ ...input, sourceIds: [first.id] });
    const two = db.insertInsight({ ...input, sourceIds: [second.id] });
    const foreign = db.insertInsight({ ...input, project: 'other', sourceIds: [other.id] });
    const contrary = db.insertInsight({ ...input, description: 'Never verify before publishing', sourceIds: [first.id] });
    const retired = db.maintenance.mergeDuplicates(scope, 'test');
    expect(retired).toHaveLength(1);
    const keeper = retired[0] === one.id ? two.id : one.id;
    expect(db.getInsight(retired[0])!.status).toBe('retired');
    expect(db.getInsight(foreign.id)!.status).toBe('active');
    expect(db.getInsight(contrary.id)!.status).toBe('active');
    expect(db.reasoning.latestConclusion(keeper)?.isVerified).toBe(true);
    expect(db.getStats().experiences).toBe(3);
    expect(db.maintenance.mergeDuplicates(scope, 'test')).toEqual([]);
  } finally { db.close(); }
});

it('browses matching scoped records and computes totals before pagination', () => {
  const db = new MimirDatabase(':memory:');
  try {
    const evidence = source(db);
    for (let index = 0; index < 5; index++) db.insertInsight({ ...scope,
      category: 'test', description: `Matching item ${index}`, compressed: `Item ${index}`, sourceIds: [evidence.id] });
    db.insertInsight({ agent: 'foreign', scope: 'global', category: 'test', description: 'Matching foreign item', compressed: 'foreign' });
    const result = db.maintenance.browseInsights({ ...scope, query: 'Matching', limit: 2, offset: 2 });
    expect(result.results).toHaveLength(2);
    expect(result.total).toBe(5);
    expect(result.byStatus).toEqual({ active: 5 });
    expect(result.results.every(insight => insight.agent === scope.agent)).toBe(true);
  } finally { db.close(); }
});

it('creates bounded valid JSON previews and retains every original byte', () => {
  const db = new MimirDatabase(':memory:');
  try {
    const evidence = source(db);
    db.insertInsight({ ...scope, category: 'test', description: 'Old observation', compressed: 'Old', sourceIds: [evidence.id] });
    db.reasoning.connection.execute("UPDATE experiences SET created_at='2020-01-01T00:00:00Z' WHERE id=?", [evidence.id]);
    expect(db.maintenance.archiveExperiences(scope)).toBe(1);
    expect(db.maintenance.archiveExperiences(scope)).toBe(0);
    const preview = db.reasoning.connection.query<{ context: string }>('SELECT context FROM mimir_experience_previews WHERE experience_id=?', [evidence.id])[0];
    expect(Buffer.byteLength(preview.context)).toBeLessThanOrEqual(300);
    expect(JSON.parse(preview.context)._archived).toBe(true);
    expect(db.getExperience(evidence.id)!.context).toBe(evidence.context);
  } finally { db.close(); }
});
