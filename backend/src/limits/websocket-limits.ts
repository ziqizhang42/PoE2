import type { WebSocketLimitsConfig } from "../config/ws-limits.js";
import { systemClock, systemScheduler, type MonotonicClock, type Scheduler } from "./clock.js";
import type { ConnectionRegistry } from "./connection-registry.js";
import { createMemoryConnectionRegistry } from "./memory/connection-registry.js";
import { createMemoryRateLimiter } from "./memory/rate-limiter.js";
import type { RateLimiter } from "./rate-limiter.js";

/** Releases an upgrade reservation if its socket handler never arrives. */
export const RESERVATION_CLAIM_TIMEOUT_MS = 5_000;

export interface WebSocketLimits {
  readonly userCommands: RateLimiter;
  readonly addressCommands: RateLimiter;
  readonly connections: ConnectionRegistry;
  readonly maxPendingCommands: number;
}

export interface WebSocketLimitsSeams {
  readonly clock?: MonotonicClock;
  readonly scheduler?: Scheduler;
}

export function createWebSocketLimits(
  config: WebSocketLimitsConfig,
  seams: WebSocketLimitsSeams = {},
): WebSocketLimits {
  const clock = seams.clock ?? systemClock;
  const scheduler = seams.scheduler ?? systemScheduler;

  return {
    // Separate key capacities prevent one limiter's cardinality from starving the other.
    userCommands: createMemoryRateLimiter({
      ...config.userCommands,
      maxKeys: config.maxKeys,
      clock,
    }),
    addressCommands: createMemoryRateLimiter({
      ...config.addressCommands,
      maxKeys: config.maxKeys,
      clock,
    }),
    connections: createMemoryConnectionRegistry({
      ...config.connections,
      claimTimeoutMs: RESERVATION_CLAIM_TIMEOUT_MS,
      scheduler,
    }),
    maxPendingCommands: config.maxPendingCommands,
  };
}
