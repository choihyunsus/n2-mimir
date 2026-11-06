// In-memory observations are retained until the consumer acknowledges storage.
import type { ExperienceAdapter, RawExperience } from '../../types.js';
import { randomUUID } from 'node:crypto';
import { isRawExperience } from '../normalizer.js';

const MAX_BUFFERED_EXPERIENCES = 10000;

export class GenericAdapter implements ExperienceAdapter {
  private buffer: RawExperience[] = [];

  push(experience: RawExperience): void {
    this.pushBatch([experience]);
  }

  pushBatch(experiences: ReadonlyArray<RawExperience>): void {
    if (this.buffer.length + experiences.length > MAX_BUFFERED_EXPERIENCES) {
      throw new Error('GenericAdapter buffer is full');
    }
    if (!experiences.every(isRawExperience)) throw new Error('Invalid raw experience');
    this.buffer.push(...experiences.map(experience => Object.freeze({ ...experience,
      sourceRef: experience.sourceRef || `generic:${randomUUID()}` })));
  }

  async collect(project: string, agent: string): Promise<ReadonlyArray<RawExperience>> {
    return this.buffer.filter(experience =>
      (experience.project === undefined || experience.project === project) &&
      (experience.agent === undefined || experience.agent === agent));
  }

  acknowledge(experiences: ReadonlyArray<RawExperience>): void {
    const acknowledged = new Set(experiences);
    this.buffer = this.buffer.filter(experience => !acknowledged.has(experience));
  }
}
