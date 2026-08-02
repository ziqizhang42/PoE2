import { describe, expect, it } from "vitest";

import { allSquares, createEmptyBoard, placePiece, PLAYER_ONE } from "./board.js";
import type { Board, Square } from "./board.js";
import { formatSquare, MOVE_ERRORS, parseSquare, validateMove } from "./move.js";

function boardWith(squares: readonly Square[]): Board {
  return squares.reduce<Board>(
    (board, square) => placePiece(board, PLAYER_ONE, square),
    createEmptyBoard(),
  );
}

describe("parseSquare", () => {
  it.each([
    ["a1", { row: 0, col: 0 }],
    ["g7", { row: 6, col: 6 }],
    ["a7", { row: 6, col: 0 }],
    ["g1", { row: 0, col: 6 }],
    ["c4", { row: 3, col: 2 }],
  ])("parses %s as %o", (text, expected) => {
    expect(parseSquare(text)).toEqual(expected);
  });

  it.each([
    ["C4", { row: 3, col: 2 }],
    ["A1", { row: 0, col: 0 }],
    ["G7", { row: 6, col: 6 }],
  ])("accepts the uppercase file in %s", (text, expected) => {
    expect(parseSquare(text)).toEqual(expected);
  });

  it.each(["", "a", "a10", "h1", "a0", "a8", "11", "aa", " a1", "1a"])("rejects %s", (text) => {
    expect(parseSquare(text)).toBeNull();
  });
});

describe("formatSquare", () => {
  it.each([
    [{ row: 0, col: 0 }, "a1"],
    [{ row: 6, col: 6 }, "g7"],
    [{ row: 3, col: 2 }, "c4"],
  ])("formats %o as %s", (square, expected) => {
    expect(formatSquare(square)).toBe(expected);
  });

  it("round-trips every square in lowercase", () => {
    for (const square of allSquares()) {
      const text = formatSquare(square);

      expect(text).toBe(text.toLowerCase());
      expect(parseSquare(text)).toEqual(square);
    }
  });

  it.each([
    { row: -1, col: 0 },
    { row: 0, col: -1 },
    { row: 7, col: 0 },
    { row: 0.5, col: 0 },
  ])("throws for the out-of-bounds square %o", (square) => {
    expect(() => formatSquare(square)).toThrow(RangeError);
  });
});

describe("validateMove", () => {
  it("accepts an empty square on a partial board", () => {
    expect(validateMove(createEmptyBoard(), { row: 0, col: 0 })).toBeNull();
  });

  it("has stable error names", () => {
    expect(MOVE_ERRORS).toEqual(["out_of_bounds", "game_over", "occupied"]);
  });

  it("reports an occupied square", () => {
    const board = boardWith([{ row: 3, col: 4 }]);

    expect(validateMove(board, { row: 3, col: 4 })).toBe("occupied");
  });

  it.each([
    { row: -1, col: 0 },
    { row: 0, col: -1 },
    { row: 7, col: 0 },
    { row: 0, col: 7 },
  ])("reports %o as out of bounds", (square) => {
    expect(validateMove(createEmptyBoard(), square)).toBe("out_of_bounds");
  });

  it("prefers out_of_bounds over game_over on a full board", () => {
    const full = boardWith(allSquares());

    expect(validateMove(full, { row: -1, col: 0 })).toBe("out_of_bounds");
  });

  it("prefers game_over over occupied on a full board", () => {
    const full = boardWith(allSquares());

    expect(validateMove(full, { row: 0, col: 0 })).toBe("game_over");
  });
});
