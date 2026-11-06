// Keyword-based user memory extraction adapted from Daebung Mimir.
import { createHash } from 'node:crypto';
import type { MimirDatabase } from '../store/database.js';
import type { MemoryScope } from '../types.js';
import { requireScope } from '../store/scope.js';

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';
export interface MemoryCandidate {
  memoryType: MemoryType; name: string; description: string; content: string; confidence: number;
}
export interface SessionMessage { role: string; content: string }
const SIGNALS: Record<MemoryType, readonly string[]> = {
  user: ["i am", "i'm a", 'my role', 'my job', 'i work', 'my expertise', 'i prefer', 'i like',
    'i want', 'i need', 'i usually', '제가', '저는', '제 역할', '제 직업', '선호'],
  feedback: ["don't", 'do not', 'stop', "please don't", 'never', 'always', 'instead of', 'prefer',
    'better if', "that's right", 'exactly', 'perfect', 'keep doing', 'good approach', 'yes that',
    '하지마', '하지 마', '그렇게 하지', '그게 맞아', '바로 그거'],
  project: ['deadline', 'freeze', 'release', 'sprint', 'milestone', 'we decided', 'the plan is',
    "we're going to", 'because legal', '마감', '릴리스', '스프린트', '결정', '계획'],
  reference: ['check the', 'look at', 'tracked in', 'dashboard at', 'linear', 'jira', 'slack',
    'grafana', 'notion', 'confluence', '확인해', '여기서 봐', '대시보드', '트래킹'],
};

export function classifyMemory(content: string): { memoryType: MemoryType; confidence: number } {
  const lower = content.toLowerCase();
  let memoryType: MemoryType = 'project';
  let score = 0;
  for (const [type, signals] of Object.entries(SIGNALS)) {
    const count = signals.filter(signal => /^[a-z]/.test(signal)
      ? new RegExp(`\\b${signal}\\b`, 'i').test(lower) : lower.includes(signal)).length;
    if (count > score) { memoryType = type as MemoryType; score = count; }
  }
  return { memoryType, confidence: Math.min(1, score / 3) };
}

export function extractCandidates(messages: readonly SessionMessage[]): MemoryCandidate[] {
  if (messages.length > 1000) throw new Error('Session extraction accepts at most 1000 messages');
  const candidates = new Map<string, MemoryCandidate>();
  for (const message of messages) {
    if (message.role !== 'user' || typeof message.content !== 'string' || message.content.length < 20) continue;
    if (message.content.length > 65536) throw new Error('Session message exceeds 65536 characters');
    const classification = classifyMemory(message.content);
    if (classification.confidence < 0.3) continue;
    const digest = createHash('sha256').update(message.content).digest('hex');
    const slug = message.content.split(/\s+/).filter(word => word.length > 2).slice(0, 4)
      .join('-').toLowerCase().replace(/[^\p{L}\p{N}-]/gu, '').slice(0, 40);
    const name = `${classification.memoryType}_${slug}-${digest}`;
    candidates.set(name, { ...classification, name, content: message.content,
      description: [...message.content].slice(0, 100).join('') });
  }
  return [...candidates.values()].sort((left, right) => right.confidence - left.confidence);
}

export function storeMemories(db: MimirDatabase, scope: Required<MemoryScope>,
  candidates: readonly MemoryCandidate[], accept?: (candidate: MemoryCandidate) => boolean): number {
  requireScope(scope);
  return db.reasoning.connection.transaction(() => {
    let stored = 0;
    for (const candidate of candidates) {
      if (!Number.isFinite(candidate.confidence) || candidate.confidence < 0.3 || candidate.confidence > 1 ||
          !candidate.content?.trim() || !Object.hasOwn(SIGNALS, candidate.memoryType)) continue;
      if (accept && !accept(candidate)) continue;
      const digest = createHash('sha256').update(candidate.content).digest('hex');
      const result = db.upsertExperience({ ...scope, type: 'pattern', category: candidate.memoryType,
        severity: 'info', context: JSON.stringify({ memory_type: candidate.memoryType,
          confidence: candidate.confidence, source: 'auto_extract' }),
        action: candidate.name, outcome: candidate.content, sourceRef: `auto-extract:${digest}`, sessionId: digest });
      if (result.isNew) stored++;
    }
    return stored;
  });
}

export function toFrontmatter(candidate: MemoryCandidate): string {
  return `---\nname: ${JSON.stringify(candidate.name)}\ndescription: ${JSON.stringify(candidate.description)}\ntype: ${JSON.stringify(candidate.memoryType)}\n---\n\n${candidate.content}`;
}

export function toIndexEntry(candidate: MemoryCandidate): string {
  const label = candidate.name.replace(/[\[\]\\]/g, '\\$&');
  const description = candidate.description.replace(/[\r\n]+/g, ' ').slice(0, 80);
  return `- [${label}](${encodeURIComponent(candidate.name)}.md) — ${description}`;
}
