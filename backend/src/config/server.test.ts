import { describe, expect, it } from "vitest";

import { readServerConfig } from "./server.js";

describe("readServerConfig", () => {
  it("defaults to 0.0.0.0:3000 and trusts no proxy for an empty environment", () => {
    expect(readServerConfig({})).toEqual({
      listen: { host: "0.0.0.0", port: 3000 },
      instance: { trustProxy: false },
    });
  });

  it("parses string HOST and PORT values", () => {
    expect(readServerConfig({ HOST: "127.0.0.1", PORT: "4000" }).listen).toEqual({
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

  it("trusts no proxy when TRUST_PROXY_HOPS is 0", () => {
    expect(readServerConfig({ TRUST_PROXY_HOPS: "0" }).instance).toEqual({ trustProxy: false });
  });

  it("trusts exactly one hop when TRUST_PROXY_HOPS is 1", () => {
    expect(readServerConfig({ TRUST_PROXY_HOPS: "1" }).instance).toEqual({ trustProxy: 1 });
  });

  it.each(["2", "-1", "1.5", "true", "", "yes"])(
    "rejects the unsupported TRUST_PROXY_HOPS value %s",
    (hops) => {
      expect(() => readServerConfig({ TRUST_PROXY_HOPS: hops })).toThrow();
    },
  );

  it("never produces trustProxy true", () => {
    for (const hops of ["0", "1"]) {
      expect(readServerConfig({ TRUST_PROXY_HOPS: hops }).instance.trustProxy).not.toBe(true);
    }
  });
});
