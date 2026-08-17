import { describe, expect, it } from "vitest";

import { formatSquare, parseSquare, type Square } from "@poe2/rules";

import {
  analysisLine,
  playAnalysisMove,
  redoAnalysisMove,
  resetAnalysisLine,
  seekAnalysisPly,
  undoAnalysisMove,
} from "./analysis-line.ts";

function square(notation: string): Square {
  const parsed = parseSquare(notation);
  if (parsed === null) {
    throw new RangeError(`${notation} is not a square`);
  }
  return parsed;
}

function notation(line: ReturnType<typeof analysisLine>): readonly string[] {
  return line.game.moves.map(formatSquare);
}

describe("analysis line", () => {
  it("builds and extends a legal local position", () => {
    const initial = analysisLine([square("d4"), square("a1")]);
    const next = playAnalysisMove(initial, square("e4"));

    expect(notation(next)).toEqual(["d4", "a1", "e4"]);
    expect(next.future).toEqual([]);
  });

  it("does not mutate a line when a square cannot be played", () => {
    const line = analysisLine([square("d4")]);

    expect(playAnalysisMove(line, square("d4"))).toBe(line);
  });

  it("undoes and redoes in move order", () => {
    const original = analysisLine([square("d4"), square("a1"), square("e4")]);
    const once = undoAnalysisMove(original);
    const twice = undoAnalysisMove(once);

    expect(notation(twice)).toEqual(["d4"]);
    expect(twice.future.map(formatSquare)).toEqual(["a1", "e4"]);
    expect(notation(redoAnalysisMove(twice))).toEqual(["d4", "a1"]);
  });

  it("abandons the old continuation when a new move branches", () => {
    const undone = undoAnalysisMove(analysisLine([square("d4"), square("a1"), square("e4")]));
    const branch = playAnalysisMove(undone, square("g7"));

    expect(notation(branch)).toEqual(["d4", "a1", "g7"]);
    expect(branch.future).toEqual([]);
  });

  it("seeks through one linear continuation and clamps its ends", () => {
    const original = analysisLine([square("d4"), square("a1"), square("e4"), square("a2")]);
    const earlier = seekAnalysisPly(original, 1);

    expect(notation(earlier)).toEqual(["d4"]);
    expect(earlier.future.map(formatSquare)).toEqual(["a1", "e4", "a2"]);
    expect(notation(seekAnalysisPly(earlier, 3))).toEqual(["d4", "a1", "e4"]);
    expect(notation(seekAnalysisPly(earlier, 99))).toEqual(["d4", "a1", "e4", "a2"]);
    expect(notation(seekAnalysisPly(earlier, -1))).toEqual([]);
  });

  it("reset clears both the position and its redo line", () => {
    const undone = undoAnalysisMove(analysisLine([square("d4"), square("a1")]));
    const reset = resetAnalysisLine(undone);

    expect(reset.game.moves).toEqual([]);
    expect(reset.future).toEqual([]);
  });
});
