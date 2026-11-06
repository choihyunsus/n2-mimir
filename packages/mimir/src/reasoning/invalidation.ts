// Evidence invalidation is monotone and idempotent for a previously invalidated atom.
import type { ReasoningStore } from './store.js';

export function invalidateEvidence(store: ReasoningStore, experienceId: string): number {
  return store.connection.transaction(() => {
    store.connection.execute('INSERT OR IGNORE INTO mimir_evidence_invalidations(experience_id) VALUES(?)', [experienceId]);
    const affected = store.connection.query<{ atomId: string; atomType: string; confidence: number; insightId: string | null }>(`
      WITH RECURSIVE affected(atom_id) AS (
        SELECT atom_id FROM mimir_reasoning_atoms WHERE experience_id=?
        UNION SELECT d.child_atom_id FROM mimir_atom_deps d JOIN affected a ON a.atom_id=d.parent_atom_id
      ) SELECT atom_id AS atomId,atom_type AS atomType,confidence,insight_id AS insightId FROM mimir_reasoning_atoms
      WHERE atom_id IN (SELECT atom_id FROM affected) ORDER BY depth,atom_id`, [experienceId]);
    const insights = new Set<string>();
    for (const atom of affected) {
      const parents = store.parentsOf(atom.atomId).map(id => store.getAtom(id)?.confidence ?? 0);
      const next = atom.atomType === 'premise' ? Math.min(atom.confidence, 0.3) : Math.min(atom.confidence, ...parents);
      store.connection.execute('UPDATE mimir_reasoning_atoms SET confidence=?,is_verified=0 WHERE atom_id=?', [next, atom.atomId]);
      if (atom.insightId) insights.add(atom.insightId);
    }
    for (const id of insights) {
      const conclusion = store.latestConclusion(id);
      store.connection.execute(`UPDATE insights SET confidence=MIN(confidence,?),
        status=CASE WHEN status IN ('active','graduated') THEN 'dormant' ELSE status END,
        updated_at=datetime('now') WHERE id=?`, [conclusion?.confidence ?? 0, id]);
    }
    return affected.length;
  });
}
