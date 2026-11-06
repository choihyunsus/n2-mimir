import { it, expect } from 'vitest';
import { MimirDatabase } from '../src/store/database.js';
import { evaluateGraduation } from '../src/tracker/scorer.js';

function evidence(db: MimirDatabase, type: 'success' | 'failure', agent = 'worker', project = 'demo') {
  return db.insertExperience({ agent, project, type, category: 'test', context: 'Synthetic case',
    action: `Run ${type} test`, outcome: type, sourceRef: `${type}-${Math.random()}` });
}

it('builds a complete ordered chain, replays it and propagates invalidation durably', () => {
  const db = new MimirDatabase(':memory:');
  try {
    const bad = evidence(db, 'failure');
    const good = evidence(db, 'success');
    const insight = db.insertInsight({ agent: 'worker', project: 'demo', category: 'test',
      description: 'Compare the failed and successful runs', compressed: 'Check test results', sourceIds: [bad.id, good.id] });
    const chain = db.reasoning.traceInsight(insight.id);
    expect(chain).toHaveLength(6);
    expect(chain[0]).toMatchObject({ atomType: 'conclusion', isVerified: true });
    expect(new Set(chain.map(atom => atom.atomType)).size).toBe(5);
    expect(db.reasoning.buildInsightChain(insight.id)?.atomId).toBe(chain[0].atomId);
    expect(db.reasoning.invalidateEvidence(bad.id)).toBe(5);
    const confidence = db.getInsight(insight.id)!.confidence;
    expect(confidence).toBeLessThanOrEqual(0.3);
    db.reasoning.invalidateEvidence(bad.id);
    expect(db.getInsight(insight.id)!.confidence).toBe(confidence);
    expect(db.getInsight(insight.id)!.status).toBe('dormant');
    const extra = evidence(db, 'success');
    db.reinforceInsight(insight.id, [extra.id]);
    expect(db.reasoning.latestConclusion(insight.id)?.isVerified).toBe(false);
  } finally { db.close(); }
});

it('rolls back insight, evidence links and partial atoms when chain construction fails', () => {
  const db = new MimirDatabase(':memory:');
  try {
    const source = evidence(db, 'success');
    db.reasoning.connection.execute(`CREATE TRIGGER fail_chain BEFORE INSERT ON mimir_reasoning_atoms
      WHEN new.atom_type='hypothesis' BEGIN SELECT RAISE(ABORT,'injected chain failure'); END`);
    expect(() => db.insertInsight({ agent: 'worker', project: 'demo', category: 'test',
      description: 'A reported test result', compressed: 'Check results', sourceIds: [source.id] })).toThrow(/injected chain failure/);
    expect(db.getStats().insights).toBe(0);
    expect(db.reasoning.connection.query('SELECT * FROM mimir_reasoning_atoms')).toEqual([]);
    expect(db.reasoning.connection.query('SELECT * FROM experience_insight_links')).toEqual([]);
  } finally { db.close(); }
});

it('rejects cross-owner edges and cycles before mutation', () => {
  const db = new MimirDatabase(':memory:');
  try {
    const first = db.insertInsight({ agent: 'one', category: 'test', description: 'One', compressed: 'One' });
    const second = db.insertInsight({ agent: 'two', category: 'test', description: 'Two', compressed: 'Two' });
    db.reasoning.recordAtom({ atomId: 'a', atomType: 'reasoning', agent: 'one', insightId: first.id, content: 'Reasoning' });
    expect(() => db.reasoning.recordAtom({ atomId: 'b', atomType: 'hypothesis', agent: 'two', insightId: second.id, content: 'Hypothesis' }, ['a'])).toThrow(/scope/);
    expect(() => db.reasoning.recordAtom({ atomId: 'c', atomType: 'premise', agent: 'one', insightId: first.id, content: 'Premise' }, ['a'])).toThrow(/order/);
    expect(db.reasoning.getAtom('b')).toBeUndefined();
    expect(db.reasoning.getAtom('c')).toBeUndefined();
  } finally { db.close(); }
});

it('keeps failed evidence checks out of automatic graduation', () => {
  const db = new MimirDatabase(':memory:');
  try {
    const source = evidence(db, 'failure');
    const insight = db.insertInsight({ agent: 'worker', project: 'demo', category: 'test',
      description: 'Single reported failure', compressed: 'Needs evidence', sourceIds: [source.id] });
    for (let index = 0; index < 5; index++) {
      db.recordEffect({ insightId: insight.id, sessionId: String(index), wasRelevant: true,
        wasFollowed: true, outcome: 'positive' }, true);
    }
    expect(db.reasoning.latestConclusion(insight.id)?.isVerified).toBe(false);
    expect(evaluateGraduation(db, { agent: 'worker', project: 'demo' })).toEqual([]);
  } finally { db.close(); }
});
