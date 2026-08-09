import { describe, expect, it } from "vitest";

import { formatHalfPoints } from "./half-points.ts";

describe("formatHalfPoints", () => {
  it("keeps the fraction rather than rounding it away", () => {
    expect(formatHalfPoints(1)).toBe("½");
    expect(formatHalfPoints(2)).toBe("1");
    expect(formatHalfPoints(7)).toBe("3½");
    expect(formatHalfPoints(-7)).toBe("3½");
    expect(formatHalfPoints(0)).toBe("0");
  });
});
