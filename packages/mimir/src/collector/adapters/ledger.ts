// collector/adapters/ledger.ts — Soul Ledger adapter (architecture.md 4-2)
// Converts Soul Ledger entries (immutable JSON) into ExperienceEntry format

import type { ExperienceAdapter, RawExperience } from '../../types.js';
import { readdir, readFile, realpath, stat } from 'fs/promises';
import { join, resolve, relative, isAbsolute } from 'path';

/** Ledger entry structure (from Soul's ledger JSON files) */
interface LedgerEntry {
  readonly project?: string;
  readonly id?: string;
  readonly operationId?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly title?: string;
  readonly summary?: string;
  readonly agent?: string;
  readonly todo?: ReadonlyArray<string>;
  readonly decisions?: ReadonlyArray<string>;
  readonly insights?: ReadonlyArray<string>;
  readonly filesCreated?: ReadonlyArray<{ path: string; desc: string }>;
  readonly filesModified?: ReadonlyArray<{ path: string; desc: string }>;
  readonly timestamp?: string;
}

/**
 * LedgerAdapter — reads Soul Ledger JSON files and converts to RawExperience.
 *
 * Ledger path: soul/data/projects/{project}/ledger/YYYY/MM/DD/*.json
 *
 * Each ledger entry represents a completed work session.
 * Decisions and insights become individual experiences.
 */
export class LedgerAdapter implements ExperienceAdapter {
  private readonly soulDataPath: string;

  /**
   * @param soulDataPath - Path to soul/data directory
   */
  constructor(soulDataPath: string) {
    this.soulDataPath = soulDataPath;
  }

  async collect(project: string, agent: string): Promise<ReadonlyArray<RawExperience>> {
    if (!project || ['__proto__', 'prototype', 'constructor'].includes(project) || project.trim() !== project || project === '.' || project === '..' || /[\\/:<>"|?*\x00-\x1f]/.test(project)
      || /[. ]$/.test(project) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(project)) {
      throw new Error('Invalid Soul project path segment');
    }
    let root: string;
    try { root = await realpath(this.soulDataPath); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const expected = resolve(root, 'projects', project, 'ledger');
    let ledger: string;
    try { ledger = await realpath(expected); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    if (relative(expected, ledger) !== '') throw new Error('Ledger path resolves outside its project');
    const entries = await this.readAllLedgerEntries(ledger);
    return entries.flatMap(({ entry, file }) => {
      if (entry.agent !== agent || (entry.project !== undefined && entry.project !== project)) return [];
      return this.convertEntry(entry, `ledger/${project}/${file}`, project, agent);
    });
  }

  private convertEntry(entry: LedgerEntry, sourceRef: string, project: string, agent: string): RawExperience[] {
    const base = { context: entry.title ?? entry.summary ?? 'Work session', agent, project,
      timestamp: entry.completedAt ?? entry.timestamp ?? entry.startedAt,
      sessionId: entry.operationId ?? entry.id ?? sourceRef, severity: 'info' };
    const records: RawExperience[] = [];
    for (const [kind, items] of [['decision', entry.decisions], ['insight', entry.insights]] as const) {
      if (!Array.isArray(items)) continue;
      items.forEach((value, index) => {
        if (typeof value === 'string' && value.trim()) records.push({ ...base, action: value,
          outcome: `${kind} recorded in work ledger`, type: 'pattern', category: this.classifyDecision(value),
          sourceRef: `${sourceRef}#${kind}:${index}` });
      });
    }
    if (typeof entry.summary === 'string' && entry.summary.trim()) records.push({ ...base,
      action: entry.summary, outcome: 'Work session recorded', type: 'pattern', category: 'workflow',
      sourceRef: `${sourceRef}#summary` });
    return records;
  }

  private async readAllLedgerEntries(base: string): Promise<Array<{ entry: LedgerEntry; file: string }>> {
    const entries: Array<{ entry: LedgerEntry; file: string }> = [];
    const items = await readdir(base, { withFileTypes: true, recursive: true });
    const files = items.filter(item => item.isFile() && item.name.endsWith('.json'));
    if (files.length > 10000) throw new Error('Ledger collection exceeds 10000 files');
    for (const item of files) {
      const file = join(item.parentPath ?? base, item.name);
      const actual = await realpath(file);
      const rel = relative(base, actual);
      if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) throw new Error('Ledger file escapes project');
      if ((await stat(actual)).size > 1024 * 1024) throw new Error('Ledger entry exceeds 1 MiB');
      const text = await readFile(actual, 'utf8');
      try {
        const entry: unknown = JSON.parse(text);
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const record = entry as Record<string, unknown>;
        const textFields = ['agent', 'project', 'id', 'operationId', 'title', 'summary', 'timestamp', 'startedAt', 'completedAt'];
        if (textFields.some(key => record[key] !== undefined && typeof record[key] !== 'string')) continue;
        entries.push({ entry: entry as LedgerEntry, file: rel.replaceAll('\\', '/') });
      } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    }
    return entries;
  }

  /** Simple keyword-based decision classification */
  private classifyDecision(decision: string): string {
    const lower = decision.toLowerCase();
    if (lower.includes('타입') || lower.includes('type') || lower.includes('interface')) return 'coding_pattern';
    if (lower.includes('파일') || lower.includes('경로') || lower.includes('path')) return 'path_navigation';
    if (lower.includes('설치') || lower.includes('install') || lower.includes('npm')) return 'tool_usage';
    if (lower.includes('설계') || lower.includes('architect') || lower.includes('구조')) return 'architecture';
    if (lower.includes('보안') || lower.includes('권한') || lower.includes('security')) return 'security';
    return 'workflow';
  }

}
