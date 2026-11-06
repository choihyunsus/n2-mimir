// Durable study sessions flush observations and a traceable summary atomically.
import { randomUUID } from 'node:crypto';
import type { MimirDatabase } from '../store/database.js';
import type { ExperienceType, MemoryScope } from '../types.js';
import { requireScope } from '../store/scope.js';
import { initializeStudy } from './study-schema.js';

export interface StudyEntry { id?: string; topic: string; action: string; outcome: string; entryType: ExperienceType; category?: string }
export interface StudySession { id: string; agent: string; project: string; topic: string; status: 'active' | 'completed' | 'cancelled' }
export interface StudyResult { sessionId: string; status: 'completed'; project: string; entriesProcessed: number; experienceIds: string[]; insightId: string | null }
interface StoredEntry extends Omit<StudyEntry, 'id'> { id: string }
const MAX_STUDY_ENTRIES = 100;

export class StudyStore {
  constructor(private readonly db: MimirDatabase) { initializeStudy(this.connection); }
  private get connection() { return this.db.reasoning.connection; }

  start(input: Required<MemoryScope> & { topic: string; sessionId?: string }) {
    requireScope(input);
    validateText(input.topic, 'topic', 2000);
    const id = input.sessionId ?? randomUUID();
    validateText(id, 'session ID', 200);
    return this.connection.transaction(() => {
      const existing = this.connection.query<StudySession>('SELECT id,agent,project,topic,status FROM mimir_study_sessions WHERE id=?', [id])[0];
      if (existing && (existing.agent !== input.agent || existing.project !== input.project || existing.topic !== input.topic)) {
        throw new Error('Study session ID belongs to another request');
      }
      this.connection.execute('INSERT OR IGNORE INTO mimir_study_sessions(id,agent,project,topic) VALUES(?,?,?,?)',
        [id, input.agent, input.project, input.topic]);
      const topic = `%${input.topic.replace(/[~%_]/g, '~$&')}%`;
      const experiences = this.connection.query(`SELECT id,action,outcome,type,frequency FROM experiences
        WHERE agent=? AND project=? AND (context LIKE ? ESCAPE '~' OR action LIKE ? ESCAPE '~' OR outcome LIKE ? ESCAPE '~')
        ORDER BY frequency DESC,id LIMIT 10`, [input.agent, input.project, topic, topic, topic]);
      return { session: existing ?? { id, agent: input.agent, project: input.project, topic: input.topic, status: 'active' as const },
        existingExperiences: experiences };
    });
  }

  add(sessionId: string, scope: Required<MemoryScope>, entry: StudyEntry): string {
    requireScope(scope);
    for (const field of ['topic', 'action', 'outcome'] as const) validateText(entry[field], field, 65536);
    if (!['success', 'failure', 'correction', 'pattern'].includes(entry.entryType)) throw new Error('Invalid study entry type');
    if (entry.category !== undefined) validateText(entry.category, 'category', 128);
    const id = entry.id ?? randomUUID();
    validateText(id, 'entry ID', 200);
    return this.connection.transaction(() => {
      const session = this.ownedSession(sessionId, scope);
      if (session.status !== 'active') throw new Error('Study session is no longer active');
      const row = this.connection.query<{ session_id: string; topic: string; action: string; outcome: string; entry_type: string; category: string }>(
        'SELECT session_id,topic,action,outcome,entry_type,category FROM mimir_study_entries WHERE id=?', [id])[0];
      if (row) {
        if (row.session_id !== sessionId || row.topic !== entry.topic || row.action !== entry.action ||
            row.outcome !== entry.outcome || row.entry_type !== entry.entryType || row.category !== (entry.category ?? 'general')) {
          throw new Error('Conflicting study entry replay');
        }
        return id;
      }
      const count = this.connection.query<{ count: number }>('SELECT COUNT(*) AS count FROM mimir_study_entries WHERE session_id=?', [sessionId])[0].count;
      if (count >= MAX_STUDY_ENTRIES) throw new Error('Study session reached 100 entries');
      this.connection.execute(`INSERT INTO mimir_study_entries(id,session_id,topic,action,outcome,entry_type,category)
        VALUES(?,?,?,?,?,?,?)`, [id, sessionId, entry.topic, entry.action, entry.outcome, entry.entryType, entry.category ?? 'general']);
      return id;
    });
  }

  end(sessionId: string, scope: Required<MemoryScope>): StudyResult {
    requireScope(scope);
    return this.connection.transaction(() => {
      const session = this.ownedSession(sessionId, scope);
      if (session.status === 'completed') {
        const receipt = this.connection.query<{ result_json: string }>('SELECT result_json FROM mimir_study_results WHERE session_id=?', [sessionId])[0];
        if (!receipt) throw new Error('Legacy completed study has no replay receipt');
        return JSON.parse(receipt.result_json) as StudyResult;
      }
      if (session.status !== 'active') throw new Error('Study session is no longer active');
      const entries = this.connection.query<StoredEntry>(`SELECT id,topic,action,outcome,entry_type AS entryType,category
        FROM mimir_study_entries WHERE session_id=? ORDER BY created_at,rowid`, [sessionId]);
      if (entries.length > MAX_STUDY_ENTRIES) throw new Error('Study session exceeds 100 entries');
      const experienceIds = entries.map(entry => this.db.upsertExperience({ ...scope, type: entry.entryType,
        category: entry.category ?? 'general', context: entry.topic, action: entry.action, outcome: entry.outcome,
        sourceRef: `study:${sessionId}:${entry.id}`, sessionId }).id);
      const insightId = this.summarize(session, entries, experienceIds);
      const result: StudyResult = { sessionId, status: 'completed', project: session.project,
        entriesProcessed: entries.length, experienceIds, insightId };
      this.connection.execute('INSERT INTO mimir_study_results(session_id,result_json) VALUES(?,?)', [sessionId, JSON.stringify(result)]);
      this.connection.execute("UPDATE mimir_study_sessions SET status='completed',updated_at=datetime('now') WHERE id=?", [sessionId]);
      return result;
    });
  }

  cancel(sessionId: string, scope: Required<MemoryScope>): void {
    requireScope(scope);
    this.connection.transaction(() => {
      const session = this.ownedSession(sessionId, scope);
      if (session.status === 'completed') throw new Error('Completed study cannot be cancelled');
      this.connection.execute("UPDATE mimir_study_sessions SET status='cancelled',updated_at=datetime('now') WHERE id=?", [sessionId]);
    });
  }

  private ownedSession(id: string, scope: Required<MemoryScope>): StudySession {
    const session = this.connection.query<StudySession>('SELECT id,agent,project,topic,status FROM mimir_study_sessions WHERE id=?', [id])[0];
    if (!session || session.agent !== scope.agent || session.project !== scope.project) throw new Error('Study session owner mismatch');
    return session;
  }

  private summarize(session: StudySession, entries: StoredEntry[], sourceIds: string[]): string | null {
    if (entries.length < 2) return null;
    const details = entries.map(entry => `${entry.action.slice(0, 100)} — ${entry.outcome.slice(0, 100)}`).join('\n');
    return this.db.insertInsight({ agent: session.agent, project: session.project,
      category: 'study', description: `${session.topic}\n${details}`, compressed: session.topic, sourceIds }).id;
  }
}

function validateText(value: string, name: string, max: number): void {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid study ${name}`);
}
