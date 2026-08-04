import { describe, expect, it } from "vitest";

import { DEFAULT_KDF_MAX_CONCURRENT, DEFAULT_KDF_MAX_QUEUED, readKdfConfig } from "./kdf.js";

describe("readKdfConfig", () => {
  it("uses conservative defaults for an empty environment", () => {
    expect(readKdfConfig({})).toEqual({
      maxConcurrent: DEFAULT_KDF_MAX_CONCURRENT,
      maxQueued: DEFAULT_KDF_MAX_QUEUED,
    });
  });

  it("defaults to at most two concurrent operations and a short queue", () => {
    expect(DEFAULT_KDF_MAX_CONCURRENT).toBe(2);
    expect(DEFAULT_KDF_MAX_QUEUED).toBe(16);
  });

  it("parses explicit limits", () => {
    expect(
      readKdfConfig({ PASSWORD_KDF_MAX_CONCURRENT: "4", PASSWORD_KDF_MAX_QUEUED: "32" }),
    ).toEqual({ maxConcurrent: 4, maxQueued: 32 });
  });

  it("allows a queue of zero, which sheds load as soon as every slot is busy", () => {
    expect(readKdfConfig({ PASSWORD_KDF_MAX_QUEUED: "0" }).maxQueued).toBe(0);
  });

  it.each(["0", "-1", "1.5", "", " ", "many", "65"])(
    "rejects the concurrency value %s",
    (value) => {
      expect(() => readKdfConfig({ PASSWORD_KDF_MAX_CONCURRENT: value })).toThrow();
    },
  );

  it.each(["-1", "1.5", "", "lots", "1025"])("rejects the queue value %s", (value) => {
    expect(() => readKdfConfig({ PASSWORD_KDF_MAX_QUEUED: value })).toThrow();
  });
});
