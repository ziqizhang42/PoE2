import { ReadinessResponseSchema } from "@poe2/protocol";
import { describe, expect, it, vi } from "vitest";

import { buildApp } from "../app.js";
import { readinessPlugin } from "./health.js";

describe("GET /ready", () => {
  it("reports ready after the dependency check succeeds", async () => {
    const check = vi.fn(async () => {});
    const app = buildApp();
    app.register(readinessPlugin, { check });

    try {
      const response = await app.inject({ method: "GET", url: "/ready" });

      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(ReadinessResponseSchema.parse(response.json())).toEqual({ status: "ok" });
      expect(check).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });

  it("reports unavailable without exposing the dependency failure", async () => {
    const check = vi.fn(() => Promise.reject(new Error("database credentials leaked here")));
    const app = buildApp();
    app.register(readinessPlugin, { check });

    try {
      const response = await app.inject({ method: "GET", url: "/ready" });

      expect(response.statusCode).toBe(503);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(ReadinessResponseSchema.parse(response.json())).toEqual({ status: "unavailable" });
      expect(response.body).not.toContain("credentials");
    } finally {
      await app.close();
    }
  });
});
