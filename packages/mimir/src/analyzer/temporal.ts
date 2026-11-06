// Category-specific temporal priority follows Daebung Skuld's public formula.
const DECAY_RATES: ReadonlyArray<readonly [string, number]> = [
  ['architecture', 0.002], ['code_pattern', 0.005], ['security', 0.008],
  ['doc_learn', 0.01], ['general', 0.01], ['library_api', 0.02],
];
const DEFAULT_DECAY = 0.01;
const MILLISECONDS_PER_DAY = 86400000;

export function timestampMillis(timestamp: string): number {
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(timestamp)
    ? timestamp.replace(' ', 'T') + 'Z' : timestamp;
  return Date.parse(normalized);
}

export function decayRateFor(category: string): number {
  return DECAY_RATES.find(([name]) => category.toLowerCase().includes(name))?.[1] ?? DEFAULT_DECAY;
}

export function freshnessWeight(timestamp: string, category: string, now = Date.now()): number {
  const instant = timestampMillis(timestamp);
  if (!Number.isFinite(instant) || !Number.isFinite(now)) return 0;
  const days = Math.max(0, (now - instant) / MILLISECONDS_PER_DAY);
  return 1 / (1 + decayRateFor(category) * days);
}

export function freshnessSql(timestampColumn: 'created_at' | 'updated_at'): string {
  const rate = `CASE ${DECAY_RATES.map(([name, value]) => `WHEN instr(lower(category),'${name}')>0 THEN ${value}`).join(' ')} ELSE ${DEFAULT_DECAY} END`;
  return `COALESCE(1.0/(1.0+(${rate})*MAX(0,julianday('now')-julianday(${timestampColumn}))),0)`;
}
