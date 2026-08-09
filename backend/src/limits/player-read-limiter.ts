import type { WebSocketLimitsConfig } from "../config/ws-limits.js";
import { systemClock, type MonotonicClock } from "./clock.js";
import { createMemoryRateLimiter } from "./memory/rate-limiter.js";
import type { RateLimiter } from "./rate-limiter.js";

/** One independent address bucket for a public profile or replay surface. */
export function createPlayerReadLimiter(
  config: WebSocketLimitsConfig,
  clock: MonotonicClock = systemClock,
): RateLimiter {
  return createMemoryRateLimiter({
    ...config.addressCommands,
    maxKeys: config.maxKeys,
    clock,
  });
}
