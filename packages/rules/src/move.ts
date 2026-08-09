import { BOARD_SIZE, isBoardFull, isEmptySquare, isValidSquare } from "./board.js";
import type { Board, Square } from "./board.js";

/** Rejection reasons, named exactly as the engine names them. */
export type MoveError = "out_of_bounds" | "game_over" | "occupied";

export const MOVE_ERRORS: readonly MoveError[] = ["out_of_bounds", "game_over", "occupied"];

const FIRST_FILE = "a".codePointAt(0) ?? 0;
const FIRST_RANK = "1".codePointAt(0) ?? 0;
const NOTATION_LENGTH = 2;

/**
 * Why `square` cannot be played on `board`, or `null` when it is legal.
 *
 * Precedence is out-of-bounds, then game over, then occupied, so a square off
 * the board reports `out_of_bounds` even once the game has ended, and any
 * square on a full board reports `game_over` rather than `occupied`.
 */
export function validateMove(board: Board, square: Square): MoveError | null {
  if (!isValidSquare(square)) {
    return "out_of_bounds";
  }
  if (isBoardFull(board)) {
    return "game_over";
  }
  if (!isEmptySquare(board, square)) {
    return "occupied";
  }
  return null;
}

/** The square `text` names, or `null` if it is not valid `a1`..`g7` notation. */
export function parseSquare(text: string): Square | null {
  if (text.length !== NOTATION_LENGTH) {
    return null;
  }

  const file = text.slice(0, 1).toLowerCase().codePointAt(0) ?? Number.NaN;
  const rank = text.codePointAt(1) ?? Number.NaN;
  const square = { row: rank - FIRST_RANK, col: file - FIRST_FILE };

  return isValidSquare(square) ? square : null;
}

/**
 * `square` in lowercase `a1`..`g7` notation.
 *
 * Throws for a square off the board. The engine returns an empty string there;
 * this package raises instead, matching `lineScore` and keeping an unusable
 * coordinate from silently becoming an empty label.
 */
export function formatSquare(square: Square): string {
  if (!isValidSquare(square)) {
    throw new RangeError(`square must be inside the ${BOARD_SIZE}x${BOARD_SIZE} board`);
  }

  return (
    String.fromCodePoint(FIRST_FILE + square.col) + String.fromCodePoint(FIRST_RANK + square.row)
  );
}
