import { describe, expect, it } from "vitest";

import {
  allSquares,
  formatSquare,
  marginHalfPoints,
  parseSquare,
  PLAYER_TWO_HANDICAP_HALF_POINTS,
  replay,
  scoreBoard,
  type Player,
  type Square,
} from "@poe2/rules";

import { playedGame } from "../test/fakes.ts";
import { describeProgression, lastPly, leadAt, pointAt, progression } from "./progression.ts";

function squares(notation: readonly string[]): readonly Square[] {
  return notation.map((text) => {
    const square = parseSquare(text);
    if (square === null) {
      throw new RangeError(text);
    }
    return square;
  });
}

const FULL_GAME = allSquares().map(formatSquare);

function naivePerPlyChanges(notation: readonly string[]): number {
  const points = progression(squares(notation)).points;
  let changes = 0;
  let previous: Player | null = null;

  for (const point of points) {
    if (previous !== null && point.leader !== previous) {
      changes += 1;
    }
    previous = point.leader;
  }

  return changes;
}

describe("leadAt", () => {
  it("gives Player 2 the empty board, on the handicap alone", () => {
    expect(leadAt(emptyBoard(), 0)).toStrictEqual({
      ply: 0,
      leader: 2,
      marginHalfPoints: -PLAYER_TWO_HANDICAP_HALF_POINTS,
    });
  });

  it("carries the ply it was told, so a point knows where it sits", () => {
    expect(leadAt(emptyBoard(), 7).ply).toBe(7);
  });
});

describe("progression", () => {
  it("holds one point per position, ply 0 included", () => {
    const moves = squares(["d4", "a1", "d5", "a2"]);
    const result = progression(moves);

    expect(result.points).toHaveLength(moves.length + 1);
    expect(lastPly(result)).toBe(moves.length);
    expect(result.points.map((point) => point.ply)).toStrictEqual([0, 1, 2, 3, 4]);
  });

  it("is a single point when no move has been played", () => {
    const result = progression([]);

    expect(result.points).toHaveLength(1);
    expect(result.points[0].leader).toBe(2);
    expect(result.leadChanges).toBe(0);
  });

  it("agrees with the snapshot's own margin at the position the snapshot is of", () => {
    const game = playedGame(FULL_GAME);
    const derived = progression(game.moves);

    expect(pointAt(derived, lastPly(derived)).marginHalfPoints).toBe(marginHalfPoints(game.scores));
    expect(pointAt(derived, lastPly(derived)).leader).toBe(game.outcome?.winner);
  });

  it("prices each position from the board at that ply, not the final one", () => {
    const moves = squares(["a1", "g7", "b1"]);
    const points = progression(moves).points;

    for (const [ply, point] of points.entries()) {
      const replayed = replay(moves.slice(0, ply));
      if (!replayed.ok) {
        throw new Error("fixture is not legal");
      }
      expect(point.marginHalfPoints).toBe(marginHalfPoints(scoreBoard(replayed.game.board)));
    }
  });

  it("scales to the largest lead this game actually held", () => {
    const result = progression(squares(FULL_GAME));
    const largest = Math.max(...result.points.map((p) => Math.abs(p.marginHalfPoints)));

    expect(result.peakHalfPoints).toBe(largest);
    expect(result.peakHalfPoints).toBeGreaterThanOrEqual(PLAYER_TWO_HANDICAP_HALF_POINTS);
  });

  it("rejects a move list that is not a legal game", () => {
    const twiceOnTheSameSquare = squares(["d4", "d4"]);

    expect(() => progression(twiceOnTheSameSquare)).toThrow(RangeError);
  });
});

describe("counting lead changes", () => {
  it("samples equal-material positions rather than every ply", () => {
    expect(progression(squares(FULL_GAME)).leadChanges).toBe(1);
    expect(naivePerPlyChanges(FULL_GAME)).toBe(15);
  });

  it("counts the finished board, which is where the last move decides it", () => {
    const record = squares(FULL_GAME);
    const points = progression(record).points;
    const finalLeader = points[points.length - 1]?.leader;
    const penultimateEven = points[points.length - 2]?.leader;

    expect(finalLeader).toBe(1);
    expect(penultimateEven).toBe(1);
  });
});

describe("describeProgression", () => {
  it("says the handicap is the whole story before anything is played", () => {
    const text = describeProgression(progression([]), 0, false);

    expect(text).toContain("No moves played yet");
    expect(text).toContain("Player 2 is ahead by 5½");
  });

  it("names the leader, the margin and the move it is speaking about", () => {
    const moves = squares(["d4", "a1", "d5", "a2"]);
    const text = describeProgression(progression(moves), 4, false);

    expect(text).toContain("after move 4");
    expect(text).toMatch(/Player [12] leads by/);
  });

  it("speaks of a finished game in the past, and does not invent a move number", () => {
    const moves = squares(FULL_GAME);
    const text = describeProgression(progression(moves), moves.length, true);

    expect(text).toContain("finished ahead by");
    expect(text).toContain("with the board full");
    expect(text).not.toContain("leads by");
  });

  it("counts changes in words, singular and plural", () => {
    expect(describeProgression(progression(squares(FULL_GAME)), 49, true)).toContain(
      "changed hands once",
    );
    expect(describeProgression(progression([]), 0, false)).not.toContain("changed hands");
  });
});

function emptyBoard() {
  const replayed = replay([]);
  if (!replayed.ok) {
    throw new Error("an empty move list is always legal");
  }
  return replayed.game.board;
}
