import { describe, expect, it } from "vitest";

import { allSquares, createEmptyBoard, formatSquare, parseSquare, replay } from "@poe2/rules";

import {
  exponentLadder,
  playerSide,
  rungBarPercent,
  RUNG_LENGTHS,
  type LadderRung,
} from "./exponent-ladder-model.ts";

function boardAfter(notation: readonly string[]) {
  const moves = notation.map((text) => {
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

function rung(rungs: readonly LadderRung[], value: number): LadderRung {
  const found = rungs.find((candidate) => candidate.value === value);
  if (found === undefined) {
    throw new Error(`no rung pays ${String(value)}`);
  }
  return found;
}

describe("exponentLadder", () => {
  it("has one rung per run length, longest first", () => {
    const { rungs } = exponentLadder(createEmptyBoard());

    expect([...RUNG_LENGTHS]).toStrictEqual([7, 6, 5, 4, 3, 2, 1]);
    expect(rungs.map((r) => r.value)).toStrictEqual([64, 32, 16, 8, 4, 2, 1]);
    expect(rungs.map((r) => r.length)).toStrictEqual([7, 6, 5, 4, 3, 2, 1]);
  });

  it("is empty on an empty board, and scales to nothing", () => {
    const ladder = exponentLadder(createEmptyBoard());

    expect(ladder.totalRuns).toBe(0);
    expect(ladder.peakPoints).toBe(0);
    for (const r of ladder.rungs) {
      expect(r.playerOne).toStrictEqual({ count: 0, points: 0 });
      expect(r.playerTwo).toStrictEqual({ count: 0, points: 0 });
    }
  });

  it("counts a run of three on the rung that pays four, and nowhere else", () => {
    const { rungs } = exponentLadder(boardAfter(["a1", "g7", "b1", "g6", "c1"]));

    expect(rung(rungs, 4).playerOne.count).toBe(1);
    expect(rung(rungs, 4).playerOne.points).toBe(4);
    expect(rung(rungs, 2).playerOne.count).toBe(0);
  });

  it("takes the bottom rung from pieces in no run, not from runs", () => {
    const { rungs } = exponentLadder(boardAfter(["a1", "g1", "b1", "e4"]));

    expect(rung(rungs, 1).playerTwo).toStrictEqual({ count: 2, points: 2 });
    expect(rung(rungs, 1).playerOne).toStrictEqual({ count: 0, points: 0 });
  });

  it("does not count a piece that is in a run as scoring alone", () => {
    const { rungs } = exponentLadder(boardAfter(["a1", "g1", "b1", "e4"]));

    expect(rung(rungs, 2).playerOne.count).toBe(1);
    expect(rung(rungs, 1).playerOne.count).toBe(0);
  });

  it("scales to the most any one player draws from one rung", () => {
    const ladder = exponentLadder(boardAfter(allSquares().map(formatSquare)));
    const every = ladder.rungs.flatMap((r) => [r.playerOne.points, r.playerTwo.points]);

    expect(ladder.peakPoints).toBe(Math.max(...every));
    expect(ladder.peakPoints).toBeGreaterThan(64);
  });

  it("counts every run on the board exactly once across the rungs", () => {
    const board = boardAfter(allSquares().map(formatSquare));
    const ladder = exponentLadder(board);
    const counted = ladder.rungs
      .filter((r) => r.length > 1)
      .reduce((total, r) => total + r.playerOne.count + r.playerTwo.count, 0);

    expect(counted).toBe(ladder.totalRuns);
  });
});

describe("rungBarPercent", () => {
  it("is nothing when a rung scores nothing", () => {
    expect(rungBarPercent(0, 64)).toBe(0);
    expect(rungBarPercent(0, 0)).toBe(0);
  });

  it("is the share of the widest rung", () => {
    expect(rungBarPercent(32, 64)).toBe(50);
    expect(rungBarPercent(64, 64)).toBe(100);
  });

  it("floors a rung that scores at all, so it is never drawn as empty", () => {
    expect(rungBarPercent(1, 1000)).toBe(5);
  });
});

describe("playerSide", () => {
  it("reads the side belonging to a player rather than by position", () => {
    const { rungs } = exponentLadder(boardAfter(["a1", "g1", "b1", "e4"]));
    const two = rung(rungs, 2);

    expect(playerSide(two, 1)).toBe(two.playerOne);
    expect(playerSide(two, 2)).toBe(two.playerTwo);
  });
});
