import { PLAYER_ONE, PLAYER_TWO, type Player, type Square } from "@poe2/rules";

import type { PositionAnalysisSettings } from "../analysis/analysis-settings.ts";
import type { EngineAnalysisReport } from "../analysis/engine-analysis.ts";

/** One completed evaluation, indexed by the replay position it describes. */
export type GameAnalysisPoint =
  | {
      readonly kind: "search";
      readonly ply: number;
      readonly report: EngineAnalysisReport;
    }
  | {
      readonly kind: "terminal";
      readonly ply: number;
      /** Exact final margin, signed and normalized to Player 1. */
      readonly evaluationHalfPoints: number;
    };

export type GameAnalysisPoints = readonly (GameAnalysisPoint | null)[];

export type GameAnalysisActivity =
  | { readonly kind: "position"; readonly ply: number }
  | { readonly kind: "game"; readonly totalPositions: number };

export interface GameAnalysisProgress {
  readonly ply: number;
  /** Latest fully completed depth; not yet a committed timeline point. */
  readonly report: EngineAnalysisReport;
}

/**
 * State produced by the replay's engine boundary. Completed points remain visible
 * during a later search and after an error.
 */
export type GameAnalysisState =
  | { readonly status: "unavailable"; readonly points: GameAnalysisPoints }
  | { readonly status: "idle"; readonly points: GameAnalysisPoints }
  | {
      readonly status: "loading";
      readonly points: GameAnalysisPoints;
      readonly activity: GameAnalysisActivity;
    }
  | {
      readonly status: "analyzing";
      readonly points: GameAnalysisPoints;
      readonly activity: GameAnalysisActivity;
      readonly progress: GameAnalysisProgress | null;
      /** Average live search throughput through the latest completed depth. */
      readonly nodesPerSecond: number | null;
    }
  | { readonly status: "ready"; readonly points: GameAnalysisPoints }
  | {
      readonly status: "error";
      readonly points: GameAnalysisPoints;
      readonly message: string;
    };

export interface GameAnalysisController {
  readonly state: GameAnalysisState;
  readonly analyzePosition: (ply: number, settings: PositionAnalysisSettings) => void;
  readonly analyzeGame: (settings: PositionAnalysisSettings) => void;
  readonly cancel: () => void;
}

export interface MoveAssessment {
  readonly ply: number;
  readonly move: Square;
  readonly mover: Player;
  readonly bestMove: Square | null;
  readonly engineChoice: boolean;
  /** Evaluation surrendered by the mover. Null until both adjacent positions exist. */
  readonly lossHalfPoints: number | null;
}

export function analysisPointAt(points: GameAnalysisPoints, ply: number): GameAnalysisPoint | null {
  return points[ply] ?? null;
}

export function evaluationAt(points: GameAnalysisPoints, ply: number): number | null {
  const point = analysisPointAt(points, ply);
  if (point === null) {
    return null;
  }
  return point.kind === "search" ? point.report.evaluationHalfPoints : point.evaluationHalfPoints;
}

export function evaluationsThrough(
  points: GameAnalysisPoints,
  finalPly: number,
): readonly (number | null)[] {
  return Array.from({ length: finalPly + 1 }, (_unused, ply) => evaluationAt(points, ply));
}

export function completedPositionCount(points: GameAnalysisPoints): number {
  return points.reduce((count, point) => count + (point === null ? 0 : 1), 0);
}

export function isGameAnalysisBusy(state: GameAnalysisState): boolean {
  return state.status === "loading" || state.status === "analyzing";
}

/** Active depth for this ply when present, otherwise its last committed result. */
export function visibleAnalysisPointAt(
  state: GameAnalysisState,
  ply: number,
): GameAnalysisPoint | null {
  if (state.status === "analyzing" && state.progress?.ply === ply) {
    return { kind: "search", ply, report: state.progress.report };
  }
  return analysisPointAt(state.points, ply);
}

/**
 * Grades move `ply` from the two surrounding Player 1-normalized evaluations.
 * Tiny depth mismatches can make a move appear to improve on the engine's prior
 * value, so apparent gains are conservatively clamped to zero loss.
 */
export function assessMove(
  points: GameAnalysisPoints,
  moves: readonly Square[],
  ply: number,
): MoveAssessment | null {
  if (ply < 1) {
    return null;
  }

  const move = moves[ply - 1];
  if (move === undefined) {
    return null;
  }

  const mover = ply % 2 === 1 ? PLAYER_ONE : PLAYER_TWO;
  const before = analysisPointAt(points, ply - 1);
  const bestMove = before?.kind === "search" ? before.report.bestMove : null;
  const equivalentBestMoves =
    before?.kind === "search" ? before.report.lines[0].equivalentMoves : [];
  const beforeEvaluation = evaluationAt(points, ply - 1);
  const afterEvaluation = evaluationAt(points, ply);
  const rawLoss =
    beforeEvaluation === null || afterEvaluation === null
      ? null
      : mover === PLAYER_ONE
        ? beforeEvaluation - afterEvaluation
        : afterEvaluation - beforeEvaluation;

  return {
    ply,
    move,
    mover,
    bestMove,
    engineChoice: equivalentBestMoves.some((candidate) => sameSquare(candidate, move)),
    lossHalfPoints: rawLoss === null ? null : Math.max(0, rawLoss),
  };
}

function sameSquare(left: Square, right: Square): boolean {
  return left.row === right.row && left.col === right.col;
}
