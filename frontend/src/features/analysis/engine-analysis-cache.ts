import type { Move } from "@poe2/engine-wasm";

import type { PositionAnalysisSettings } from "./analysis-settings.ts";
import type { EngineAnalysisReport } from "./engine-analysis.ts";

export const ENGINE_ANALYSIS_CACHE_TTL_MS = 15 * 60 * 1_000;
export const ENGINE_ANALYSIS_CACHE_MAX_POSITIONS = 128;

export interface CachedEngineAnalysis {
  readonly report: EngineAnalysisReport;
  /** True when a completed search used at least the requested time budget. */
  readonly satisfiesRequest: boolean;
}

interface CacheEntry {
  readonly report: EngineAnalysisReport;
  readonly completedSearchTimeMs: number;
  readonly lastUsedAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * A small tab-local LRU cache. Candidate count belongs in the key because
 * single-PV and Multi-PV searches are different engine requests.
 */
export function readCachedEngineAnalysis(
  moves: readonly Move[],
  settings: PositionAnalysisSettings,
  now = Date.now(),
): CachedEngineAnalysis | null {
  const key = cacheKey(moves, settings);
  const entry = cache.get(key);
  if (entry === undefined) {
    return null;
  }
  if (now - entry.lastUsedAt >= ENGINE_ANALYSIS_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }

  const touched = { ...entry, lastUsedAt: now };
  cache.delete(key);
  cache.set(key, touched);
  return {
    report: touched.report,
    satisfiesRequest: touched.completedSearchTimeMs >= settings.searchTimeMs,
  };
}

/** Keeps a streamed completed depth, without claiming its request finished. */
export function cacheEngineAnalysisProgress(
  moves: readonly Move[],
  settings: PositionAnalysisSettings,
  report: EngineAnalysisReport,
  now = Date.now(),
): EngineAnalysisReport {
  return store(moves, settings, report, 0, now);
}

/** Records a finished request while retaining any result that searched more nodes. */
export function cacheEngineAnalysisResult(
  moves: readonly Move[],
  settings: PositionAnalysisSettings,
  report: EngineAnalysisReport,
  now = Date.now(),
): EngineAnalysisReport {
  return store(moves, settings, report, settings.searchTimeMs, now);
}

/** Test and hot-reload escape hatch; ordinary UI code never needs to clear the cache. */
export function clearEngineAnalysisCache(): void {
  cache.clear();
}

function store(
  moves: readonly Move[],
  settings: PositionAnalysisSettings,
  candidate: EngineAnalysisReport,
  completedSearchTimeMs: number,
  now: number,
): EngineAnalysisReport {
  pruneExpired(now);
  const key = cacheKey(moves, settings);
  const current = cache.get(key);
  const compatibleCurrent =
    current?.report.engineVersion === candidate.engineVersion &&
    current.report.apiVersion === candidate.apiVersion
      ? current
      : undefined;
  const report =
    compatibleCurrent === undefined || candidate.nodes > compatibleCurrent.report.nodes
      ? candidate
      : compatibleCurrent.report;
  const next: CacheEntry = {
    report,
    completedSearchTimeMs: Math.max(
      compatibleCurrent?.completedSearchTimeMs ?? 0,
      completedSearchTimeMs,
    ),
    lastUsedAt: now,
  };

  cache.delete(key);
  cache.set(key, next);
  trimOldest();
  return report;
}

function cacheKey(moves: readonly Move[], settings: PositionAnalysisSettings): string {
  return `${String(settings.candidateCount)}|${moves.join(",")}`;
}

function pruneExpired(now: number): void {
  for (const [key, entry] of cache) {
    if (now - entry.lastUsedAt >= ENGINE_ANALYSIS_CACHE_TTL_MS) {
      cache.delete(key);
    }
  }
}

function trimOldest(): void {
  while (cache.size > ENGINE_ANALYSIS_CACHE_MAX_POSITIONS) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) {
      return;
    }
    cache.delete(oldest);
  }
}
