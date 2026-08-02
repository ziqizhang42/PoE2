import { describe, expect, it } from "vitest";

import { readServerConfig } from "./server.js";

describe("readServerConfig", () => {
  it("defaults to 0.0.0.0:3000 for an empty environment", () => {
    expect(readServerConfig({})).toEqual({ host: "0.0.0.0", port: 3000 });
  });

  it("parses string HOST and PORT values", () => {
    expect(readServerConfig({ HOST: "127.0.0.1", PORT: "4000" })).toEqual({
      host: "127.0.0.1",
      port: 4000,
    });
  });

  it("rejects port 0", () => {
    expect(() => readServerConfig({ PORT: "0" })).toThrow();
  });

  it("rejects port 65536", () => {
    expect(() => readServerConfig({ PORT: "65536" })).toThrow();
  });

  it("rejects a non-numeric port", () => {
    expect(() => readServerConfig({ PORT: "not-a-number" })).toThrow();
  });

  it("rejects an empty hostname", () => {
    expect(() => readServerConfig({ HOST: "" })).toThrow();
  });
});
