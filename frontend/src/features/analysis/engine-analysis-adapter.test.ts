import { describe, expect, it } from "vitest";

import type { AnalysisSuccess } from "@poe2/engine-wasm";
import { parseSquare, type Square } from "@poe2/rules";

import { engineSuccess } from "../../test/engine.ts";
import {
  encodeEngineMoves,
  engineAnalysisReport,
  engineAnalysisRequest,
} from "./engine-analysis-adapter.ts";

function square(notation: string): Square {
  const parsed = parseSquare(notation);
  if (parsed === null) {
    throw new RangeError(notation);
  }
  return parsed;
}

describe("engine analysis adapter", () => {
  it("encodes the position and selected Multi-PV budget for the package API", () => {
    const moves = encodeEngineMoves([square("d4"), square("a1")]);

    expect(engineAnalysisRequest(moves, { candidateCount: 3, timePreset: "deep" })).toEqual({
      moves: ["d4", "a1"],
      searchTimeMs: 20_000,
      multiPv: 3,
    });
  });

  it("converts ranked engine strings into engine-neutral board coordinates", () => {
    const success: AnalysisSuccess = {
      ...engineSuccess("d4", -7),
      principalVariation: ["d4", "c3"],
      lines: [
        {
          rank: 1,
          move: "d4",
          equivalentMoves: ["d4", "e4"],
          evaluationHalfPoints: -7,
          principalVariation: ["d4", "c3"],
        },
        {
          rank: 2,
          move: "c4",
          equivalentMoves: ["c4"],
          evaluationHalfPoints: -3,
          principalVariation: ["c4"],
        },
      ],
    };

    expect(engineAnalysisReport(success)).toMatchObject({
      bestMove: square("d4"),
      evaluationHalfPoints: -7,
      principalVariation: [square("d4"), square("c3")],
      lines: [
        { rank: 1, move: square("d4"), equivalentMoves: [square("d4"), square("e4")] },
        { rank: 2, move: square("c4") },
      ],
      engineVersion: "0.1.0",
      apiVersion: 1,
    });
  });

  it("rejects malformed successful responses at the Worker boundary", () => {
    expect(() => engineAnalysisReport({ ...engineSuccess(), lines: [] })).toThrow(
      /without a candidate line/u,
    );
    expect(() => engineAnalysisReport({ ...engineSuccess(), bestMove: "z9" as never })).toThrow(
      /invalid square/u,
    );
  });
});
