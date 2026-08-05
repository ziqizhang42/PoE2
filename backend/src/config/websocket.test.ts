import { describe, expect, it } from "vitest";

import { isAllowedOrigin, readWebSocketConfig } from "./websocket.js";

const DEVELOPMENT = { NODE_ENV: "development" };
const PRODUCTION = { NODE_ENV: "production" };

describe("readWebSocketConfig", () => {
  it("falls back to the Vite dev server when nothing is configured", () => {
    expect(readWebSocketConfig(DEVELOPMENT).allowedOrigins).toEqual(["http://localhost:5173"]);
  });

  it("reads a comma-separated list and ignores blank entries", () => {
    const config = readWebSocketConfig({
      ...DEVELOPMENT,
      WEBSOCKET_ALLOWED_ORIGINS: " http://localhost:5173 , ,https://poe2.example ",
    });

    expect(config.allowedOrigins).toEqual(["http://localhost:5173", "https://poe2.example"]);
  });

  it("normalizes each configured origin", () => {
    const config = readWebSocketConfig({
      ...PRODUCTION,
      WEBSOCKET_ALLOWED_ORIGINS: "https://PoE2.example/,https://poe2.example:443",
    });

    expect(config.allowedOrigins).toEqual(["https://poe2.example", "https://poe2.example"]);
  });

  it("refuses to start in production without an explicit list", () => {
    expect(() => readWebSocketConfig(PRODUCTION)).toThrow(/required when NODE_ENV is production/u);
    expect(() => readWebSocketConfig({ ...PRODUCTION, WEBSOCKET_ALLOWED_ORIGINS: "  " })).toThrow(
      /required when NODE_ENV is production/u,
    );
  });

  it("never accepts a wildcard, in any environment", () => {
    expect(() => readWebSocketConfig({ ...PRODUCTION, WEBSOCKET_ALLOWED_ORIGINS: "*" })).toThrow(
      /explicit origins/u,
    );
    expect(() =>
      readWebSocketConfig({
        ...DEVELOPMENT,
        WEBSOCKET_ALLOWED_ORIGINS: "http://localhost:5173,*",
      }),
    ).toThrow(/explicit origins/u);
  });

  it("rejects a value that is not an origin", () => {
    expect(() =>
      readWebSocketConfig({ ...PRODUCTION, WEBSOCKET_ALLOWED_ORIGINS: "localhost:5173" }),
    ).toThrow();
  });
});

describe("isAllowedOrigin", () => {
  const config = readWebSocketConfig({
    ...PRODUCTION,
    WEBSOCKET_ALLOWED_ORIGINS: "http://localhost:5173,https://poe2.example",
  });

  it.each(["http://localhost:5173", "https://poe2.example", "https://poe2.example:443"])(
    "allows %s",
    (origin) => {
      expect(isAllowedOrigin(config, origin)).toBe(true);
    },
  );

  it.each([
    "http://localhost:5174",
    "https://localhost:5173",
    "http://evil.example",
    "https://poe2.example.evil.test",
    "null",
    "not an origin",
    "",
  ])("rejects %s", (origin) => {
    expect(isAllowedOrigin(config, origin)).toBe(false);
  });

  it("rejects a missing origin header", () => {
    expect(isAllowedOrigin(config, undefined)).toBe(false);
  });
});
