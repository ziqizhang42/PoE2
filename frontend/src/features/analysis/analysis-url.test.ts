import { describe, expect, it } from "vitest";

import { allSquares, formatSquare } from "@poe2/rules";

import { analysisPath, readAnalysisUrl } from "./analysis-url.ts";

describe("analysis position URLs", () => {
  it("keeps an empty position at the plain route", () => {
    expect(analysisPath([])).toBe("/analysis");
    expect(readAnalysisUrl("")).toEqual({ ok: true, moves: [] });
  });

  it("round-trips a move history in readable notation", () => {
    const moves = allSquares().slice(0, 3);
    const path = analysisPath(moves);
    const decoded = readAnalysisUrl(path.slice(path.indexOf("?")));

    expect(path).toBe("/analysis?moves=a1,b1,c1");
    expect(decoded.ok && decoded.moves.map(formatSquare)).toEqual(["a1", "b1", "c1"]);
  });

  it("accepts encoded separators and canonicalizes uppercase files", () => {
    const decoded = readAnalysisUrl("?moves=D4%2Ca1");

    expect(decoded.ok && decoded.moves.map(formatSquare)).toEqual(["d4", "a1"]);
  });

  it.each([
    ["?moves=d4,d4", "not legal"],
    ["?moves=h1", "not an a1–g7 square"],
    ["?moves=d4,,a1", "Move 2"],
    ["?moves=d4&moves=a1", "more than one move history"],
  ])("rejects an untrusted position in %s", (search, message) => {
    const decoded = readAnalysisUrl(search);

    expect(decoded.ok).toBe(false);
    expect(decoded.ok ? "" : decoded.message).toContain(message);
  });

  it("rejects a history longer than the board before replaying it", () => {
    const decoded = readAnalysisUrl(`?moves=${Array.from({ length: 50 }).fill("a1").join(",")}`);

    expect(decoded.ok).toBe(false);
    expect(decoded.ok ? "" : decoded.message).toContain("more than 49 moves");
  });
});
