import { UNTIMED } from "@poe2/protocol";
import { describe, expect, it } from "vitest";

import { formatDuration, formatTimeControl } from "./time-control.ts";

function timed(initialMs: number, incrementMs: number) {
  return { kind: "timed", initialMs, incrementMs } as const;
}

describe("formatTimeControl", () => {
  it("names an untimed game rather than printing zeroes", () => {
    expect(formatTimeControl(UNTIMED)).toBe("Untimed");
  });

  it.each([
    [timed(600_000, 5_000), "10 min + 5 sec/move"],
    [timed(300_000, 3_000), "5 min + 3 sec/move"],
    [timed(137_000, 7_000), "2 min 17 sec + 7 sec/move"],
    [timed(10_800_000, 180_000), "3 h + 3 min/move"],
  ])("formats %o", (control, expected) => {
    expect(formatTimeControl(control)).toBe(expected);
  });

  it("says an increment of zero in words", () => {
    expect(formatTimeControl(timed(60_000, 0))).toBe("1 min, no increment");
  });
});

describe("formatDuration", () => {
  it.each([
    [10_000, "10 sec"],
    [60_000, "1 min"],
    [90_000, "1 min 30 sec"],
    [3_600_000, "1 h"],
    [5_400_000, "1 h 30 min"],
    [5_401_000, "1 h 30 min 1 sec"],
  ])("writes %d ms largest unit first", (milliseconds, expected) => {
    expect(formatDuration(milliseconds)).toBe(expected);
  });

  it("falls back to milliseconds for a part-second it should never be given", () => {
    expect(formatDuration(2_500)).toBe("2500 ms");
  });
});
