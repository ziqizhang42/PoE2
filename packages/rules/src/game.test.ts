import { describe, expect, it } from "vitest";

import { allSquares, cellAt, CELL_COUNT, EMPTY, PLAYER_ONE, PLAYER_TWO } from "./board.js";
import type { Square } from "./board.js";
import {
  applyMove,
  createGame,
  gameResult,
  isGameOver,
  legalMoves,
  ply,
  replay,
  sideToMove,
} from "./game.js";
import type { Game } from "./game.js";
import { scoreBoard } from "./score.js";

/** `[row, col]`, so move sequences read the same as the engine's tests. */
type Coord = readonly [row: number, col: number];

function square([row, col]: Coord): Square {
  return { row, col };
}

/** Applies every move in order, failing the test on the first rejection. */
function play(game: Game, coords: readonly Coord[]): Game {
  return coords.reduce((current, coord) => {
    const result = applyMove(current, square(coord));

    expect(result.accepted).toBe(true);
    if (!result.accepted) {
      throw new Error(`move ${JSON.stringify(coord)} was rejected`);
    }
    return result.game;
  }, game);
}

const rowMajorOrder: readonly Coord[] = allSquares().map((target) => [target.row, target.col]);

describe("createGame", () => {
  it("starts empty with Player 1 to move", () => {
    const game = createGame();

    expect(game.board).toHaveLength(CELL_COUNT);
    expect(game.board.every((cell) => cell === EMPTY)).toBe(true);
    expect(game.moves).toEqual([]);
    expect(ply(game)).toBe(0);
    expect(sideToMove(game)).toBe(PLAYER_ONE);
    expect(isGameOver(game)).toBe(false);
    expect(gameResult(game)).toBeNull();
    expect(legalMoves(game)).toHaveLength(CELL_COUNT);
  });
});

describe("applyMove", () => {
  it("alternates players across legal moves", () => {
    const first = applyMove(createGame(), { row: 0, col: 0 });
    expect(first.accepted).toBe(true);
    expect(ply(first.game)).toBe(1);
    expect(sideToMove(first.game)).toBe(PLAYER_TWO);
    expect(cellAt(first.game.board, { row: 0, col: 0 })).toBe(PLAYER_ONE);
    expect(first.result).toBeNull();

    const second = applyMove(first.game, { row: 0, col: 1 });
    expect(second.accepted).toBe(true);
    expect(ply(second.game)).toBe(2);
    expect(sideToMove(second.game)).toBe(PLAYER_ONE);
    expect(cellAt(second.game.board, { row: 0, col: 1 })).toBe(PLAYER_TWO);
  });

  it("records the move history as squares", () => {
    const game = play(createGame(), [
      [0, 0],
      [6, 6],
      [3, 2],
    ]);

    expect(game.moves).toEqual([
      { row: 0, col: 0 },
      { row: 6, col: 6 },
      { row: 3, col: 2 },
    ]);
  });

  it("removes the played square from the legal moves", () => {
    const game = play(createGame(), [[2, 4]]);

    expect(legalMoves(game)).toHaveLength(CELL_COUNT - 1);
    expect(legalMoves(game)).not.toContainEqual({ row: 2, col: 4 });
  });

  it("never mutates the game it was given or its arrays", () => {
    const game = createGame();
    const board = [...game.board];
    const moves = [...game.moves];

    const next = applyMove(game, { row: 3, col: 3 });

    expect(next.game).not.toBe(game);
    expect(next.game.board).not.toBe(game.board);
    expect(next.game.moves).not.toBe(game.moves);
    expect([...game.board]).toEqual(board);
    expect([...game.moves]).toEqual(moves);
    expect(ply(game)).toBe(0);
    expect(sideToMove(game)).toBe(PLAYER_ONE);
  });

  it("keeps the history intact when the caller mutates the square afterwards", () => {
    const offered = { row: 0, col: 0 };
    const accepted = applyMove(createGame(), offered);

    offered.row = 6;
    offered.col = 3;

    expect(accepted.game.moves).toEqual([{ row: 0, col: 0 }]);
    expect(accepted.game.moves[0]).not.toBe(offered);
    expect(cellAt(accepted.game.board, { row: 0, col: 0 })).toBe(PLAYER_ONE);
    expect(cellAt(accepted.game.board, { row: 6, col: 3 })).toBe(EMPTY);
    const replayed = replay(accepted.game.moves);
    expect(replayed.ok && replayed.game.board).toEqual(accepted.game.board);
  });

  it("leaves the original state untouched when it rejects an occupied square", () => {
    const game = play(createGame(), [[0, 0]]);
    const rejected = applyMove(game, { row: 0, col: 0 });

    expect(rejected.accepted).toBe(false);
    expect(rejected.accepted ? null : rejected.error).toBe("occupied");
    expect(rejected.game).toBe(game);
    expect(rejected.result).toBeNull();
    expect(ply(game)).toBe(1);
    expect(sideToMove(game)).toBe(PLAYER_TWO);
  });

  it.each([
    { row: -1, col: 0 },
    { row: 0, col: -1 },
    { row: 7, col: 0 },
    { row: 0, col: 7 },
  ])("leaves the original state untouched when it rejects %o", (target) => {
    const game = play(createGame(), [[0, 0]]);
    const rejected = applyMove(game, target);

    expect(rejected.accepted).toBe(false);
    expect(rejected.accepted ? null : rejected.error).toBe("out_of_bounds");
    expect(rejected.game).toBe(game);
    expect(ply(game)).toBe(1);
    expect(sideToMove(game)).toBe(PLAYER_TWO);
  });

  it("keeps scores unchanged after a rejected repeat", () => {
    const game = play(createGame(), [
      [0, 0],
      [6, 6],
      [0, 1],
      [5, 5],
      [0, 3],
      [4, 4],
      [0, 2],
    ]);

    expect(scoreBoard(game.board)).toEqual({ playerOne: 8, playerTwo: 4 });

    const rejected = applyMove(game, { row: 0, col: 2 });

    expect(rejected.accepted).toBe(false);
    expect(ply(rejected.game)).toBe(7);
    expect(sideToMove(rejected.game)).toBe(PLAYER_TWO);
    expect(scoreBoard(rejected.game.board)).toEqual({ playerOne: 8, playerTwo: 4 });
  });

  it("scores crossing lines built over alternating turns", () => {
    const game = play(createGame(), [
      [3, 1],
      [0, 0],
      [3, 2],
      [0, 1],
      [2, 3],
      [0, 2],
      [4, 3],
      [0, 3],
      [3, 3],
    ]);

    expect(scoreBoard(game.board)).toEqual({ playerOne: 12, playerTwo: 8 });
  });
});

describe("game completion", () => {
  it("ends only after exactly 49 accepted moves", () => {
    let game = createGame();

    for (const [index, coord] of rowMajorOrder.entries()) {
      const result = applyMove(game, square(coord));

      expect(result.accepted).toBe(true);
      game = result.game;

      if (index < CELL_COUNT - 1) {
        expect(isGameOver(game)).toBe(false);
        expect(result.result).toBeNull();
      } else {
        expect(isGameOver(game)).toBe(true);
        expect(result.result).not.toBeNull();
      }
    }

    expect(ply(game)).toBe(CELL_COUNT);
    expect(legalMoves(game)).toEqual([]);
  });

  it("reports raw scores and a winner once the board is full", () => {
    const game = play(createGame(), rowMajorOrder);
    const result = gameResult(game);

    expect(result).not.toBeNull();
    expect(result?.scores).toEqual(scoreBoard(game.board));
    expect([PLAYER_ONE, PLAYER_TWO]).toContain(result?.winner);
    expect(result?.marginHalfPoints).not.toBe(0);
  });

  it("still exposes the terminal result when it rejects a move after the game ended", () => {
    const game = play(createGame(), rowMajorOrder);
    const terminal = gameResult(game);
    const rejected = applyMove(game, { row: 0, col: 0 });

    expect(rejected.accepted).toBe(false);
    expect(rejected.accepted ? null : rejected.error).toBe("game_over");
    expect(rejected.game).toBe(game);
    expect(rejected.result).toEqual(terminal);
  });

  it("reports out_of_bounds ahead of game_over after the game ended", () => {
    const game = play(createGame(), rowMajorOrder);
    const rejected = applyMove(game, { row: -1, col: 0 });

    expect(rejected.accepted ? null : rejected.error).toBe("out_of_bounds");
    expect(rejected.result).toEqual(gameResult(game));
  });
});

describe("replay", () => {
  it("rebuilds an empty game from no moves", () => {
    const result = replay([]);

    expect(result.ok).toBe(true);
    expect(result.ok && result.game).toEqual(createGame());
  });

  it("rebuilds the same state as applying the moves one at a time", () => {
    const moves = rowMajorOrder.map((coord) => square(coord));
    const expected = play(createGame(), rowMajorOrder);
    const result = replay(moves);

    expect(result.ok).toBe(true);
    expect(result.ok && result.game).toEqual(expected);
    expect(result.ok && gameResult(result.game)).toEqual(gameResult(expected));
  });

  it("stops at an illegal move and reports where", () => {
    const result = replay([
      { row: 0, col: 0 },
      { row: 1, col: 1 },
      { row: 0, col: 0 },
      { row: 2, col: 2 },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("replay should have rejected the repeated square");
    }

    expect(result.error).toBe("occupied");
    expect(result.index).toBe(2);
    expect(ply(result.game)).toBe(2);
    expect(result.game.moves).toEqual([
      { row: 0, col: 0 },
      { row: 1, col: 1 },
    ]);
  });

  it("rejects an out-of-bounds move in the sequence", () => {
    const result = replay([
      { row: 0, col: 0 },
      { row: 7, col: 0 },
    ]);

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error).toBe("out_of_bounds");
    expect(result.ok ? null : result.index).toBe(1);
  });

  it("rejects a move past the end of a completed game", () => {
    const moves = [...rowMajorOrder.map((coord) => square(coord)), { row: 0, col: 0 }];
    const result = replay(moves);

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error).toBe("game_over");
    expect(result.ok ? null : result.index).toBe(CELL_COUNT);
  });
});
