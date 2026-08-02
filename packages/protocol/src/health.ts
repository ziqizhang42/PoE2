import { z } from "zod";

export type HealthResponse = { status: "ok" };

export const HealthResponseSchema: z.ZodType<HealthResponse> = z.strictObject({
  status: z.literal("ok"),
});
