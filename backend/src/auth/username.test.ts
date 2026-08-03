import { describe, expect, it } from "vitest";

import { normalizeUsername } from "./username.js";

describe("normalizeUsername", () => {
  it.each([
    ["Player_One", "player_one"],
    ["PLAYER123", "player123"],
    ["already_lower", "already_lower"],
  ])("normalizes %s", (username, expected) => {
    expect(normalizeUsername(username)).toBe(expected);
  });
});
