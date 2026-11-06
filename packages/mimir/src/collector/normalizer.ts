// Experience normalizer — converts raw input to validated ExperienceEntry
import type { RawExperience, ExperienceInput, ExperienceType, Severity } from '../types.js';

/** Signal keywords that indicate meaningful experiences */
const SIGNAL_KEYWORDS = {
  failure: ['error', 'errors', 'fail', 'failed', 'failure', 'crash', 'crashed', 'bug', 'broken', 'wrong', '실패', '에러', '오류', '버그'],
  correction: ['fix', 'fixed', 'correct', 'corrected', 'change', 'changed', 'should', 'instead', '수정', '교정', '변경', '대신'],
  success: ['success', 'successful', 'complete', 'completed', 'done', 'work', 'worked', 'pass', 'passed', '성공', '완료', '통과'],
  pattern: ['always', 'every time', 'pattern', 'repeat', '항상', '매번', '반복', '패턴'],
} as const;

/** Detect experience type from text content */
function detectType(raw: RawExperience): ExperienceType {
  if (raw.type && isValidType(raw.type)) return raw.type;

  const text = `${raw.action} ${raw.outcome} ${raw.context ?? ''}`.toLowerCase();

  if (raw.correction) return 'correction';
  if (/\b(?:not|never)\s+(?:work\w*|pass\w*|succeed\w*|successful|complete\w*)\b/.test(text)) return 'failure';
  if (SIGNAL_KEYWORDS.correction.some((k) => containsSignal(text, k))) return 'correction';
  if (SIGNAL_KEYWORDS.failure.some((k) => containsSignal(text, k))) return 'failure';
  if (SIGNAL_KEYWORDS.pattern.some((k) => containsSignal(text, k))) return 'pattern';
  if (SIGNAL_KEYWORDS.success.some((k) => containsSignal(text, k))) return 'success';

  return 'pattern';
}

/** Detect severity from content */
function detectSeverity(raw: RawExperience): Severity {
  if (raw.severity && isValidSeverity(raw.severity)) return raw.severity;

  const text = `${raw.action} ${raw.outcome}`.toLowerCase();
  if (text.includes('critical') || text.includes('치명')) return 'critical';
  if (text.includes('error') || text.includes('에러')) return 'error';
  if (text.includes('warning') || text.includes('경고')) return 'warning';
  return 'info';
}

/** Detect category from content (score-based, highest match count wins) */
function detectCategory(raw: RawExperience): string {
  if (raw.category) return raw.category;

  const text = `${raw.action} ${raw.outcome} ${raw.context ?? ''}`.toLowerCase();

  const categories: Array<{ keywords: string[]; name: string }> = [
    { keywords: ['deploy', 'build', 'publish', '배포', '빌드'], name: 'deployment' },
    { keywords: ['test', 'verify', '테스트', '검증'], name: 'testing' },
    { keywords: ['design', 'architecture', 'structure', '설계', '아키텍처'], name: 'architecture' },
    { keywords: ['code', 'function', 'class', 'module', '코드', '함수'], name: 'coding_pattern' },
    { keywords: ['file', 'path', 'directory', '파일', '경로', '디렉토리'], name: 'file_system' },
    { keywords: ['config', 'setting', 'env', '설정', '환경'], name: 'configuration' },
    { keywords: ['git', 'commit', 'branch', 'merge'], name: 'version_control' },
    { keywords: ['api', 'endpoint', 'request', 'response'], name: 'api' },
    { keywords: ['db', 'database', 'query', 'sql', '데이터베이스'], name: 'database' },
  ];

  let bestName = 'general';
  let bestScore = 0;

  for (const cat of categories) {
    const score = cat.keywords.filter((k) => text.includes(k)).length;
    if (score > bestScore) {
      bestScore = score;
      bestName = cat.name;
    }
  }

  return bestName;
}

/** Check if action+outcome have enough signal to be worth storing */
export function hasSignal(raw: RawExperience): boolean {
  const text = `${raw.action} ${raw.outcome}`;
  const lowerText = text.toLowerCase();

  // Keywords first — if signal keyword exists, always valid
  const allKeywords = Object.values(SIGNAL_KEYWORDS).flat();
  const matchCount = allKeywords.filter((k) => containsSignal(lowerText, k)).length;
  if (matchCount > 0) return true;

  // No keywords — require minimum length for noise filtering
  return text.length > 100;
}

/** Normalize raw experience into validated ExperienceInput */
export function normalize(raw: RawExperience): ExperienceInput | null {
  if (!isRawExperience(raw)) return null;
  if (!hasSignal(raw)) return null;

  return {
    agent: raw.agent ?? 'unknown',
    project: raw.project ?? 'default',
    type: detectType(raw),
    category: detectCategory(raw),
    severity: detectSeverity(raw),
    context: raw.context ?? '',
    action: raw.action,
    outcome: raw.outcome,
    correction: raw.correction,
    sourceRef: raw.sourceRef,
    sessionId: raw.sessionId ?? raw.timestamp ?? '',
  };
}

// === Type guards ===

function containsSignal(text: string, signal: string): boolean {
  return /^[a-z]/.test(signal) ? new RegExp(`\\b${signal}\\b`, 'i').test(text) : text.includes(signal);
}

export function isRawExperience(value: unknown): value is RawExperience {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  if (typeof raw.action !== 'string' || !raw.action.trim() ||
      typeof raw.outcome !== 'string' || !raw.outcome.trim()) return false;
  const optionalFields = ['agent', 'project', 'context', 'type', 'category', 'severity',
    'correction', 'sourceRef', 'sessionId', 'timestamp'];
  if (optionalFields.some(key => raw[key] !== undefined && typeof raw[key] !== 'string')) return false;
  return ['agent', 'project'].every(key => raw[key] === undefined || (raw[key] as string).trim().length > 0);
}

function isValidType(s: string): s is ExperienceType {
  return ['success', 'failure', 'correction', 'pattern'].includes(s);
}

function isValidSeverity(s: string): s is Severity {
  return ['critical', 'error', 'warning', 'info'].includes(s);
}
