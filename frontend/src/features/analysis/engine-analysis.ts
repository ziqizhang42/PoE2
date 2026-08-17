import type { Player, Square } from "@poe2/rules";

import type { CandidatePlacementGroup } from "../../board/engine-candidate.ts";

export interface EngineCandidateLine {
  readonly rank: number;
  readonly move: Square;
  readonly equivalentMoves: readonly Square[];
  /** Signed half-points normalized to Player 1. */
  readonly evaluationHalfPoints: number;
  readonly principalVariation: readonly Square[];
}

export interface EngineAnalysisReport {
  readonly bestMove: Square;
  /** Signed half-points normalized to Player 1. */
  readonly evaluationHalfPoints: number;
  readonly completedDepth: number;
  readonly nodes: number;
  readonly principalVariation: readonly Square[];
  /** Engine-ranked root alternatives. The top-level fields alias the first line. */
  readonly lines: readonly [EngineCandidateLine, ...EngineCandidateLine[]];
  readonly engineVersion: string;
  readonly apiVersion: 1;
}

/** Engine-neutral UI state produced by the browser Worker boundary. */
export type EngineAnalysisState =
  | { readonly status: "unavailable" }
  | { readonly status: "terminal" }
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | {
      readonly status: "analyzing";
      /** Latest fully completed depth for the active request. */
      readonly progress: EngineAnalysisReport | null;
      /** Last final result, retained until the active request completes its first depth. */
      readonly previous: EngineAnalysisReport | null;
      /** Average live search throughput through the latest completed depth. */
      readonly nodesPerSecond: number | null;
    }
  | { readonly status: "ready"; readonly report: EngineAnalysisReport }
  | {
      readonly status: "error";
      readonly message: string;
      readonly previous: EngineAnalysisReport | null;
    };

export const ENGINE_UNAVAILABLE: EngineAnalysisState = { status: "unavailable" };

export function visibleEngineReport(state: EngineAnalysisState): EngineAnalysisReport | null {
  if (state.status === "ready") {
    return state.report;
  }
  if (state.status === "analyzing") {
    return state.progress ?? state.previous;
  }
  if (state.status === "error") {
    return state.previous;
  }
  return null;
}

export function isEngineAnalysisBusy(state: EngineAnalysisState): boolean {
  return state.status === "loading" || state.status === "analyzing";
}

export function candidateLineAt(report: EngineAnalysisReport, rank: number): EngineCandidateLine {
  return report.lines.find((line) => line.rank === rank) ?? report.lines[0];
}

export function candidateLossHalfPoints(
  report: EngineAnalysisReport,
  line: EngineCandidateLine,
  rootPlayer: Player,
): number {
  const best = report.lines[0].evaluationHalfPoints;
  const raw =
    rootPlayer === 1 ? best - line.evaluationHalfPoints : line.evaluationHalfPoints - best;
  return Math.max(0, raw);
}

export function candidatePlacementGroups(
  report: EngineAnalysisReport | null,
): readonly CandidatePlacementGroup[] {
  return report?.lines.map((line) => ({ rank: line.rank, squares: line.equivalentMoves })) ?? [];
}
