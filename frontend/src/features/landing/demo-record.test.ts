import { describe, expect, it } from "vitest";

import { CELL_COUNT, isBoardFull, parseSquare, replay, resultIfFull } from "@poe2/rules";

import { progression } from "../../board/progression.ts";
import { DEMO_MOVES, DEMO_NOTATION } from "./demo-record.ts";

describe("the demonstration record", () => {
  it("names every square on the board, once each", () => {
    expect(DEMO_NOTATION).toHaveLength(CELL_COUNT);
    expect(new Set(DEMO_NOTATION).size).toBe(CELL_COUNT);
  });

  it("is written in the shared notation, not a notation of its own", () => {
    for (const text of DEMO_NOTATION) {
      expect(parseSquare(text)).not.toBeNull();
    }
    expect(DEMO_MOVES).toHaveLength(CELL_COUNT);
  });

  it("is a legal game from the first move to the last", () => {
    const replayed = replay(DEMO_MOVES);

    expect(replayed.ok).toBe(true);
  });

  it("fills the board, so it reaches a real result", () => {
    const replayed = replay(DEMO_MOVES);
    if (!replayed.ok) {
      throw new Error("the record is not legal");
    }

    expect(isBoardFull(replayed.game.board)).toBe(true);
    expect(resultIfFull(replayed.game.board)).not.toBeNull();
  });

  it("is decided by the handicap alone, which is why it was chosen", () => {
    const replayed = replay(DEMO_MOVES);
    if (!replayed.ok) {
      throw new Error("the record is not legal");
    }
    const result = resultIfFull(replayed.game.board);

    expect(result?.scores.playerOne).toBe(102);
    expect(result?.scores.playerTwo).toBe(96);
    expect(result?.winner).toBe(1);
    expect(result?.marginHalfPoints).toBe(1);
  });

  it("changes hands more than once, so there is something to watch", () => {
    expect(progression(DEMO_MOVES).leadChanges).toBeGreaterThan(1);
  });

  it("carries no player, no game id and no score of its own", () => {
    for (const entry of DEMO_NOTATION) {
      expect(entry).toMatch(/^[a-g][1-7]$/);
    }
  });
});
