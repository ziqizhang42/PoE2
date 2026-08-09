import {
  allSquares,
  CELL_COUNT,
  formatSquare,
  parseSquare,
  replay,
  type Square,
} from "@poe2/rules";
import { describe, expect, it } from "vitest";

import { finalPly, frameAt, replayScript } from "./replay-script.ts";

function squares(notation: readonly string[]): readonly Square[] {
  return notation.map((text) => {
    const square = parseSquare(text);
    if (square === null) {
      throw new RangeError(text);
    }
    return square;
  });
}

const FULL_GAME = allSquares().map(formatSquare);

describe("replayScript", () => {
  it("opens on the empty board, before anything was played", () => {
    const script = replayScript([]);

    expect(script.frames).toHaveLength(1);
    expect(finalPly(script)).toBe(0);
    expect(frameAt(script, 0).moves).toEqual([]);
    expect(frameAt(script, 0).board.every((cell) => cell === 0)).toBe(true);
  });

  it("holds one frame per position, including the one before the first move", () => {
    const script = replayScript(squares(FULL_GAME));

    expect(script.frames).toHaveLength(CELL_COUNT + 1);
    expect(finalPly(script)).toBe(CELL_COUNT);
  });

  it("numbers each frame by the moves played to reach it", () => {
    const script = replayScript(squares(["d4", "a1", "e4"]));

    for (const [index, frame] of script.frames.entries()) {
      expect(frame.ply).toBe(index);
      expect(frame.moves).toHaveLength(index);
    }
  });

  it("changes exactly one cell between consecutive frames", () => {
    const script = replayScript(squares(FULL_GAME));

    for (let ply = 1; ply <= finalPly(script); ply += 1) {
      const before = frameAt(script, ply - 1).board;
      const after = frameAt(script, ply).board;
      const changed = after.filter((cell, index) => cell !== before[index]);

      expect(changed).toHaveLength(1);
    }
  });

  it("ends on the board the record replays to", () => {
    const moves = squares(FULL_GAME);
    const replayed = replay(moves);

    expect(replayed.ok).toBe(true);
    expect(frameAt(replayScript(moves), CELL_COUNT).board).toEqual(
      replayed.ok ? replayed.game.board : null,
    );
  });

  it("prices every frame from its own board rather than the last one", () => {
    const script = replayScript(squares(["a1", "g7", "b1"]));

    expect(frameAt(script, 2).scores).toEqual({ playerOne: 1, playerTwo: 1 });
    expect(frameAt(script, 3).scores.playerOne).toBe(2);
  });

  it("carries the runs and the lead each position implies", () => {
    const script = replayScript(squares(["a1", "g7", "b1", "g6"]));
    const frame = frameAt(script, 4);

    expect(frame.runs.runs).not.toHaveLength(0);
    expect(frame.lead.ply).toBe(4);
  });

  it("agrees with the progression it carries", () => {
    const script = replayScript(squares(FULL_GAME));

    expect(script.progression.points).toHaveLength(CELL_COUNT + 1);
    expect(frameAt(script, 7).lead).toEqual(script.progression.points[7]);
  });

  it("refuses a ply that is not in the record", () => {
    const script = replayScript(squares(["d4"]));

    expect(() => frameAt(script, 2)).toThrow(RangeError);
    expect(() => frameAt(script, -1)).toThrow(RangeError);
  });

  it("refuses a move list that is not a legal game rather than drawing it", () => {
    expect(() => replayScript(squares(["d4", "d4"]))).toThrow(RangeError);
  });
});
