// Atomic P-R-H-V-C chains retain evidence IDs and replay deterministically.
import { createHash } from 'node:crypto';
import type { ReasoningStore, ReasoningAtom } from './store.js';

interface Source { id: string; agent: string; project: string; type: string; context: string; action: string; outcome: string; relation: string }
interface InsightRow { id: string; agent: string; description: string; compressed: string; category: string }
export interface VerificationOutcome { verificationAtomId: string; verified: boolean; confidence: number; premiseCount: number }

export function buildInsightChain(store: ReasoningStore, insightId: string): ReasoningAtom | undefined {
  return store.connection.transaction(() => {
    const insight = store.connection.query<InsightRow>('SELECT id,agent,description,compressed,category FROM insights WHERE id=?', [insightId])[0];
    if (!insight) throw new Error('Insight not found');
    const sources = store.connection.query<Source>(`SELECT e.id,e.agent,e.project,e.type,e.context,e.action,e.outcome,l.relation
      FROM experiences e JOIN experience_insight_links l ON l.experience_id=e.id
      WHERE l.insight_id=? ORDER BY e.id`, [insightId]);
    if (!sources.length) return undefined;
    if (sources.length > 100 || sources.some(source => source.agent !== insight.agent) ||
        new Set(sources.map(source => source.project)).size !== 1) throw new Error('Invalid reasoning evidence scope');
    const fingerprint = createHash('sha256').update(JSON.stringify([insight, sources])).digest('hex');
    const prefix = `${insightId}:${fingerprint}`;
    const previous = store.getAtom(`${prefix}:c`);
    if (previous) return previous;
    const base = { insightId, agent: insight.agent };
    const premises = sources.map(source => store.recordOnConnection({ ...base,
      atomId: `${prefix}:p:${source.id}`, atomType: 'premise', experienceId: source.id,
      content: `${source.action}\n${source.outcome}`, confidence: isInvalidated(store, source.id) ? 0.3 : 0.7 }, []).atomId);
    const reasoning = store.recordOnConnection({ ...base, atomId: `${prefix}:r`, atomType: 'reasoning',
      content: insight.description, confidence: 0.7 }, premises);
    const hypothesis = store.recordOnConnection({ ...base, atomId: `${prefix}:h`, atomType: 'hypothesis',
      content: insight.compressed || insight.description, confidence: 0.7 }, [reasoning.atomId]);
    const outcome = verifyOnConnection(store, hypothesis.atomId, sources[0].project);
    const conclusion = store.recordOnConnection({ ...base, atomId: `${prefix}:c`, atomType: 'conclusion',
      content: insight.compressed || insight.description, isVerified: outcome.verified,
      confidence: outcome.confidence }, [outcome.verificationAtomId]);
    store.connection.execute("UPDATE insights SET confidence=?,updated_at=datetime('now') WHERE id=?",
      [outcome.confidence, insightId]);
    return conclusion;
  });
}

export function verifyOnConnection(store: ReasoningStore, hypothesisId: string, project: string): VerificationOutcome {
  const hypothesis = store.getAtom(hypothesisId);
  if (!hypothesis || hypothesis.atomType !== 'hypothesis') throw new Error('Hypothesis atom not found');
  const premises = uniquePremises(store, hypothesis, project);
  const confidence = premises.length ? premises.reduce((sum, premise) => sum + premise.confidence, 0) / premises.length : 0;
  const hasSuccess = premises.some(premise => store.connection.query<{ type: string }>(
    'SELECT type FROM experiences WHERE id=?', [premise.experienceId!])[0]?.type === 'success');
  const verified = premises.length >= 2 && confidence >= 0.6 && hasSuccess &&
    premises.every(premise => !isInvalidated(store, premise.experienceId!)) &&
    store.connection.query("SELECT 1 FROM experience_insight_links WHERE insight_id=? AND relation='contradicts'",
      [hypothesis.insightId!]).length === 0;
  const result = { verificationAtomId: `${hypothesisId}:v`, verified,
    confidence: verified ? confidence : confidence * 0.5, premiseCount: premises.length };
  const existing = store.getAtom(result.verificationAtomId);
  if (existing) return { ...result, verified: existing.isVerified, confidence: existing.confidence };
  store.recordOnConnection({ atomId: result.verificationAtomId, atomType: 'verification',
    insightId: hypothesis.insightId!, agent: hypothesis.agent, isVerified: verified, confidence: result.confidence,
    content: `Evidence checks: distinct premises=${premises.length}, mean confidence=${confidence}, linked success=${hasSuccess}` },
  [hypothesisId]);
  return result;
}

function isInvalidated(store: ReasoningStore, sourceId: string): boolean {
  return store.connection.query('SELECT 1 FROM mimir_evidence_invalidations WHERE experience_id=?', [sourceId]).length > 0;
}

function uniquePremises(store: ReasoningStore, hypothesis: ReasoningAtom, project: string): ReasoningAtom[] {
  const unique = new Map<string, ReasoningAtom>();
  for (const atom of store.ancestors(hypothesis.atomId)) {
    if (atom.atomType !== 'premise' || !atom.experienceId) continue;
    const evidence = store.connection.query<{ project: string; agent: string }>(
      'SELECT project,agent FROM experiences WHERE id=?', [atom.experienceId])[0];
    if (!evidence || evidence.project !== project || evidence.agent !== hypothesis.agent) {
      throw new Error('Hypothesis evidence exceeds its scope');
    }
    const prior = unique.get(atom.experienceId);
    if (!prior || atom.confidence < prior.confidence) unique.set(atom.experienceId, atom);
  }
  return [...unique.values()];
}
