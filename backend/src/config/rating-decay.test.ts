import { describe, expect, it } from "vitest";

import {
  DEFAULT_RATING_DECAY_BATCH,
  DEFAULT_RATING_DECAY_SWEEP_MS,
  DEFAULT_RATING_PERIOD_DAYS,
  MAX_RATING_PERIOD_DAYS,
  readRatingDecayConfig,
} from "./rating-decay.js";

const DAY_MS = 86_400_000;

describe("readRatingDecayConfig", () => {
  it("falls back to a weekly period when nothing is set", () => {
    expect(readRatingDecayConfig({})).toEqual({
      periodMs: DEFAULT_RATING_PERIOD_DAYS * DAY_MS,
      sweepMs: DEFAULT_RATING_DECAY_SWEEP_MS,
      batchSize: DEFAULT_RATING_DECAY_BATCH,
    });
  });

  it("reads the period in days and hands it on in milliseconds", () => {
    expect(readRatingDecayConfig({ RATING_PERIOD_DAYS: "30" }).periodMs).toBe(30 * DAY_MS);
  });

  it("reads the sweep interval and the batch size", () => {
    const config = readRatingDecayConfig({
      RATING_DECAY_SWEEP_MS: "60000",
      RATING_DECAY_BATCH: "25",
    });

    expect(config.sweepMs).toBe(60_000);
    expect(config.batchSize).toBe(25);
  });

  it("refuses a period of zero days rather than decaying on every sweep", () => {
    expect(() => readRatingDecayConfig({ RATING_PERIOD_DAYS: "0" })).toThrow();
  });

  it("refuses a period beyond the ceiling", () => {
    expect(() =>
      readRatingDecayConfig({ RATING_PERIOD_DAYS: String(MAX_RATING_PERIOD_DAYS + 1) }),
    ).toThrow();
  });

  it("refuses a value that is not a whole number", () => {
    expect(() => readRatingDecayConfig({ RATING_PERIOD_DAYS: "7.5" })).toThrow();
    expect(() => readRatingDecayConfig({ RATING_DECAY_BATCH: "" })).toThrow();
  });
});
