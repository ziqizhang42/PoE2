/**
 * Game state for Powers of Exponent 2.
 *
 * A game stores its board and move history. Ply, side to move, and completion
 * are derived rather than stored separately. Games start empty with Player 1
 * to move and end after exactly 49 accepted moves.
 *
 * Transitions are pure: accepted moves return new state, while rejected moves
 * return the original state unchanged.
 */

import {
  allSquares,
  createEmptyBoard,
  isBoardFull,
  isEmptySquare,
  placePiece,
  PLAYER_ONE,
  PLAYER_TWO,
} from "./board.js";
import type { Board, Player, Square } from "./board.js";
import { validateMove } from "./move.js";
import type { MoveError } from "./move.js";
import { resultIfFull } from "./score.js";
import type { GameResult } from "./score.js";

export interface Game {
  readonly board: Board;
  readonly moves: readonly Square[];
}

/** The outcome of offering a move to a game. */
export type MoveResult =
  | {
      readonly accepted: true;
      /** The new game. */
      readonly game: Game;
      /** The terminal result when this move filled the board, else `null`. */
      readonly result: GameResult | null;
    }
  | {
      readonly accepted: false;
      readonly error: MoveError;
      /** The original game, unchanged. */
      readonly game: Game;
      /** The terminal result when the game was already over, else `null`. */
      readonly result: GameResult | null;
    };

/** The outcome of replaying a move sequence from an empty board. */
export type ReplayResult =
  | { readonly ok: true; readonly game: Game }
  | {
      readonly ok: false;
      readonly error: MoveError;
      /** Index in the sequence of the move that was rejected. */
      readonly index: number;
      /** The game as it stood before the rejected move. */
      readonly game: Game;
    };

export function createGame(): Game {
  return { board: createEmptyBoard(), moves: [] };
}

export function ply(game: Game): number {
  return game.moves.length;
}

export function sideToMove(game: Game): Player {
  return game.moves.length % 2 === 0 ? PLAYER_ONE : PLAYER_TWO;
}

export function isGameOver(game: Game): boolean {
  return isBoardFull(game.board);
}

export function legalMoves(game: Game): readonly Square[] {
  if (isGameOver(game)) {
    return [];
  }
  return allSquares().filter((square) => isEmptySquare(game.board, square));
}

/** The terminal result, or `null` while the board still has empty squares. */
export function gameResult(game: Game): GameResult | null {
  return resultIfFull(game.board);
}

/**
 * Play `square` for the side to move.
 *
 * The result is reported either way, so a move rejected after the board filled
 * still exposes the terminal result.
 */
export function applyMove(game: Game, square: Square): MoveResult {
  const error = validateMove(game.board, square);
  if (error !== null) {
    return { accepted: false, error, game, result: gameResult(game) };
  }

  // Copy the caller's square before storing it. Holding the original would let
  // a later mutation of that object drift the history away from the board.
  const recordedSquare: Square = { row: square.row, col: square.col };
  const next: Game = {
    board: placePiece(game.board, sideToMove(game), recordedSquare),
    moves: [...game.moves, recordedSquare],
  };

  return { accepted: true, game: next, result: gameResult(next) };
}

/** Rebuild a game by applying `moves` in order to a fresh empty game. */
export function replay(moves: readonly Square[]): ReplayResult {
  let game = createGame();

  for (const [index, square] of moves.entries()) {
    const result = applyMove(game, square);
    if (!result.accepted) {
      return { ok: false, error: result.error, index, game };
    }
    game = result.game;
  }

  return { ok: true, game };
}
