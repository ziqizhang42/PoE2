import { z } from "zod";

import type { KdfExecutorOptions } from "../auth/kdf-executor.js";

/**
 * Two concurrent Argon2 operations put current-policy hashing at ~128 MiB of
 * peak memory (2 x 64 MiB) and leave room on the default four-thread libuv pool
 * for the rest of the process.
 *
 * The true worst case is higher: a hash stored under some other accepted policy
 * may ask for up to `PARAMETER_BOUNDS.memoryKiB.max` (256 MiB), so two of those
 * together reach ~512 MiB. Raising this value multiplies that ceiling.
 */
export const DEFAULT_KDF_MAX_CONCURRENT = 2;

/**
 * A short queue smooths bursts without letting clients pile up unbounded work.
 * At roughly a quarter second per hash, 16 waiters is a couple of seconds of
 * backlog, after which shedding load is a better answer than queueing more.
 */
export const DEFAULT_KDF_MAX_QUEUED = 16;

const MAX_KDF_MAX_CONCURRENT = 64;
const MAX_KDF_MAX_QUEUED = 1_024;

function boundedInteger(minimum: number, maximum: number, fallback: number) {
  return z
    .string()
    .trim()
    .regex(/^\d+$/u, "must be a whole number")
    .transform(Number)
    .pipe(z.number().int().min(minimum).max(maximum))
    .default(fallback);
}

const kdfEnvironmentSchema = z.object({
  PASSWORD_KDF_MAX_CONCURRENT: boundedInteger(
    1,
    MAX_KDF_MAX_CONCURRENT,
    DEFAULT_KDF_MAX_CONCURRENT,
  ),
  PASSWORD_KDF_MAX_QUEUED: boundedInteger(0, MAX_KDF_MAX_QUEUED, DEFAULT_KDF_MAX_QUEUED),
});

export function readKdfConfig(
  environment: Readonly<Record<string, string | undefined>>,
): KdfExecutorOptions {
  const parsed = kdfEnvironmentSchema.parse(environment);

  return {
    maxConcurrent: parsed.PASSWORD_KDF_MAX_CONCURRENT,
    maxQueued: parsed.PASSWORD_KDF_MAX_QUEUED,
  };
}
