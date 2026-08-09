import { describe, expect, it } from "vitest";

import { afterUnplayedPeriods } from "./decay.js";
import { INITIAL_RATING } from "./glicko2.js";

describe("afterUnplayedPeriods", () => {
  it("preserves a newcomer's deviation when no inactive period elapsed", () => {
    expect(afterUnplayedPeriods(INITIAL_RATING, 0, undefined)).toBe(INITIAL_RATING);
  });
});
