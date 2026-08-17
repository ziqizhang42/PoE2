import { afterEach, describe, expect, it } from "vitest";

import type { EngineAnalysisReport } from "./engine-analysis.ts";
import {
  cacheEngineAnalysisProgress,
  cacheEngineAnalysisResult,
  clearEngineAnalysisCache,
  ENGINE_ANALYSIS_CACHE_TTL_MS,
  readCachedEngineAnalysis,
} from "./engine-analysis-cache.ts";

const FAST = { candidateCount: 1, timePreset: "fast" } as const;
const DEEP = { candidateCount: 1, timePreset: "deep" } as const;

afterEach(clearEngineAnalysisCache);

describe("engine analysis cache", () => {
  it("reuses completed searches at the same or shorter budget", () => {
    cacheEngineAnalysisResult([], FAST, report(10_000, 3), 100);

    expect(readCachedEngineAnalysis([], FAST, 101)).toMatchObject({
      report: { nodes: 10_000, evaluationHalfPoints: 3 },
      satisfiesRequest: true,
    });
    expect(readCachedEngineAnalysis([], DEEP, 102)).toMatchObject({
      report: { nodes: 10_000 },
      satisfiesRequest: false,
    });
  });

  it("keeps the higher-node value even when a later completion searched less", () => {
    cacheEngineAnalysisResult([], FAST, report(10_000, 3), 100);
    cacheEngineAnalysisProgress([], DEEP, report(20_000, -5), 101);
    cacheEngineAnalysisResult([], DEEP, report(15_000, 7), 102);

    expect(readCachedEngineAnalysis([], DEEP, 103)).toMatchObject({
      report: { nodes: 20_000, evaluationHalfPoints: -5 },
      satisfiesRequest: true,
    });
  });

  it("forgets an untouched entry after fifteen minutes", () => {
    cacheEngineAnalysisResult([], FAST, report(10_000, 3), 100);

    expect(readCachedEngineAnalysis([], FAST, 100 + ENGINE_ANALYSIS_CACHE_TTL_MS)).toBeNull();
  });
});

function report(nodes: number, evaluationHalfPoints: number): EngineAnalysisReport {
  const move = { row: 3, col: 3 };
  return {
    bestMove: move,
    evaluationHalfPoints,
    completedDepth: 5,
    nodes,
    principalVariation: [move],
    lines: [
      {
        rank: 1,
        move,
        equivalentMoves: [move],
        evaluationHalfPoints,
        principalVariation: [move],
      },
    ],
    engineVersion: "0.2.0",
    apiVersion: 1,
  };
}
