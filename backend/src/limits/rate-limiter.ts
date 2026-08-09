/** Async so an external shared store can replace the in-memory implementation. */

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterMs: number;
}

export interface RateLimiter {
  consume(key: string): Promise<RateLimitDecision>;
}

export const ALLOWED: RateLimitDecision = { allowed: true, retryAfterMs: 0 };

export const unlimited: RateLimiter = {
  consume() {
    return Promise.resolve(ALLOWED);
  },
};
