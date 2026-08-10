import { z } from "zod";

export type HealthResponse = { status: "ok" };

export const HealthResponseSchema: z.ZodType<HealthResponse> = z.strictObject({
  status: z.literal("ok"),
});

export type ReadinessResponse = { status: "ok" | "unavailable" };

export const ReadinessResponseSchema: z.ZodType<ReadinessResponse> = z.strictObject({
  status: z.enum(["ok", "unavailable"]),
});
