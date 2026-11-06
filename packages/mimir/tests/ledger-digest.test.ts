// Exercise real ledger ingestion, repeated digest and owner isolation through the public API.
import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Mimir, LedgerAdapter } from '../src/index.js';

it('imports scoped ledger reports without fabricating success or amplifying replay', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mimir-ledger-'));
  const folder = join(root, 'projects', 'one', 'ledger', '2026', '11', '06');
  mkdirSync(folder, { recursive: true });
  const entry = { agent: 'alpha', project: 'one', operationId: 'work-one',
    completedAt: '2026-11-06T12:00:00.000Z', summary: 'Tests failed in this synthetic work session',
    decisions: ['Keep verification explicit before delivery'] };
  writeFileSync(join(folder, '001.json'), JSON.stringify(entry));
  writeFileSync(join(folder, '002.json'), JSON.stringify({ ...entry, agent: 'beta', summary: 'Foreign private observation' }));
  const mimir = new Mimir({ dbPath: join(root, 'mimir.db'), llm: { provider: 'ollama', model: '', endpoint: '' } });
  try {
    const adapter = new LedgerAdapter(root);
    await expect(adapter.collect('../escape', 'alpha')).rejects.toThrow();
    mimir.registerAdapter(adapter);
    expect((await mimir.digest({ project: 'one', agent: 'alpha' })).collected).toBe(2);
    expect((await mimir.digest({ project: 'one', agent: 'alpha' })).collected).toBe(0);
    const entries = mimir.queryExperiences({ project: 'one', agent: 'alpha' });
    expect(entries).toHaveLength(2);
    expect(entries.every(item => item.type === 'pattern' && item.frequency === 1 && item.sessionId === 'work-one')).toBe(true);
    expect(new Set(entries.map(item => item.sourceRef)).size).toBe(2);
    expect(mimir.queryExperiences({ agent: 'beta' })).toEqual([]);
  } finally { mimir.close(); rmSync(root, { recursive: true, force: true }); }
});
