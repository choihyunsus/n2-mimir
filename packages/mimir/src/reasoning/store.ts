// Traceable, ordered derivation records adapted from Daebung Mimir.
import type { SqlConnection } from '../store/connection.js';
import { initializeReasoning } from './schema.js';
import { buildInsightChain, verifyOnConnection } from './chain.js';
import { invalidateEvidence } from './invalidation.js';

export const ATOM_TYPES = ['premise', 'reasoning', 'hypothesis', 'verification', 'conclusion'] as const;
export type AtomType = typeof ATOM_TYPES[number];
export interface ReasoningAtom {
  atomId: string; atomType: AtomType; content: string; confidence: number;
  isVerified: boolean; depth: number; insightId: string | null;
  experienceId: string | null; agent: string; createdAt: string;
}
export interface AtomInput {
  atomId: string; atomType: AtomType; content: string; insightId: string;
  agent: string; experienceId?: string; confidence?: number; isVerified?: boolean;
}
const SELECT_ATOMS = `SELECT atom_id AS atomId, atom_type AS atomType, content, confidence,
  is_verified AS isVerified, depth, insight_id AS insightId, experience_id AS experienceId,
  agent, created_at AS createdAt FROM mimir_reasoning_atoms`;
const MAX_TRACE_ATOMS = 1000;

export class ReasoningStore {
  constructor(readonly connection: SqlConnection) { initializeReasoning(connection); }

  buildInsightChain(insightId: string) { return buildInsightChain(this, insightId); }

  verifyHypothesis(hypothesisId: string, project: string) {
    return this.connection.transaction(() => verifyOnConnection(this, hypothesisId, project));
  }

  invalidateEvidence(experienceId: string): number { return invalidateEvidence(this, experienceId); }

  getAtom(id: string): ReasoningAtom | undefined {
    const atom = this.connection.query<ReasoningAtom>(`${SELECT_ATOMS} WHERE atom_id=?`, [id])[0];
    return atom ? { ...atom, isVerified: Boolean(atom.isVerified) } : undefined;
  }

  parentsOf(id: string): string[] {
    return this.connection.query<{ id: string }>('SELECT parent_atom_id AS id FROM mimir_atom_deps WHERE child_atom_id=? ORDER BY parent_atom_id', [id]).map(row => row.id);
  }

  recordAtom(input: AtomInput, parents: readonly string[] = []): ReasoningAtom {
    return this.connection.transaction(() => this.recordOnConnection(input, parents));
  }

  /** Internal transaction participant used by atomic chain construction. */
  recordOnConnection(input: AtomInput, parents: readonly string[]): ReasoningAtom {
    const depth = ATOM_TYPES.indexOf(input.atomType);
    const confidence = input.confidence ?? 0.7;
    if (depth < 0 || !input.atomId?.trim() || !input.content?.trim() || !Number.isFinite(confidence)) {
      throw new Error('Invalid reasoning atom');
    }
    this.validateOwnership(input);
    for (const id of new Set(parents)) {
      const parent = this.getAtom(id);
      if (!parent || parent.agent !== input.agent || parent.insightId !== input.insightId ||
          ATOM_TYPES.indexOf(parent.atomType) >= depth) throw new Error('Invalid parent scope or atom order');
    }
    this.connection.execute(`INSERT INTO mimir_reasoning_atoms
      (atom_id,atom_type,content,confidence,is_verified,depth,insight_id,experience_id,agent)
      VALUES(?,?,?,?,?,?,?,?,?)`, [input.atomId, input.atomType, input.content,
      Math.max(0, Math.min(1, confidence)), Number(input.isVerified ?? false), depth,
      input.insightId, input.experienceId ?? null, input.agent]);
    for (const parent of new Set(parents)) {
      this.connection.execute('INSERT INTO mimir_atom_deps(parent_atom_id,child_atom_id) VALUES(?,?)', [parent, input.atomId]);
    }
    return this.getAtom(input.atomId)!;
  }

  private validateOwnership(input: AtomInput): void {
    const insight = this.connection.query<{ agent: string }>('SELECT agent FROM insights WHERE id=?', [input.insightId])[0];
    if (!insight || insight.agent !== input.agent) throw new Error('Atom must belong to an insight owned by its agent');
    if (input.experienceId) {
      const source = this.connection.query<{ agent: string }>(`SELECT e.agent FROM experiences e
        JOIN experience_insight_links l ON l.experience_id=e.id WHERE l.insight_id=? AND e.id=?`,
      [input.insightId, input.experienceId])[0];
      if (!source || source.agent !== input.agent || input.atomType !== 'premise') {
        throw new Error('Premise must reference linked evidence owned by the insight agent');
      }
    }
  }

  latestConclusion(insightId: string): ReasoningAtom | undefined {
    const atom = this.connection.query<ReasoningAtom>(`${SELECT_ATOMS}
      WHERE insight_id=? AND atom_type='conclusion' ORDER BY created_at DESC,rowid DESC LIMIT 1`, [insightId])[0];
    return atom ? { ...atom, isVerified: Boolean(atom.isVerified) } : undefined;
  }

  traceInsight(insightId: string): ReasoningAtom[] {
    const root = this.latestConclusion(insightId);
    return root ? this.ancestors(root.atomId) : [];
  }

  ancestors(atomId: string): ReasoningAtom[] {
    const queue = [atomId];
    const seen = new Set<string>();
    const result: ReasoningAtom[] = [];
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index];
      if (seen.has(id)) continue;
      if (seen.size >= MAX_TRACE_ATOMS) throw new Error('Reasoning trace exceeds atom limit');
      seen.add(id);
      const atom = this.getAtom(id);
      if (atom) { result.push(atom); queue.push(...this.parentsOf(id)); }
    }
    return result;
  }
}
