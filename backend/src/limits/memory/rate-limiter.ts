import type { MonotonicClock } from "../clock.js";
import type { RateLimiter, RateLimitDecision } from "../rate-limiter.js";
import {
  draw,
  newBucket,
  reclaimableAfterMs,
  type TokenBucketOptions,
  type TokenBucketState,
} from "../token-bucket.js";

/**
 * In-process keyed token buckets. Live buckets are never evicted because doing
 * so would restore an attacker's budget; new keys fail closed at capacity.
 */
export interface MemoryRateLimiterOptions extends TokenBucketOptions {
  readonly maxKeys: number;
  readonly clock: MonotonicClock;
}

export interface MemoryRateLimiter extends RateLimiter {
  trackedKeys(): number;
}

export function createMemoryRateLimiter(options: MemoryRateLimiterOptions): MemoryRateLimiter {
  if (!Number.isInteger(options.maxKeys) || options.maxKeys < 1) {
    throw new RangeError("maxKeys must be a positive integer");
  }
  if (!Number.isFinite(options.capacity) || options.capacity <= 0) {
    throw new RangeError("capacity must be a positive number");
  }
  if (!Number.isFinite(options.refillPerSecond) || options.refillPerSecond <= 0) {
    throw new RangeError("refillPerSecond must be a positive number");
  }

  const buckets = new Map<string, TokenBucketState>();
  const idleMs = reclaimableAfterMs(options);

  // Bound attacker-triggered O(keys) sweeps to one per reclamation window.
  let lastSweptAtMs = Number.NEGATIVE_INFINITY;

  const sweep = (nowMs: number): void => {
    lastSweptAtMs = nowMs;

    for (const [key, state] of buckets) {
      if (nowMs - state.updatedAtMs >= idleMs) {
        buckets.delete(key);
      }
    }
  };

  const decide = (key: string): RateLimitDecision => {
    const nowMs = options.clock.now();
    let state = buckets.get(key);

    if (state === undefined) {
      if (buckets.size >= options.maxKeys && nowMs - lastSweptAtMs >= idleMs) {
        sweep(nowMs);
      }

      if (buckets.size >= options.maxKeys) {
        // An admitted but untracked key would bypass the limiter.
        return { allowed: false, retryAfterMs: idleMs };
      }

      state = newBucket(options, nowMs);
    }

    const drawn = draw(state, options, nowMs);
    buckets.set(key, drawn.state);

    return { allowed: drawn.allowed, retryAfterMs: drawn.retryAfterMs };
  };

  return {
    consume(key) {
      return Promise.resolve(decide(key));
    },

    trackedKeys() {
      return buckets.size;
    },
  };
}
