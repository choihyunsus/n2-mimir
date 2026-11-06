import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Sqlite from 'better-sqlite3';
import { Mimir, JsonlAdapter, GenericAdapter } from '../src/index.js';
import { normalize } from '../src/collector/normalizer.js';

it('replays scoped JSONL without duplicate observations and rejects malformed values', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mimir-jsonl-'));
  const file = join(root, 'input.jsonl');
  const raw = { action: 'Build failed on initial attempt', outcome: 'error reported' };
  writeFileSync(file, [raw, { ...raw, agent: 'foreign' }, { action: { invalid: true }, outcome: 'error' }]
    .map(value => JSON.stringify(value)).join('\n') + '\nmalformed');
  const mimir = new Mimir({ dbPath: join(root, 'store.db') });
  try {
    mimir.registerAdapter(new JsonlAdapter(file));
    expect((await mimir.digest({ project: 'one', agent: 'alpha' })).collected).toBe(1);
    expect((await mimir.digest({ project: 'one', agent: 'alpha' })).collected).toBe(0);
    expect(mimir.queryExperiences({ project: 'one', agent: 'alpha' })[0].frequency).toBe(1);
    expect(normalize({ ...raw, agent: null } as never)).toBeNull();
  } finally { mimir.close(); rmSync(root, { recursive: true, force: true }); }
});

it('retains generic observations through storage failure and another scope collection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mimir-generic-'));
  const path = join(root, 'store.db');
  const mimir = new Mimir({ dbPath: path });
  const sql = new Sqlite(path);
  const adapter = new GenericAdapter();
  adapter.push({ project: 'one', agent: 'alpha', action: 'Build failed once', outcome: 'error' });
  adapter.push({ project: 'two', agent: 'beta', action: 'Build passed', outcome: 'success' });
  mimir.registerAdapter(adapter);
  try {
    sql.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON experiences BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
    const failed = await mimir.digest({ project: 'one', agent: 'alpha' });
    expect(failed.collectionErrors[0].message).toContain('injected failure');
    expect(await adapter.collect('one', 'alpha')).toHaveLength(1);
    sql.exec('DROP TRIGGER fail_insert');
    expect((await mimir.digest({ project: 'two', agent: 'beta' })).collected).toBe(1);
    expect((await mimir.digest({ project: 'one', agent: 'alpha' })).collected).toBe(1);
    expect(await adapter.collect('one', 'alpha')).toHaveLength(0);
    expect(await adapter.collect('two', 'beta')).toHaveLength(0);
  } finally { sql.close(); mimir.close(); rmSync(root, { recursive: true, force: true }); }
});
