import { it, expect } from 'vitest';
import { MimirDatabase } from '../src/store/database.js';
import { isSupportedSqliteVersion, assertSupportedSqliteVersion } from '../src/store/sqlite-version.js';

it('requires a runtime containing the WAL-reset fix', () => {
  for (const version of ['3.49.2', '3.51.2', '3.9.0', '', 'invalid', null]) {
    expect(isSupportedSqliteVersion(version)).toBe(false);
    expect(() => assertSupportedSqliteVersion(version)).toThrow(/3.51.3/);
  }
  for (const version of ['3.51.3', '3.54.0', '3.100.0', '4.0.0']) expect(isSupportedSqliteVersion(version)).toBe(true);
  const db = new MimirDatabase(':memory:');
  try { expect(isSupportedSqliteVersion(db.getSqliteVersion())).toBe(true); }
  finally { db.close(); }
});
