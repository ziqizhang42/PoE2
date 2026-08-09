import { describe, expect, it } from "vitest";

import type { KeyValueStore } from "../../theme/theme.ts";
import {
  BOARD_MARKS_STORAGE_KEY,
  browserBoardMarksStorage,
  DEFAULT_BOARD_MARKS,
  marksFor,
  NO_BOARD_MARKS,
} from "./board-marks.ts";

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & {
  entries: Map<string, string>;
} {
  const entries = new Map(Object.entries(initial));
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

describe("marksFor", () => {
  it("honours the reader's choice in a casual game", () => {
    expect(marksFor({ runValues: true, squareGains: false }, false)).toEqual({
      runValues: true,
      squareGains: false,
    });
  });

  it("shows neither aid in a rated game, whatever was chosen", () => {
    expect(marksFor(DEFAULT_BOARD_MARKS, true)).toEqual(NO_BOARD_MARKS);
    expect(marksFor({ runValues: true, squareGains: true }, true)).toEqual(NO_BOARD_MARKS);
  });

  it("starts with both on, so nothing changes for a reader who never chooses", () => {
    expect(DEFAULT_BOARD_MARKS).toEqual({ runValues: true, squareGains: true });
  });
});

describe("browserBoardMarksStorage", () => {
  it("round-trips a choice", () => {
    const store = memoryStore();
    const storage = browserBoardMarksStorage(store);

    storage.write({ runValues: false, squareGains: true });

    expect(storage.read()).toEqual({ runValues: false, squareGains: true });
    expect(store.entries.get(BOARD_MARKS_STORAGE_KEY)).toBe(
      '{"runValues":false,"squareGains":true}',
    );
  });

  it("reads nothing as not chosen", () => {
    expect(browserBoardMarksStorage(memoryStore()).read()).toBeNull();
  });

  it.each([
    ["invalid JSON", "not json"],
    ["the wrong shape", '{"runValues":"yes"}'],
    ["a bare value", "42"],
  ])("treats %s as not chosen", (_label, stored) => {
    const storage = browserBoardMarksStorage(memoryStore({ [BOARD_MARKS_STORAGE_KEY]: stored }));
    expect(storage.read()).toBeNull();
  });

  it("works without any storage at all", () => {
    const storage = browserBoardMarksStorage(null);

    expect(storage.read()).toBeNull();
    expect(() => {
      storage.write(NO_BOARD_MARKS);
    }).not.toThrow();
  });
});
