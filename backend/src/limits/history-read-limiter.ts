/** Independent public-history budget, scaled down for per-page replay work. */

import type { WebSocketLimitsConfig } from "../config/ws-limits.js";
import { systemClock, type MonotonicClock } from "./clock.js";
import { createMemoryRateLimiter } from "./memory/rate-limiter.js";
import type { RateLimiter } from "./rate-limiter.js";

const COST_RATIO = 10;

const MINIMUM_BURST = 4;
const MINIMUM_PER_SECOND = 1;

export function createHistoryReadLimiter(
  config: WebSocketLimitsConfig,
  clock: MonotonicClock = systemClock,
): RateLimiter {
  const { capacity, refillPerSecond } = config.addressCommands;

  return createMemoryRateLimiter({
    capacity: Math.max(MINIMUM_BURST, Math.floor(capacity / COST_RATIO)),
    refillPerSecond: Math.max(MINIMUM_PER_SECOND, refillPerSecond / COST_RATIO),
    maxKeys: config.maxKeys,
    clock,
  });
}
