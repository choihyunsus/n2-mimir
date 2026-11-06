// Store bounded previews while retaining the complete source observations.
import type { SqlConnection } from '../store/connection.js';
import type { MemoryScope } from '../types.js';
import { requireScope } from '../store/scope.js';
const PREVIEW_BYTES = 300;

export function archiveExperiences(connection: SqlConnection, scope: Required<MemoryScope>): number {
  requireScope(scope);
  return connection.transaction(() => {
    const rows = connection.query<{ id: string; context: string; action: string; outcome: string }>(`
      SELECT id,context,action,outcome FROM experiences e WHERE agent=? AND project=?
      AND julianday(created_at)<julianday('now','-90 days') AND length(CAST(context AS BLOB))>?
      AND EXISTS(SELECT 1 FROM experience_insight_links l WHERE l.experience_id=e.id)
      AND NOT EXISTS(SELECT 1 FROM mimir_experience_previews p WHERE p.experience_id=e.id)
      ORDER BY created_at,id LIMIT 1000`, [scope.agent, scope.project, PREVIEW_BYTES]);
    for (const row of rows) {
      connection.execute('INSERT INTO mimir_experience_previews(experience_id,context,action,outcome) VALUES(?,?,?,?)',
        [row.id, previewContext(row.context), truncateBytes(row.action), truncateBytes(row.outcome)]);
    }
    return rows.length;
  });
}

function truncateBytes(text: string, maxBytes = PREVIEW_BYTES): string {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  let result = '';
  let length = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character);
    if (length + size > maxBytes - 3) break;
    result += character;
    length += size;
  }
  return result + '...';
}

function previewContext(text: string): string {
  try {
    const compact = JSON.stringify(JSON.parse(text));
    if (Buffer.byteLength(compact) <= PREVIEW_BYTES) return compact;
    let content = [...truncateBytes(text, PREVIEW_BYTES - 40)];
    let result = JSON.stringify({ _archived: true, _preview: content.join('') });
    while (Buffer.byteLength(result) > PREVIEW_BYTES) {
      content.pop();
      result = JSON.stringify({ _archived: true, _preview: content.join('') });
    }
    return result;
  } catch { return truncateBytes(text); }
}
