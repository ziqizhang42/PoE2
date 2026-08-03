import { describe, expect, it } from "vitest";

import { generateSessionToken, hashSessionToken } from "./session-token.js";

describe("session tokens", () => {
  it("generates a random token and its database hash", () => {
    const generated = generateSessionToken();

    expect(generated.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(generated.tokenHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(hashSessionToken(generated.token)).toBe(generated.tokenHash);
    expect(generated.tokenHash).not.toContain(generated.token);
  });

  it("generates distinct tokens", () => {
    expect(generateSessionToken().token).not.toBe(generateSessionToken().token);
  });

  it("hashes tokens deterministically", () => {
    expect(hashSessionToken("example-token")).toBe(hashSessionToken("example-token"));
    expect(hashSessionToken("example-token")).not.toBe(hashSessionToken("different-token"));
  });
});
