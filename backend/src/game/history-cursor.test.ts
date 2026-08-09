import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { decodeHistoryCursor, encodeHistoryCursor } from "./history-cursor.js";

const GAME_ID = "6f1f4a52-3d6a-4a37-8f0d-1f1a0bb6b6c1";
const FINISHED_AT = new Date("2026-08-04T10:30:00.000Z");

describe("history cursors", () => {
  it("survives a round trip", () => {
    const decoded = decodeHistoryCursor(
      encodeHistoryCursor({ finishedAt: FINISHED_AT, id: GAME_ID }),
    );

    expect(decoded?.id).toBe(GAME_ID);
    expect(decoded?.finishedAt.toISOString()).toBe(FINISHED_AT.toISOString());
  });

  it("is URL-safe, so it can be a query parameter unescaped", () => {
    const encoded = encodeHistoryCursor({ finishedAt: FINISHED_AT, id: GAME_ID });

    expect(encoded).toMatch(/^[\w-]+$/u);
    expect(encodeURIComponent(encoded)).toBe(encoded);
  });

  it("does not read as the values it carries, so it is not treated as an API", () => {
    const encoded = encodeHistoryCursor({ finishedAt: FINISHED_AT, id: GAME_ID });

    expect(encoded).not.toContain(GAME_ID);
    expect(encoded).not.toContain("2026");
  });

  it("distinguishes two games that finished in the same instant", () => {
    const first = encodeHistoryCursor({ finishedAt: FINISHED_AT, id: GAME_ID });
    const second = encodeHistoryCursor({
      finishedAt: FINISHED_AT,
      id: "2c9f0e1d-4a3b-4c5d-8e6f-7a8b9c0d1e2f",
    });

    expect(first).not.toBe(second);
  });

  it.each([
    ["empty", ""],
    ["not base64", "!!!!"],
    ["base64 of nothing useful", Buffer.from("hello", "utf8").toString("base64url")],
    ["a JSON array", Buffer.from("[]", "utf8").toString("base64url")],
    [
      "a non-UUID id",
      Buffer.from(JSON.stringify({ f: FINISHED_AT.toISOString(), i: "1" }), "utf8").toString(
        "base64url",
      ),
    ],
    [
      "an unparseable date",
      Buffer.from(JSON.stringify({ f: "yesterday", i: GAME_ID }), "utf8").toString("base64url"),
    ],
    [
      "a date that does not exist",
      Buffer.from(JSON.stringify({ f: "2026-02-31T00:00:00.000Z", i: GAME_ID }), "utf8").toString(
        "base64url",
      ),
    ],
    [
      "extra fields, which could be an attempt to widen the query",
      Buffer.from(
        JSON.stringify({ f: FINISHED_AT.toISOString(), i: GAME_ID, limit: 10_000 }),
        "utf8",
      ).toString("base64url"),
    ],
  ])("refuses a cursor that is %s", (_label, encoded) => {
    expect(decodeHistoryCursor(encoded)).toBeNull();
  });
});
