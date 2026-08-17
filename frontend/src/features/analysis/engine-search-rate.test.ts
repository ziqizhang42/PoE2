import { describe, expect, it } from "vitest";

import { calculateNodesPerSecond, formatNodesPerSecond } from "./engine-search-rate.ts";

describe("engine search rate", () => {
  it("derives a compact node rate from Worker elapsed time", () => {
    const rate = calculateNodesPerSecond(965_000, 250);

    expect(rate).toBe(3_860_000);
    expect(formatNodesPerSecond(rate ?? 0)).toBe("3.9M");
  });

  it("rejects an elapsed interval that cannot produce a meaningful rate", () => {
    expect(calculateNodesPerSecond(1_000, 0)).toBeNull();
    expect(calculateNodesPerSecond(-1, 100)).toBeNull();
  });
});
