export const BOARD_SIZE = 7;
export const CELL_COUNT: number = BOARD_SIZE * BOARD_SIZE;

/** An empty cell, or a cell owned by one of the two players. */
export type Cell = 0 | 1 | 2;

/** A player, numbered to match the digit their pieces show. */
export type Player = 1 | 2;

export const EMPTY = 0;
export const PLAYER_ONE = 1;
export const PLAYER_TWO = 2;

export interface Square {
  readonly row: number;
  readonly col: number;
}

/** Flat row-major cells; row 0 is rank 1 and column 0 is file a. */
export type Board = readonly Cell[];

export function opponent(player: Player): Player {
  return player === PLAYER_ONE ? PLAYER_TWO : PLAYER_ONE;
}

export function isValidSquare(square: Square): boolean {
  return (
    Number.isInteger(square.row) &&
    Number.isInteger(square.col) &&
    square.row >= 0 &&
    square.row < BOARD_SIZE &&
    square.col >= 0 &&
    square.col < BOARD_SIZE
  );
}

export function squareIndex(square: Square): number {
  if (!isValidSquare(square)) {
    throw new RangeError(`square must be inside the ${BOARD_SIZE}x${BOARD_SIZE} board`);
  }
  return square.row * BOARD_SIZE + square.col;
}

export function squareFromIndex(index: number): Square {
  if (!Number.isInteger(index) || index < 0 || index >= CELL_COUNT) {
    throw new RangeError(`index must be an integer from 0 through ${CELL_COUNT - 1}`);
  }
  return { row: Math.floor(index / BOARD_SIZE), col: index % BOARD_SIZE };
}

/** Every square in row-major order, the order the board array itself uses. */
export function allSquares(): readonly Square[] {
  const squares: Square[] = [];
  for (let index = 0; index < CELL_COUNT; index += 1) {
    squares.push(squareFromIndex(index));
  }
  return squares;
}

export function createEmptyBoard(): Board {
  return Array.from<Cell>({ length: CELL_COUNT }).fill(EMPTY);
}

/** Out-of-bounds squares read as empty, matching the engine's `cell_at`. */
export function cellAt(board: Board, square: Square): Cell {
  if (!isValidSquare(square)) {
    return EMPTY;
  }
  return board[square.row * BOARD_SIZE + square.col] ?? EMPTY;
}

/** Out-of-bounds squares are not empty; nothing can be placed there. */
export function isEmptySquare(board: Board, square: Square): boolean {
  return isValidSquare(square) && cellAt(board, square) === EMPTY;
}

export function pieceCount(board: Board): number {
  return board.reduce<number>((count, cell) => (cell === EMPTY ? count : count + 1), 0);
}

export function emptyCount(board: Board): number {
  return CELL_COUNT - pieceCount(board);
}

export function isBoardFull(board: Board): boolean {
  return pieceCount(board) === CELL_COUNT;
}

/** Raw placement primitive; game transitions should use `applyMove`. */
export function placePiece(board: Board, player: Player, square: Square): Board {
  const index = squareIndex(square);
  if (board[index] !== EMPTY) {
    throw new RangeError("square is already occupied");
  }

  const next = board.slice();
  next[index] = player;
  return next;
}
