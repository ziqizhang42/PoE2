import { describe, expect, it } from "vitest";

import type { Scheduler } from "../limits/clock.js";
import { startRatingDecay } from "./decay-supervisor.js";
import type { RatingDecay, RatingDecayPass } from "./decay.js";

function manualScheduler() {
  const pending: (() => void)[] = [];

  const scheduler: Scheduler = {
    schedule(callback) {
      pending.push(callback);
      return () => {
        const index = pending.indexOf(callback);
        if (index >= 0) {
          pending.splice(index, 1);
        }
      };
    },
  };

  return {
    scheduler,
    get depth() {
      return pending.length;
    },
    async fire() {
      const next = pending.shift();
      next?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

function decayReturning(passes: readonly RatingDecayPass[]): RatingDecay & { calls: number } {
  let call = 0;

  return {
    get calls() {
      return call;
    },
    runOnce() {
      const pass = passes[Math.min(call, passes.length - 1)];
      call += 1;
      return Promise.resolve(pass ?? { decayed: 0, more: false });
    },
  };
}

const errors: unknown[] = [];
const onError = (error: unknown) => errors.push(error);

describe("startRatingDecay", () => {
  it("drains further batches while a pass reports more work", async () => {
    const timer = manualScheduler();
    const decay = decayReturning([
      { decayed: 2, more: true },
      { decayed: 2, more: true },
      { decayed: 1, more: false },
    ]);
    const passes: number[] = [];

    const supervisor = startRatingDecay({
      decay,
      sweepMs: 1_000,
      scheduler: timer.scheduler,
      onError,
      onPass: (decayed) => passes.push(decayed),
    });
    await timer.fire();

    expect(decay.calls).toBe(3);
    expect(passes).toEqual([5]);
    supervisor.stop();
  });

  it("stops draining at the batch cap so one tick cannot run away", async () => {
    const timer = manualScheduler();
    const decay = decayReturning([{ decayed: 1, more: true }]);

    const supervisor = startRatingDecay({
      decay,
      sweepMs: 1_000,
      scheduler: timer.scheduler,
      maxBatchesPerTick: 3,
      onError,
    });
    await timer.fire();

    expect(decay.calls).toBe(3);
    supervisor.stop();
  });

  it("reports a failed pass and schedules the next one anyway", async () => {
    const timer = manualScheduler();
    errors.length = 0;
    const failure = new Error("database unavailable");
    const decay: RatingDecay = {
      runOnce: () => Promise.reject(failure),
    };

    const supervisor = startRatingDecay({
      decay,
      sweepMs: 1_000,
      scheduler: timer.scheduler,
      onError,
    });
    await timer.fire();

    expect(errors).toEqual([failure]);
    expect(timer.depth).toBe(1);
    supervisor.stop();
  });

  it("never overlaps ticks: the next is scheduled only once the last finishes", async () => {
    const timer = manualScheduler();
    const decay = decayReturning([{ decayed: 0, more: false }]);

    const supervisor = startRatingDecay({
      decay,
      sweepMs: 1_000,
      scheduler: timer.scheduler,
      onError,
    });

    expect(timer.depth).toBe(1);
    await timer.fire();
    expect(timer.depth).toBe(1);

    supervisor.stop();
    expect(timer.depth).toBe(0);
  });

  it("schedules nothing further once stopped", async () => {
    const timer = manualScheduler();
    const decay = decayReturning([{ decayed: 0, more: false }]);

    const supervisor = startRatingDecay({
      decay,
      sweepMs: 1_000,
      scheduler: timer.scheduler,
      onError,
    });
    supervisor.stop();
    await timer.fire();

    expect(decay.calls).toBe(0);
    expect(timer.depth).toBe(0);
  });
});
