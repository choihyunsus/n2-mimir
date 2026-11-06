// collector/normalizer — normalization, signal detection, type/severity inference tests
import { describe, it, expect } from 'vitest';
import { normalize, hasSignal } from '../src/collector/normalizer.js';
import type { RawExperience } from '../src/types.js';

describe('normalizer', () => {
  describe('hasSignal', () => {
    it('should reject too-short text', () => {
      expect(hasSignal({ action: 'hi', outcome: 'ok' })).toBe(false);
    });

    it('should accept text with signal keywords', () => {
      expect(hasSignal({ action: 'build failed with error', outcome: 'crash occurred' })).toBe(true);
    });

    it('should accept long text even without keywords', () => {
      const longAction = 'a'.repeat(60);
      const longOutcome = 'b'.repeat(60);
      expect(hasSignal({ action: longAction, outcome: longOutcome })).toBe(true);
    });

    it('should detect Korean keywords', () => {
      expect(hasSignal({ action: '빌드 실패 — 에러 발생', outcome: '수정 필요' })).toBe(true);
    });
  });

  describe('normalize', () => {
    it('should return null for empty action', () => {
      expect(normalize({ action: '', outcome: 'x' })).toBeNull();
    });

    it('should return null for empty outcome', () => {
      expect(normalize({ action: 'x', outcome: '' })).toBeNull();
    });

    it('should return null for no signal', () => {
      expect(normalize({ action: 'a', outcome: 'b' })).toBeNull();
    });

    it('should detect failure type from keywords', () => {
      const raw: RawExperience = {
        action: 'attempted build but got error',
        outcome: 'build failed completely',
      };
      const result = normalize(raw);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('failure');
    });

    it('should detect correction type from correction field', () => {
      const raw: RawExperience = {
        action: 'used wrong path for config file access',
        outcome: 'got wrong config loaded',
        correction: 'use relative path instead',
      };
      const result = normalize(raw);
      expect(result!.type).toBe('correction');
    });

    it('should detect coding_pattern category', () => {
      const raw: RawExperience = {
        action: 'wrote a new function for the code module',
        outcome: 'build passed successfully',
      };
      const result = normalize(raw);
      expect(result).not.toBeNull();
      expect(result!.category).toBe('coding_pattern');
    });

    it('should use provided agent and project', () => {
      const raw: RawExperience = {
        action: 'deployment build failed with error',
        outcome: 'deployment crashed',
        agent: 'jisoo',
        project: 'demo-project',
      };
      const result = normalize(raw);
      expect(result!.agent).toBe('jisoo');
      expect(result!.project).toBe('demo-project');
    });

    it('should default agent to unknown and project to default', () => {
      const raw: RawExperience = {
        action: 'something failed with a crash error',
        outcome: 'system went down completely',
      };
      const result = normalize(raw);
      expect(result!.agent).toBe('unknown');
      expect(result!.project).toBe('default');
    });
  });
});
