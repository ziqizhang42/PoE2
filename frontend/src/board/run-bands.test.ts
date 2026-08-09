import { describe, expect, it } from "vitest";

import { allSquares, formatSquare, parseSquare, replay, type Square } from "@poe2/rules";

import { boardRuns, MARK_LIMIT, MARK_MIN_VALUE, topRunMarks } from "./board-model.ts";

function boardAfter(notation: readonly string[]) {
  const moves: Square[] = notation.map((text) => {
    const square = parseSquare(text);
    if (square === null) {
      throw new RangeError(text);
    }
    return square;
  });

  const result = replay(moves);
  if (!result.ok) {
    throw new RangeError("illegal fixture");
  }
  return result.game.board;
}

describe("topRunMarks", () => {
  it("labels nothing on a board whose runs are all small", () => {
    const { runs } = boardRuns(boardAfter(["a1", "g7", "b1", "g6"]));

    expect(runs).not.toHaveLength(0);
    expect(topRunMarks(runs)).toHaveLength(0);
  });

  it("labels a run once it pays enough to be worth naming", () => {
    const { runs } = boardRuns(boardAfter(["a1", "g7", "b1", "g6", "c1", "g5", "d1"]));
    const marks = topRunMarks(runs);

    expect(marks).toHaveLength(1);
    expect(marks.at(0)?.value).toBe(8);
    expect(MARK_MIN_VALUE).toBe(8);
  });

  it("keeps only the biggest few, so a full board is not covered in numbers", () => {
    const { runs } = boardRuns(boardAfter(allSquares().map(formatSquare)));
    const marks = topRunMarks(runs);

    expect(runs.length).toBeGreaterThan(MARK_LIMIT);
    expect(marks).toHaveLength(MARK_LIMIT);
  });

  it("ranks by what a run pays, biggest first", () => {
    const { runs } = boardRuns(boardAfter(allSquares().map(formatSquare)));
    const values = topRunMarks(runs).map((mark) => mark.value);

    expect([...values]).toStrictEqual([...values].sort((a, b) => b - a));
  });

  it("gives every mark a distinct key, so two runs never collide", () => {
    const { runs } = boardRuns(boardAfter(allSquares().map(formatSquare)));
    const keys = topRunMarks(runs).map((mark) => mark.key);

    expect(new Set(keys).size).toBe(keys.length);
  });
});
