import { describe, expect, it } from "vitest";

import { readAuthConfig } from "./auth.js";

describe("readAuthConfig", () => {
  it.each(["development", "test"])("uses an HTTP-compatible cookie in %s", (nodeEnvironment) => {
    expect(readAuthConfig({ NODE_ENV: nodeEnvironment })).toEqual({
      sessionCookieName: "poe2_session",
      secureCookies: false,
    });
  });

  it("uses a secure host-only cookie in production", () => {
    expect(readAuthConfig({ NODE_ENV: "production" })).toEqual({
      sessionCookieName: "__Host-poe2_session",
      secureCookies: true,
    });
  });

  it.each([{}, { NODE_ENV: "" }, { NODE_ENV: "staging" }])(
    "rejects a missing or invalid environment",
    (environment) => {
      expect(() => readAuthConfig(environment)).toThrow();
    },
  );
});
