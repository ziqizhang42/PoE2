import { describe, expect, it } from "vitest";

import { parseSquare, type Square } from "@poe2/rules";

import type { EngineAnalysisReport } from "../analysis/engine-analysis.ts";
import {
  assessMove,
  completedPositionCount,
  evaluationAt,
  evaluationsThrough,
  type GameAnalysisPoint,
  visibleAnalysisPointAt,
} from "./game-analysis.ts";

function square(notation: string): Square {
  const parsed = parseSquare(notation);
  if (parsed === null) {
    throw new RangeError(notation);
  }
  return parsed;
}

function point(
  ply: number,
  evaluationHalfPoints: number,
  bestMove: string,
  equivalentMoves: readonly string[] = [bestMove],
): GameAnalysisPoint {
  const report: EngineAnalysisReport = {
    bestMove: square(bestMove),
    evaluationHalfPoints,
    completedDepth: 5,
    nodes: 1_000,
    principalVariation: [square(bestMove)],
    lines: [
      {
        rank: 1,
        move: square(bestMove),
        equivalentMoves: equivalentMoves.map(square),
        evaluationHalfPoints,
        principalVariation: [square(bestMove)],
      },
    ],
    engineVersion: "0.2.0",
    apiVersion: 1,
  };
  return { kind: "search", ply, report };
}

describe("game analysis model", () => {
  it("keeps sparse results indexed by replay ply", () => {
    const points = [point(0, -3, "d4"), null, point(2, 5, "e4")];

    expect(evaluationAt(points, 0)).toBe(-3);
    expect(evaluationAt(points, 1)).toBeNull();
    expect(evaluationsThrough(points, 4)).toEqual([-3, null, 5, null, null]);
    expect(completedPositionCount(points)).toBe(2);
  });

  it("reads a full-board point as an exact terminal evaluation", () => {
    const terminal: GameAnalysisPoint = {
      kind: "terminal",
      ply: 2,
      evaluationHalfPoints: -7,
    };

    expect(evaluationAt([null, null, terminal], 2)).toBe(-7);
  });

  it("keeps a streamed depth visible without counting it as a completed position", () => {
    const progress = point(1, 3, "a1");
    if (progress.kind !== "search") {
      throw new TypeError("fixture is a search point");
    }
    const state = {
      status: "analyzing" as const,
      points: [point(0, 1, "d4"), null],
      activity: { kind: "position" as const, ply: 1 },
      progress: { ply: 1, report: progress.report },
      nodesPerSecond: 4_000_000,
    };

    expect(completedPositionCount(state.points)).toBe(1);
    expect(evaluationAt(state.points, 1)).toBeNull();
    expect(visibleAnalysisPointAt(state, 1)).toMatchObject({ kind: "search", ply: 1 });
  });

  it("grades Player 1 and Player 2 moves in their own direction", () => {
    const moves = [square("d4"), square("a1")];
    const playerOne = assessMove([point(0, 5, "c3"), point(1, 1, "a1")], moves, 1);
    const playerTwo = assessMove([null, point(1, 1, "a1"), point(2, 5, "e4")], moves, 2);

    expect(playerOne).toMatchObject({ mover: 1, engineChoice: false, lossHalfPoints: 4 });
    expect(playerTwo).toMatchObject({ mover: 2, engineChoice: true, lossHalfPoints: 4 });
  });

  it("recognizes every symmetric placement in the first ranked group as an engine choice", () => {
    const assessment = assessMove(
      [point(0, 5, "d4", ["d4", "e4"]), point(1, 5, "a1")],
      [square("e4")],
      1,
    );

    expect(assessment).toMatchObject({ engineChoice: true, bestMove: square("d4") });
  });

  it("clamps apparent search-depth gains instead of reporting a negative move cost", () => {
    const assessment = assessMove([point(0, 1, "d4"), point(1, 3, "a1")], [square("d4")], 1);

    expect(assessment).toMatchObject({ engineChoice: true, lossHalfPoints: 0 });
  });
});
