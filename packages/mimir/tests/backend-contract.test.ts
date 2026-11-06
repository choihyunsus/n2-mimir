// Release runners explicitly assert which storage implementation the suite exercised.
import { it, expect } from 'vitest';
import { MimirDatabase } from '../src/store/database.js';

it('uses the requested release-test backend when specified', () => {
  const db = new MimirDatabase(':memory:');
  try {
    const expected = process.env.MIMIR_TEST_BACKEND;
    if (expected) expect(db.getMode()).toBe(expected);
    else expect(['rust', 'fallback']).toContain(db.getMode());
  } finally { db.close(); }
});
