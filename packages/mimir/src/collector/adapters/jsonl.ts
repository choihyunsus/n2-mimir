// JSONL observations retain stable source references across repeated collection.
import type { ExperienceAdapter, RawExperience } from '../../types.js';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { isRawExperience } from '../normalizer.js';

const MAX_JSONL_BYTES = 16 * 1024 * 1024;

export class JsonlAdapter implements ExperienceAdapter {
  constructor(private readonly filePath: string) {}

  async collect(project: string, agent: string): Promise<ReadonlyArray<RawExperience>> {
    let file;
    try { file = await open(this.filePath, 'r'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    try {
      const bytes = Buffer.alloc(MAX_JSONL_BYTES + 1);
      let length = 0;
      while (length < bytes.length) {
        const read = await file.read(bytes, length, bytes.length - length, null);
        if (read.bytesRead === 0) break;
        length += read.bytesRead;
      }
      if (length > MAX_JSONL_BYTES) throw new Error('JSONL file exceeds 16 MiB');
      return this.parse(bytes.subarray(0, length).toString('utf8'), project, agent);
    } finally { await file.close(); }
  }

  private parse(content: string, project: string, agent: string): RawExperience[] {
    const experiences: RawExperience[] = [];
    const pathHash = createHash('sha256').update(resolve(this.filePath)).digest('hex');
    for (const [index, line] of content.split('\n').entries()) {
      let parsed: unknown;
      try { parsed = JSON.parse(line); } catch { continue; }
      if (!isRawExperience(parsed)) continue;
      if ((parsed.project !== undefined && parsed.project !== project) ||
          (parsed.agent !== undefined && parsed.agent !== agent)) continue;
      const hash = createHash('sha256').update(line).digest('hex');
      experiences.push({ ...parsed, project, agent,
        sourceRef: parsed.sourceRef || `jsonl:${pathHash}:${index + 1}:${hash}` });
    }
    return experiences;
  }
}
