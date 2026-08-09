import { describe, expect, it } from "vitest";

import { parseSquare, replay, squareIndex, type Square } from "@poe2/rules";

import {
  boardRuns,
  gainsForSideToMove,
  RANKS,
  runBand,
  runMark,
  sameSquare,
  squareCentre,
} from "./board-model.ts";

function squares(notation: readonly string[]): readonly Square[] {
  return notation.map((text) => {
    const square = parseSquare(text);
    if (square === null) {
      throw new RangeError(text);
    }
    return square;
  });
}

function boardAfter(notation: readonly string[]) {
  const result = replay(squares(notation));
  if (!result.ok) {
    throw new RangeError("illegal fixture");
  }
  return result.game;
}

describe("board geometry", () => {
  it("draws rank 7 first, because row 0 is rank 1", () => {
    expect([...RANKS]).toStrictEqual([6, 5, 4, 3, 2, 1, 0]);
  });

  it("puts a1 at the bottom left and g7 at the top right", () => {
    expect(squareCentre({ row: 0, col: 0 })).toStrictEqual({ x: 50, y: 650 });
    expect(squareCentre({ row: 6, col: 6 })).toStrictEqual({ x: 650, y: 50 });
  });

  it("bands a run from its first square to its last", () => {
    const { runs } = boardRuns(boardAfter(["a1", "g7", "b1"]).board);
    const run = runs.at(0);

    if (run === undefined) {
      throw new Error("expected a run of two");
    }

    expect(run.length).toBe(2);
    expect(runBand(run)).toStrictEqual({ x1: 50, y1: 650, x2: 150, y2: 650 });
  });
});

describe("runMark", () => {
  it("puts an even-length run's label in the gap at its midpoint", () => {
    const { runs } = boardRuns(boardAfter(["a1", "g7", "b1"]).board);
    const run = runs.at(0);

    if (run === undefined) {
      throw new Error("expected a run of two");
    }

    const mark = runMark(run, "k");
    expect(mark).toStrictEqual({ key: "k", x: 100, y: 650, value: 2 });
  });

  it("slides an odd-length run's label half a square, off the middle counter", () => {
    const { runs } = boardRuns(boardAfter(["a1", "g7", "b1", "g6", "c1"]).board);
    const run = runs.find((candidate) => candidate.length === 3);

    if (run === undefined) {
      throw new Error("expected a run of three");
    }

    const mark = runMark(run, "k");
    expect(mark.x).toBe(200);
    expect(mark.y).toBe(650);
    expect(mark.value).toBe(4);
  });

  it("slides along a diagonal in both axes, not just one", () => {
    const { runs } = boardRuns(boardAfter(["a1", "g7", "b2", "g6", "c3"]).board);
    const run = runs.find(
      (candidate) => candidate.length === 3 && candidate.direction === "diagonal-up-right",
    );

    if (run === undefined) {
      throw new Error("expected a diagonal run of three");
    }

    const mark = runMark(run, "k");
    expect(mark.x).toBeCloseTo(150 + 50 / Math.SQRT2);
    expect(mark.y).toBeCloseTo(550 - 50 / Math.SQRT2);
  });
});

describe("boardRuns", () => {
  it("separates pieces in a run from pieces scoring on their own", () => {
    const { runs, singletons } = boardRuns(boardAfter(["a1", "g1", "a2", "g3"]).board);

    expect(runs).toHaveLength(1);
    expect(runs.at(0)?.player).toBe(1);
    expect(runs.at(0)?.value).toBe(2);

    expect(singletons.has(squareIndex({ row: 0, col: 6 }))).toBe(true);
    expect(singletons.has(squareIndex({ row: 2, col: 6 }))).toBe(true);
    expect(singletons.has(squareIndex({ row: 0, col: 0 }))).toBe(false);
  });
});

describe("gainsForSideToMove", () => {
  it("prices every empty square for whoever is to move", () => {
    const game = boardAfter(["d4", "a1", "d6", "a2"]);
    const gains = gainsForSideToMove(game.board, game.moves);

    expect(gains.get(squareIndex({ row: 4, col: 3 }))).toBe(2);
    expect(gains.get(squareIndex({ row: 6, col: 6 }))).toBe(1);
  });

  it("prices nothing on a square that is taken", () => {
    const game = boardAfter(["d4"]);
    const gains = gainsForSideToMove(game.board, game.moves);

    expect(gains.has(squareIndex({ row: 3, col: 3 }))).toBe(false);
  });
});

describe("sameSquare", () => {
  it("compares by coordinate rather than by identity", () => {
    expect(sameSquare({ row: 2, col: 3 }, { row: 2, col: 3 })).toBe(true);
    expect(sameSquare({ row: 2, col: 3 }, { row: 3, col: 2 })).toBe(false);
  });
});
