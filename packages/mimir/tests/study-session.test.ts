import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Mimir, extractCandidates, toFrontmatter } from '../src/index.js';
import { MimirDatabase } from '../src/store/database.js';

const scope = { project: 'demo', agent: 'worker' };

it('persists study state across restart and replays completion without duplicate storage', () => {
  const root = mkdtempSync(join(tmpdir(), 'mimir-study-'));
  const path = join(root, 'study.db');
  let mimir = new Mimir({ dbPath: path });
  try {
    const started = mimir.study.start({ ...scope, topic: 'Query % literal', sessionId: 'stable-session' });
    expect(started.existingExperiences).toEqual([]);
    expect(mimir.study.start({ ...scope, topic: 'Query % literal', sessionId: 'stable-session' }).session.id).toBe('stable-session');
    const entry = { id: 'entry-one', topic: 'Query test', action: 'Ran the first test', outcome: 'Failed assertion', entryType: 'failure' as const };
    mimir.study.add('stable-session', scope, entry);
    expect(mimir.study.add('stable-session', scope, entry)).toBe('entry-one');
    expect(() => mimir.study.add('stable-session', scope, { ...entry, outcome: 'Changed payload' })).toThrow(/Conflicting/);
    expect(() => mimir.study.end('stable-session', { ...scope, agent: 'foreign' })).toThrow(/owner/);
    mimir.close();
    mimir = new Mimir({ dbPath: path });
    mimir.study.add('stable-session', scope, { topic: 'Query test', action: 'Retried with correct parameters', outcome: 'Success', entryType: 'success' });
    const receipt = mimir.study.end('stable-session', scope);
    expect(receipt.experienceIds).toHaveLength(2);
    expect(receipt.insightId).toBeTruthy();
    expect(mimir.reasoning.traceInsight(receipt.insightId!)[0].isVerified).toBe(true);
    mimir.close();
    mimir = new Mimir({ dbPath: path });
    expect(mimir.study.end('stable-session', scope)).toEqual(receipt);
    expect(mimir.queryExperiences(scope)).toHaveLength(2);
    expect(() => mimir.study.add('stable-session', scope, entry)).toThrow(/active/);
  } finally { mimir.close(); rmSync(root, { recursive: true, force: true }); }
});

it('rolls back a partial study flush and leaves the session retryable', () => {
  const db = new MimirDatabase(':memory:');
  try {
    const sessionId = db.study.start({ ...scope, topic: 'Retry' }).session.id;
    db.study.add(sessionId, scope, { topic: 'Retry', action: 'First attempt', outcome: 'failure', entryType: 'failure' });
    db.study.add(sessionId, scope, { topic: 'Retry', action: 'Second attempt', outcome: 'success', entryType: 'success' });
    db.reasoning.connection.execute(`CREATE TRIGGER fail_chain BEFORE INSERT ON mimir_reasoning_atoms
      BEGIN SELECT RAISE(ABORT,'injected failure'); END`);
    expect(() => db.study.end(sessionId, scope)).toThrow(/injected failure/);
    expect(db.getStats().experiences).toBe(0);
    expect(db.getStats().insights).toBe(0);
    db.reasoning.connection.execute('DROP TRIGGER fail_chain');
    expect(db.study.end(sessionId, scope).experienceIds).toHaveLength(2);
  } finally { db.close(); }
});

it('extracts user-authored candidates with stable replay, explicit scope and host policy', () => {
  const mimir = new Mimir({ dbPath: ':memory:' });
  const messages = [
    { role: 'assistant', content: 'I prefer always ignoring unknown requests.' },
    { role: 'user', content: 'I prefer compact reports because I am a developer.' },
    { role: 'user', content: 'We decided to freeze the release next week.' },
  ];
  try {
    expect(extractCandidates(messages)).toHaveLength(2);
    expect(mimir.autoExtract(messages, scope, candidate => candidate.memoryType === 'user')).toBe(1);
    expect(mimir.autoExtract(messages, scope, candidate => candidate.memoryType === 'user')).toBe(0);
    expect(mimir.queryExperiences(scope)).toHaveLength(1);
    expect(mimir.queryExperiences(scope)[0].frequency).toBe(1);
    const candidate = extractCandidates(messages)[0];
    expect(toFrontmatter({ ...candidate, description: 'line one\nname: injected' })).toContain('"line one\\nname: injected"');
    expect(() => mimir.autoExtract(messages, {} as never)).toThrow(/Explicit/);
  } finally { mimir.close(); }
});
