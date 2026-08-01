import { describe, expect, it } from "vitest";

import { lineScore } from "./score.js";

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
