// native.ts — Rust core native binding loader (CJS compatible)
// Loads the napi-rs compiled native addon from packages/core
//
// When Rust core is built: uses native bindings (rusqlite, SIMD)
// Fallback: uses better-sqlite3 TypeScript implementation

import { join } from 'path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { isSupportedSqliteVersion } from './sqlite-version.js';

// napi-rs native binding interface (matches lib.rs exports)
export interface NativeBinding {
  apiVersion(): number;
  sqliteVersion(): string;
  executeSql(handle: number, sql: string, valuesJson: string): number;
  querySql(handle: number, sql: string, valuesJson: string): string;
  openDatabase(dbPath: string): number;
  closeDatabase(handle: number): void;
  insertExperience(handle: number, inputJson: string): string;
  upsertExperience(handle: number, inputJson: string): string;
  getExperience(handle: number, id: string): string;
  queryExperiences(handle: number, filterJson: string): string;
  searchExperiences(handle: number, query: string, limit: number, scopeJson?: string): string;
  insertInsight(handle: number, inputJson: string): string;
  reinforceInsight(handle: number, id: string, sourcesJson: string): number;
  getInsight(handle: number, id: string): string;
  queryInsights(handle: number, filterJson: string): string;
  upvoteInsight(handle: number, id: string): void;
  downvoteInsight(handle: number, id: string): void;
  graduateInsight(handle: number, id: string, convertedType: string, convertedRef: string): void;
  setTags(handle: number, experienceId: string, tagsJson: string): void;
  getTagFrequencies(handle: number, tagsJson: string, limit: number, scopeJson?: string): string;
  findExperiencesByTags(handle: number, tagsJson: string, limit: number, scopeJson?: string): string;
  findExperiencesByTagsIntersection(handle: number, tagsLayersJson: string, limit: number, scopeJson?: string): string;
  findSimilarTags(handle: number, tag: string, autoOnly: boolean): string;
  upsertTagSimilarity(handle: number, tagA: string, tagB: string): void;
  recordEffect(handle: number, inputJson: string, applyVote?: boolean): boolean;
  getStats(handle: number): string;
  cosineSimilarity(vecAJson: string, vecBJson: string): number;
  computeWeights(timestampsJson: string, halfLifeDays: number): string;
  storeEmbedding(handle: number, sourceType: string, sourceId: string, vectorJson: string, model: string): void;
  getEmbedding(handle: number, sourceType: string, sourceId: string): string;
  getAllEmbeddings(handle: number): string;
}

/** Try to load native Rust binding, returns null if not available */
function tryLoadNative(): NativeBinding | null {
  try {
    const moduleUrl = typeof import.meta.url === 'string' ? import.meta.url : '';
    const loadModule = moduleUrl ? createRequire(moduleUrl) : require;
    const directory = moduleUrl ? fileURLToPath(new URL('.', moduleUrl)) : __dirname;
    const platformName = `n2_mimir_core.${process.platform}-${process.arch}.node`;
    // 1) Same directory (store/) — for co-located deployments
    try {
      return loadModule(join(directory, platformName)) as NativeBinding;
    } catch { /* not here */ }

    // 2) Parent directory (lib/mimir/) — standard deployment location
    try {
      return loadModule(join(directory, '..', platformName)) as NativeBinding;
    } catch { /* not here */ }

    // 3) Same directory — generic name
    try {
      return loadModule(join(directory, 'n2-mimir-core.node')) as NativeBinding;
    } catch { /* not here */ }

    // 4) Parent directory — generic name
    try {
      return loadModule(join(directory, '..', 'n2-mimir-core.node')) as NativeBinding;
    } catch { /* not here */ }

    // 5) Original packages/core path — for development
    const corePath = join(directory, '..', '..', '..', 'core');
    return loadModule(join(corePath, 'n2-mimir-core.node')) as NativeBinding;
  } catch {
    // Native binding not available — fallback to better-sqlite3
    return null;
  }
}

/** Cached native binding instance */
let _native: NativeBinding | null | undefined;

/** Get native binding or null if unavailable */
export function getNativeBinding(): NativeBinding | null {
  if (_native === undefined) {
    const candidate = tryLoadNative();
    _native = candidate?.apiVersion?.() === 3 && typeof candidate.sqliteVersion === 'function' &&
      isSupportedSqliteVersion(candidate.sqliteVersion()) ? candidate : null;
  }
  return _native;
}

/** Check if native (Rust) binding is available */
export function isNativeAvailable(): boolean {
  return getNativeBinding() !== null;
}
