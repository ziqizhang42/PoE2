import { describe, expect, it } from "vitest";

import { moveKey, pendingMoveSquare } from "./move-keys.ts";

describe("move keys", () => {
  it("carries the square through the runner and back", () => {
    expect(moveKey({ row: 3, col: 3 })).toBe("move:d4");
    expect(pendingMoveSquare(moveKey({ row: 3, col: 3 }))).toStrictEqual({ row: 3, col: 3 });
  });

  it("reports no pending square for anything that is not a move", () => {
    expect(pendingMoveSquare(null)).toBeNull();
    expect(pendingMoveSquare("create")).toBeNull();
    expect(pendingMoveSquare("move:zz")).toBeNull();
  });
});
