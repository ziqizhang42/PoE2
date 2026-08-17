import type { AnalysisRequest, AnalysisSuccess, Move } from "@poe2/engine-wasm";

import type {
  AnalysisEngineClient,
  EngineSearchCallbacks,
  EngineSearchHandle,
} from "../features/analysis/browser-engine-client.ts";

export interface FakeEngineSearch {
  readonly request: AnalysisRequest;
  readonly callbacks: EngineSearchCallbacks;
  canceled: boolean;
}

export class FakeEngineClient implements AnalysisEngineClient {
  readonly searches: FakeEngineSearch[] = [];

  analyze(request: AnalysisRequest, callbacks: EngineSearchCallbacks): EngineSearchHandle {
    const search: FakeEngineSearch = { request, callbacks, canceled: false };
    this.searches.push(search);
    return {
      cancel() {
        search.canceled = true;
      },
    };
  }
}

export function engineSuccess(
  move: Move = "d4",
  evaluationHalfPoints = 0,
  options: { readonly completedDepth?: number; readonly nodes?: number } = {},
): AnalysisSuccess {
  return {
    ok: true,
    bestMove: move,
    evaluationHalfPoints,
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
    completedDepth: options.completedDepth ?? 5,
    nodes: options.nodes ?? 12_345,
    engineVersion: "0.1.0",
    apiVersion: 1,
  };
}
