import { it, expect } from 'vitest';
import { SoulPlugin } from '../soul-plugin/hooks.js';
import { registerMimirTools } from '../soul-plugin/tools.js';

it('supports explicit Soul host lifecycle calls and stable report replay', async () => {
  const plugin = new SoulPlugin({ dbPath: ':memory:' });
  const report = { sessionId: 'synthetic-session', summary: 'Tests reported an error',
    decisions: ['Keep review evidence'], filesModified: [{ path: 'example.ts', desc: 'Reported edit' }] };
  try {
    expect((await plugin.activate('demo', 'worker', 0)).totalTokens).toBe(0);
    const first = await plugin.digest('demo', 'worker', report);
    const second = await plugin.digest('demo', 'worker', report);
    expect(first.experiencesNew).toBe(3);
    expect(second.experiencesNew).toBe(0);
    expect(plugin.getStats().experiences).toBe(3);
    const names: string[] = [];
    registerMimirTools(tool => names.push(tool.name));
    expect(new Set(names).size).toBe(5);
  } finally { plugin.close(); }
});
