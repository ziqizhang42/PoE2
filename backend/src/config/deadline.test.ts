import { describe, expect, it } from "vitest";

import {
  DEFAULT_DEADLINE_MAX_ACTIVE_GAMES,
  MAX_DEADLINE_MAX_ACTIVE_GAMES,
  readDeadlineConfig,
} from "./deadline.js";

describe("readDeadlineConfig", () => {
  it("defaults to a bounded 20,000 active timed games", () => {
    expect(readDeadlineConfig({})).toEqual({
      maxActiveGames: DEFAULT_DEADLINE_MAX_ACTIVE_GAMES,
    });
    expect(DEFAULT_DEADLINE_MAX_ACTIVE_GAMES).toBe(20_000);
  });

  it("reads a positive whole-number capacity", () => {
    expect(readDeadlineConfig({ DEADLINE_MAX_ACTIVE_GAMES: " 1234 " })).toEqual({
      maxActiveGames: 1234,
    });
  });

  it.each(["", "0", "1.5", "many", String(MAX_DEADLINE_MAX_ACTIVE_GAMES + 1)])(
    "rejects the unsafe capacity %j",
    (capacity) => {
      expect(() => readDeadlineConfig({ DEADLINE_MAX_ACTIVE_GAMES: capacity })).toThrow();
    },
  );

  it("accepts the hard ceiling", () => {
    expect(
      readDeadlineConfig({
        DEADLINE_MAX_ACTIVE_GAMES: String(MAX_DEADLINE_MAX_ACTIVE_GAMES),
      }).maxActiveGames,
    ).toBe(1_000_000);
  });
});
