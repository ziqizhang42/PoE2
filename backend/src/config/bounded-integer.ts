import { z } from "zod";

/** Rejects blank coercions and caps allocation-driving environment values. */
export function boundedInteger(minimum: number, maximum: number, fallback: number) {
  return z
    .string()
    .trim()
    .regex(/^\d+$/u, "must be a whole number")
    .transform(Number)
    .pipe(z.number().int().min(minimum).max(maximum))
    .default(fallback);
}
