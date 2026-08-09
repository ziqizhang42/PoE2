/** Stateless token-bucket arithmetic over caller-supplied timestamps. */

const MS_PER_SECOND = 1_000;

export interface TokenBucketOptions {
  readonly capacity: number;
  readonly refillPerSecond: number;
}

export interface TokenBucketState {
  readonly tokens: number;
  readonly updatedAtMs: number;
}

export interface TokenBucketDraw {
  readonly state: TokenBucketState;
  readonly allowed: boolean;
  readonly retryAfterMs: number;
}

export function newBucket(options: TokenBucketOptions, nowMs: number): TokenBucketState {
  return { tokens: options.capacity, updatedAtMs: nowMs };
}

export function draw(
  state: TokenBucketState,
  options: TokenBucketOptions,
  nowMs: number,
  cost = 1,
): TokenBucketDraw {
  // A backwards clock must not remove tokens.
  const elapsedMs = Math.max(0, nowMs - state.updatedAtMs);
  const refilled = (elapsedMs / MS_PER_SECOND) * options.refillPerSecond;
  const tokens = Math.min(options.capacity, state.tokens + refilled);

  if (tokens >= cost) {
    return {
      state: { tokens: tokens - cost, updatedAtMs: nowMs },
      allowed: true,
      retryAfterMs: 0,
    };
  }

  // Rejected retries do not deepen the deficit.
  return {
    state: { tokens, updatedAtMs: nowMs },
    allowed: false,
    retryAfterMs: Math.ceil(((cost - tokens) / options.refillPerSecond) * MS_PER_SECOND),
  };
}

/** Earliest safe time for a store to forget this bucket. */
export function reclaimableAfterMs(options: TokenBucketOptions): number {
  return Math.ceil((options.capacity / options.refillPerSecond) * MS_PER_SECOND);
}
