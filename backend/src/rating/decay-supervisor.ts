/** Runs non-overlapping decay passes; stored period boundaries provide catch-up. */

import type { Scheduler } from "../limits/clock.js";
import type { RatingDecay } from "./decay.js";

export interface RatingDecaySupervisorOptions {
  readonly decay: RatingDecay;
  readonly sweepMs: number;
  readonly scheduler: Scheduler;
  /** Bounds catch-up work performed by one tick. */
  readonly maxBatchesPerTick?: number;
  readonly onError: (error: unknown) => void;
  readonly onPass?: (decayed: number) => void;
}

export interface RatingDecaySupervisor {
  stop(): void;
}

const DEFAULT_MAX_BATCHES_PER_TICK = 20;

export function startRatingDecay(options: RatingDecaySupervisorOptions): RatingDecaySupervisor {
  const {
    decay,
    sweepMs,
    scheduler,
    maxBatchesPerTick = DEFAULT_MAX_BATCHES_PER_TICK,
    onError,
    onPass,
  } = options;

  let stopped = false;
  let cancel: (() => void) | null = null;

  const tick = async (): Promise<void> => {
    let decayed = 0;

    try {
      for (let batch = 0; batch < maxBatchesPerTick; batch += 1) {
        const pass = await decay.runOnce();
        decayed += pass.decayed;

        if (!pass.more || stopped) {
          break;
        }
      }

      if (decayed > 0) {
        onPass?.(decayed);
      }
    } catch (error) {
      // A later pass catches up from the stored boundary.
      onError(error);
    }

    schedule();
  };

  function schedule(): void {
    if (stopped) {
      return;
    }

    cancel = scheduler.schedule(() => void tick(), sweepMs);
  }

  schedule();

  return {
    stop() {
      stopped = true;
      cancel?.();
      cancel = null;
    },
  };
}
