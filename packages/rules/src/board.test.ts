import { describe, expect, it } from "vitest";

import {
  allSquares,
  BOARD_SIZE,
  cellAt,
  CELL_COUNT,
  createEmptyBoard,
  EMPTY,
  emptyCount,
  isBoardFull,
  isEmptySquare,
  isValidSquare,
  opponent,
  pieceCount,
  placePiece,
  PLAYER_ONE,
  PLAYER_TWO,
  squareFromIndex,
  squareIndex,
} from "./board.js";

describe("board constants", () => {
  it("is 7x7 with exactly 49 cells", () => {
    expect(BOARD_SIZE).toBe(7);
    expect(CELL_COUNT).toBe(49);
  });
});

describe("createEmptyBoard", () => {
  it("starts with 49 empty cells", () => {
    const board = createEmptyBoard();

    expect(board).toHaveLength(CELL_COUNT);
    expect(board.every((cell) => cell === EMPTY)).toBe(true);
    expect(pieceCount(board)).toBe(0);
    expect(emptyCount(board)).toBe(CELL_COUNT);
    expect(isBoardFull(board)).toBe(false);
    expect(cellAt(board, { row: 0, col: 0 })).toBe(EMPTY);
    expect(isEmptySquare(board, { row: 0, col: 0 })).toBe(true);
  });

  it("returns an independent board each call", () => {
    const first = createEmptyBoard();
    const second = createEmptyBoard();

    expect(first).not.toBe(second);
    expect(placePiece(first, PLAYER_ONE, { row: 3, col: 4 })).not.toBe(first);
    expect(second.every((cell) => cell === EMPTY)).toBe(true);
  });
});

describe("isValidSquare", () => {
  it.each([
    [{ row: 0, col: 0 }, true],
    [{ row: 6, col: 6 }, true],
    [{ row: 3, col: 4 }, true],
    [{ row: -1, col: 0 }, false],
    [{ row: 0, col: -1 }, false],
    [{ row: BOARD_SIZE, col: 0 }, false],
    [{ row: 0, col: BOARD_SIZE }, false],
    [{ row: 0.5, col: 0 }, false],
    [{ row: 0, col: Number.NaN }, false],
  ])("treats %o as valid=%s", (square, expected) => {
    expect(isValidSquare(square)).toBe(expected);
  });
});

describe("square indexing", () => {
  it("maps the corners the way the engine does", () => {
    expect(squareIndex({ row: 0, col: 0 })).toBe(0);
    expect(squareIndex({ row: 6, col: 6 })).toBe(CELL_COUNT - 1);
    expect(squareFromIndex(0)).toEqual({ row: 0, col: 0 });
    expect(squareFromIndex(CELL_COUNT - 1)).toEqual({ row: 6, col: 6 });
  });

  it("round-trips every square", () => {
    for (let index = 0; index < CELL_COUNT; index += 1) {
      expect(squareIndex(squareFromIndex(index))).toBe(index);
    }
  });

  it("rejects out-of-bounds squares and indices", () => {
    expect(() => squareIndex({ row: -1, col: 0 })).toThrow(RangeError);
    expect(() => squareIndex({ row: 0, col: BOARD_SIZE })).toThrow(RangeError);
    expect(() => squareFromIndex(-1)).toThrow(RangeError);
    expect(() => squareFromIndex(CELL_COUNT)).toThrow(RangeError);
    expect(() => squareFromIndex(1.5)).toThrow(RangeError);
  });

  it("lists every square once in row-major order", () => {
    const squares = allSquares();

    expect(squares).toHaveLength(CELL_COUNT);
    expect(squares[0]).toEqual({ row: 0, col: 0 });
    expect(squares.at(-1)).toEqual({ row: 6, col: 6 });
    expect(squares.map((square) => squareIndex(square))).toEqual([
      ...Array.from({ length: CELL_COUNT }).keys(),
    ]);
  });
});

describe("cellAt", () => {
  it("reads placed pieces", () => {
    const board = placePiece(createEmptyBoard(), PLAYER_ONE, { row: 3, col: 4 });

    expect(cellAt(board, { row: 3, col: 4 })).toBe(PLAYER_ONE);
    expect(cellAt(board, { row: 4, col: 3 })).toBe(EMPTY);
  });

  it.each([
    { row: -1, col: 0 },
    { row: 0, col: -1 },
    { row: BOARD_SIZE, col: 0 },
  ])("reads %o as empty and unplayable", (square) => {
    const board = createEmptyBoard();

    expect(cellAt(board, square)).toBe(EMPTY);
    expect(isEmptySquare(board, square)).toBe(false);
  });
});

describe("placePiece", () => {
  it("never mutates the board it was given", () => {
    const board = createEmptyBoard();
    const before = [...board];
    const next = placePiece(board, PLAYER_TWO, { row: 2, col: 5 });

    expect(next).not.toBe(board);
    expect([...board]).toEqual(before);
    expect(cellAt(board, { row: 2, col: 5 })).toBe(EMPTY);
    expect(cellAt(next, { row: 2, col: 5 })).toBe(PLAYER_TWO);
    expect(pieceCount(next)).toBe(1);
    expect(emptyCount(next)).toBe(CELL_COUNT - 1);
  });

  it("rejects occupied and out-of-bounds squares", () => {
    const board = placePiece(createEmptyBoard(), PLAYER_ONE, { row: 3, col: 4 });

    expect(() => placePiece(board, PLAYER_TWO, { row: 3, col: 4 })).toThrow(RangeError);
    expect(() => placePiece(board, PLAYER_ONE, { row: -1, col: 0 })).toThrow(RangeError);
  });

  it("fills the board after 49 placements", () => {
    let board = createEmptyBoard();
    for (const square of allSquares()) {
      board = placePiece(board, PLAYER_ONE, square);
    }

    expect(pieceCount(board)).toBe(CELL_COUNT);
    expect(emptyCount(board)).toBe(0);
    expect(isBoardFull(board)).toBe(true);
  });
});

describe("opponent", () => {
  it("swaps the two players", () => {
    expect(opponent(PLAYER_ONE)).toBe(PLAYER_TWO);
    expect(opponent(PLAYER_TWO)).toBe(PLAYER_ONE);
  });
});
