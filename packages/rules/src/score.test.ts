import { describe, expect, it } from "vitest";

import {
  allSquares,
  BOARD_SIZE,
  createEmptyBoard,
  placePiece,
  PLAYER_ONE,
  PLAYER_TWO,
  squareIndex,
} from "./board.js";
import type { Board, Player, Square } from "./board.js";
import {
  leaderAfterHandicap,
  lineScore,
  marginHalfPoints,
  MAX_LINE_LENGTH,
  playerBreakdown,
  PLAYER_TWO_HANDICAP_HALF_POINTS,
  resultIfFull,
  scoreBoard,
  scoreBreakdown,
  scorePlayer,
} from "./score.js";

/** `[row, col]`, so the board fixtures read the same as the engine's tests. */
type Coord = readonly [row: number, col: number];

function square([row, col]: Coord): Square {
  return { row, col };
}

function boardWith(playerOne: readonly Coord[], playerTwo: readonly Coord[] = []): Board {
  let board = createEmptyBoard();
  for (const coord of playerOne) {
    board = placePiece(board, PLAYER_ONE, square(coord));
  }
  for (const coord of playerTwo) {
    board = placePiece(board, PLAYER_TWO, square(coord));
  }
  return board;
}

function checkerboard(): Board {
  let board = createEmptyBoard();
  for (const target of allSquares()) {
    const player: Player = (target.row + target.col) % 2 === 0 ? PLAYER_ONE : PLAYER_TWO;
    board = placePiece(board, player, target);
  }
  return board;
}

function filledWith(player: Player): Board {
  let board = createEmptyBoard();
  for (const target of allSquares()) {
    board = placePiece(board, player, target);
  }
  return board;
}

describe("lineScore", () => {
  it.each([
    [1, 1],
    [2, 2],
    [3, 4],
    [4, 8],
    [5, 16],
    [6, 32],
    [7, 64],
  ])("scores a line of length %i as %i", (length, expected) => {
    expect(lineScore(length)).toBe(expected);
  });

  it.each([0, -1, 1.5, 8, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid line length %s",
    (length) => {
      expect(() => lineScore(length)).toThrow(RangeError);
    },
  );
});

describe("scorePlayer", () => {
  it("scores an empty board as nothing for either player", () => {
    expect(scoreBoard(createEmptyBoard())).toEqual({ playerOne: 0, playerTwo: 0 });
  });

  it("counts isolated pieces as one point each", () => {
    const board = boardWith([
      [0, 0],
      [2, 3],
    ]);

    expect(scorePlayer(board, PLAYER_ONE)).toBe(2);
    expect(scorePlayer(board, PLAYER_TWO)).toBe(0);
  });

  it("makes diagonal neighbours a run instead of two singletons", () => {
    const board = boardWith([
      [0, 0],
      [1, 1],
    ]);
    const breakdown = playerBreakdown(board, PLAYER_ONE);

    expect(breakdown.total).toBe(2);
    expect(breakdown.singletons).toEqual([]);
    expect(breakdown.runs).toHaveLength(1);
    expect(breakdown.runs[0]?.direction).toBe("diagonal-up-right");
  });

  it("scores one maximal horizontal run without counting its subsets", () => {
    const board = boardWith([
      [1, 1],
      [1, 2],
      [1, 3],
      [1, 4],
    ]);
    const breakdown = playerBreakdown(board, PLAYER_ONE);

    expect(breakdown.total).toBe(8);
    expect(breakdown.runs).toHaveLength(1);
    expect(breakdown.runs[0]?.length).toBe(4);
    expect(breakdown.runs[0]?.value).toBe(8);
  });

  it("scores separated runs in the same row independently", () => {
    const board = boardWith([
      [2, 0],
      [2, 1],
      [2, 3],
      [2, 4],
      [2, 5],
    ]);
    const breakdown = playerBreakdown(board, PLAYER_ONE);

    expect(breakdown.total).toBe(6);
    expect(breakdown.runs.map((run) => run.length).sort()).toEqual([2, 3]);
  });

  it("lets opponent pieces split a run", () => {
    const board = boardWith(
      [
        [0, 0],
        [0, 1],
        [0, 3],
        [0, 4],
      ],
      [[0, 2]],
    );

    expect(scorePlayer(board, PLAYER_ONE)).toBe(4);
    expect(scorePlayer(board, PLAYER_TWO)).toBe(1);
  });

  it("scores crossing lines in every direction they create", () => {
    const board = boardWith([
      [3, 1],
      [3, 2],
      [3, 3],
      [1, 3],
      [2, 3],
    ]);

    expect(scorePlayer(board, PLAYER_ONE)).toBe(10);
  });

  it("counts every length-two axis a corner triangle creates", () => {
    const board = boardWith([
      [0, 0],
      [0, 1],
      [1, 0],
    ]);
    const breakdown = playerBreakdown(board, PLAYER_ONE);

    expect(breakdown.total).toBe(6);
    expect(breakdown.singletons).toEqual([]);
    expect(breakdown.runs).toHaveLength(3);
    expect(breakdown.runs.every((run) => run.length === 2)).toBe(true);
    expect(new Set(breakdown.runs.map((run) => run.direction)).size).toBe(3);
  });

  it("scores both diagonal directions", () => {
    const board = boardWith([
      [1, 1],
      [2, 2],
      [3, 3],
      [1, 5],
      [2, 4],
    ]);
    const breakdown = playerBreakdown(board, PLAYER_ONE);

    expect(breakdown.total).toBe(8);
    expect(new Set(breakdown.runs.map((run) => run.direction))).toEqual(
      new Set(["diagonal-up-right", "diagonal-up-left"]),
    );
  });

  it("scores an edge-to-edge diagonal as one maximal run", () => {
    const board = boardWith(
      [],
      [
        [0, 6],
        [1, 5],
        [2, 4],
        [3, 3],
        [4, 2],
        [5, 1],
        [6, 0],
      ],
    );
    const breakdown = playerBreakdown(board, PLAYER_TWO);

    expect(scorePlayer(board, PLAYER_ONE)).toBe(0);
    expect(breakdown.total).toBe(64);
    expect(breakdown.runs).toHaveLength(1);
    expect(breakdown.runs[0]?.length).toBe(MAX_LINE_LENGTH);
    expect(breakdown.runs[0]?.direction).toBe("diagonal-up-left");
  });

  it("scores a messy mixed board using only maximal runs and true singletons", () => {
    // P1: 4 + 2 + 2 + 64 + 2 + 1. P2: 8 + 2 + 2 + 1.
    const board = boardWith(
      [
        [0, 0],
        [0, 1],
        [0, 2],
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 4],
        [5, 5],
        [6, 6],
        [3, 0],
        [4, 0],
        [6, 2],
      ],
      [
        [0, 5],
        [1, 5],
        [2, 5],
        [3, 5],
        [2, 0],
        [2, 1],
        [4, 2],
        [5, 3],
        [5, 0],
      ],
    );

    expect(scoreBoard(board)).toEqual({ playerOne: 75, playerTwo: 13 });
  });

  it("scores every diagonal run on a dense checkerboard", () => {
    // P1 owns diagonal lengths 3, 5, 7, 5, 3 on each diagonal axis.
    // P2 owns diagonal lengths 2, 4, 6, 6, 4, 2 on each diagonal axis.
    expect(scoreBoard(checkerboard())).toEqual({ playerOne: 208, playerTwo: 168 });
  });

  it("reports both players from one board", () => {
    const board = boardWith(
      [
        [0, 0],
        [0, 1],
      ],
      [
        [2, 0],
        [2, 1],
        [2, 2],
      ],
    );

    expect(scoreBoard(board)).toEqual({ playerOne: 2, playerTwo: 4 });
  });
});

describe("scoreBreakdown", () => {
  it("splits each player's total into runs and singletons", () => {
    const board = boardWith(
      [
        [0, 0],
        [0, 1],
        [4, 4],
      ],
      [[6, 0]],
    );
    const breakdown = scoreBreakdown(board);

    expect(breakdown.playerOne).toMatchObject({ total: 3, runTotal: 2, singletonTotal: 1 });
    expect(breakdown.playerOne.singletons).toEqual([{ row: 4, col: 4 }]);
    expect(breakdown.playerTwo).toMatchObject({ total: 1, runTotal: 0, singletonTotal: 1 });
  });

  it("never counts a piece as both a run member and a singleton", () => {
    const board = checkerboard();

    for (const player of [PLAYER_ONE, PLAYER_TWO] as const) {
      const breakdown = playerBreakdown(board, player);
      const inRun = new Set(
        breakdown.runs.flatMap((run) => run.squares.map((member) => squareIndex(member))),
      );

      expect(breakdown.total).toBe(breakdown.runTotal + breakdown.singletonTotal);
      expect(breakdown.runTotal).toBe(breakdown.runs.reduce((sum, run) => sum + run.value, 0));
      expect(breakdown.singletonTotal).toBe(breakdown.singletons.length);
      expect(breakdown.singletons.some((single) => inRun.has(squareIndex(single)))).toBe(false);
    }
  });

  it("gives each run a length between two and the board size", () => {
    const board = checkerboard();
    const runs = [
      ...playerBreakdown(board, PLAYER_ONE).runs,
      ...playerBreakdown(board, PLAYER_TWO).runs,
    ];

    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run.length).toBe(run.squares.length);
      expect(run.length).toBeGreaterThanOrEqual(2);
      expect(run.length).toBeLessThanOrEqual(BOARD_SIZE);
      expect(run.value).toBe(lineScore(run.length));
    }
  });
});

describe("leaderAfterHandicap", () => {
  it("keeps Player 2's handicap at exactly 11 half-points", () => {
    expect(PLAYER_TWO_HANDICAP_HALF_POINTS).toBe(11);
  });

  it("gives Player 1 a six-point lead and Player 2 a five-point deficit", () => {
    expect(leaderAfterHandicap({ playerOne: 10, playerTwo: 4 })).toBe(PLAYER_ONE);
    expect(leaderAfterHandicap({ playerOne: 10, playerTwo: 5 })).toBe(PLAYER_TWO);
  });

  it("gives Player 2 an equal raw score", () => {
    expect(leaderAfterHandicap({ playerOne: 0, playerTwo: 0 })).toBe(PLAYER_TWO);
    expect(leaderAfterHandicap({ playerOne: 208, playerTwo: 208 })).toBe(PLAYER_TWO);
  });

  it("can never draw, because the half-point margin is always odd", () => {
    for (const playerOne of [0, 1, 7, 75, 208, 1272]) {
      for (const playerTwo of [0, 1, 13, 168, 500]) {
        const margin = marginHalfPoints({ playerOne, playerTwo });

        expect(Math.abs(margin) % 2).toBe(1);
        expect(margin).not.toBe(0);
        expect(leaderAfterHandicap({ playerOne, playerTwo })).toBe(
          margin > 0 ? PLAYER_ONE : PLAYER_TWO,
        );
      }
    }
  });
});

describe("resultIfFull", () => {
  it("has no result while the board has empty squares", () => {
    expect(resultIfFull(createEmptyBoard())).toBeNull();
    expect(resultIfFull(boardWith([[0, 0]]))).toBeNull();
  });

  it("reports raw scores and the winner for a full board", () => {
    const result = resultIfFull(filledWith(PLAYER_ONE));

    expect(result).not.toBeNull();
    expect(result?.scores).toEqual({ playerOne: 1272, playerTwo: 0 });
    expect(result?.winner).toBe(PLAYER_ONE);
    expect(result?.marginHalfPoints).toBe(1272 * 2 - 11);
  });

  it("reports the checkerboard winner from integer half-points", () => {
    const result = resultIfFull(checkerboard());

    expect(result?.scores).toEqual({ playerOne: 208, playerTwo: 168 });
    expect(result?.marginHalfPoints).toBe(208 * 2 - (168 * 2 + 11));
    expect(result?.winner).toBe(PLAYER_ONE);
  });
});
