import { describe, expect, it } from "vitest";

import { formatOpenedAt } from "./games.ts";

const OPENED_AT = "2026-08-04T12:00:00.000Z";
const OPENED_MS = Date.parse(OPENED_AT);

describe("formatOpenedAt", () => {
  it("counts up through the units", () => {
    expect(formatOpenedAt(OPENED_AT, OPENED_MS + 5_000)).toBe("just now");
    expect(formatOpenedAt(OPENED_AT, OPENED_MS + 120_000)).toBe("2 min");
    expect(formatOpenedAt(OPENED_AT, OPENED_MS + 7_200_000)).toBe("2 h");
    expect(formatOpenedAt(OPENED_AT, OPENED_MS + 172_800_000)).toBe("2 d");
  });

  it("never reports a negative age or a broken timestamp", () => {
    expect(formatOpenedAt(OPENED_AT, OPENED_MS - 60_000)).toBe("just now");
    expect(formatOpenedAt("not a date", OPENED_MS)).toBe("—");
  });
});
