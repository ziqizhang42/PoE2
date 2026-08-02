import { describe, expect, it } from "vitest";
import { HealthResponseSchema } from "./health.js";

describe("HealthResponseSchema", () => {
  it("accepts a valid health response", () => {
    expect(HealthResponseSchema.safeParse({ status: "ok" }).success).toBe(true);
  });

  it("rejects a different status", () => {
    expect(HealthResponseSchema.safeParse({ status: "not-ok" }).success).toBe(false);
  });

  it("rejects a missing status", () => {
    expect(HealthResponseSchema.safeParse({}).success).toBe(false);
  });

  it("rejects extra properties", () => {
    expect(HealthResponseSchema.safeParse({ status: "ok", extra: true }).success).toBe(false);
  });
});
