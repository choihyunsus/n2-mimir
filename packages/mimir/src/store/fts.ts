// Literal FTS tokens with an optional OR separator; punctuation cannot create FTS syntax.
export function sanitizeFtsQuery(query: string): string {
  if (typeof query !== 'string' || query.length > 4096) throw new Error('Search query exceeds 4096 characters');
  const groups: string[][] = [[]];
  for (const token of query.match(/[\p{L}\p{N}_]+/gu) ?? []) {
    const keyword = token.toUpperCase();
    if (keyword === 'OR') { if (groups.at(-1)!.length) groups.push([]); continue; }
    if (['AND', 'NOT', 'NEAR'].includes(keyword)) continue;
    groups.at(-1)!.push(`"${token}"`);
  }
  return groups.filter(group => group.length).map(group => group.join(' ')).join(' OR ');
}

export function validateReadLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 0 || limit > 10000) throw new RangeError('Read limit must be an integer between 0 and 10000');
}
