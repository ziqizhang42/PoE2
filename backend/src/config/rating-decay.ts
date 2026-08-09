import { z } from "zod";

import { boundedInteger } from "./bounded-integer.js";

const DAY_MS = 86_400_000;

/** Glicko guidance expresses inactivity in weekly periods. */
export const DEFAULT_RATING_PERIOD_DAYS = 7;
export const MAX_RATING_PERIOD_DAYS = 365;

/** Sweep frequency affects discovery latency, not decay rate. */
export const DEFAULT_RATING_DECAY_SWEEP_MS = 3_600_000;
export const MAX_RATING_DECAY_SWEEP_MS = 86_400_000;

export const DEFAULT_RATING_DECAY_BATCH = 500;
export const MAX_RATING_DECAY_BATCH = 50_000;

const environmentSchema = z.object({
  RATING_PERIOD_DAYS: boundedInteger(1, MAX_RATING_PERIOD_DAYS, DEFAULT_RATING_PERIOD_DAYS),
  RATING_DECAY_SWEEP_MS: boundedInteger(
    1_000,
    MAX_RATING_DECAY_SWEEP_MS,
    DEFAULT_RATING_DECAY_SWEEP_MS,
  ),
  RATING_DECAY_BATCH: boundedInteger(1, MAX_RATING_DECAY_BATCH, DEFAULT_RATING_DECAY_BATCH),
});

export interface RatingDecayConfig {
  readonly periodMs: number;
  readonly sweepMs: number;
  readonly batchSize: number;
}

export function readRatingDecayConfig(
  environment: Readonly<Record<string, string | undefined>>,
): RatingDecayConfig {
  const parsed = environmentSchema.parse(environment);

  return {
    periodMs: parsed.RATING_PERIOD_DAYS * DAY_MS,
    sweepMs: parsed.RATING_DECAY_SWEEP_MS,
    batchSize: parsed.RATING_DECAY_BATCH,
  };
}
