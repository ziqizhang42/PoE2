import { describe, expect, it } from "vitest";
import { HealthResponseSchema, ReadinessResponseSchema } from "./health.js";

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

describe("ReadinessResponseSchema", () => {
  it.each(["ok", "unavailable"])("accepts the %s status", (status) => {
    expect(ReadinessResponseSchema.safeParse({ status }).success).toBe(true);
  });

  it("rejects an unknown status", () => {
    expect(ReadinessResponseSchema.safeParse({ status: "starting" }).success).toBe(false);
  });

  it("rejects extra properties", () => {
    expect(ReadinessResponseSchema.safeParse({ status: "ok", database: "ok" }).success).toBe(false);
  });
});
