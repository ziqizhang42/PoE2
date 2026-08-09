import { z } from "zod";

import type { TokenBucketOptions } from "../limits/token-bucket.js";
import { boundedInteger } from "./bounded-integer.js";

const DEFAULT_MAX_CONNECTIONS_PER_USER = 4;
const MAX_MAX_CONNECTIONS_PER_USER = 64;

/** Higher than the user cap to accommodate shared networks. */
const DEFAULT_MAX_CONNECTIONS_PER_ADDRESS = 24;
const MAX_MAX_CONNECTIONS_PER_ADDRESS = 1_024;

const DEFAULT_USER_COMMAND_BURST = 20;
const DEFAULT_USER_COMMANDS_PER_SECOND = 5;

const DEFAULT_ADDRESS_COMMAND_BURST = 60;
const DEFAULT_ADDRESS_COMMANDS_PER_SECOND = 15;

const MAX_COMMAND_BURST = 10_000;
const MAX_COMMANDS_PER_SECOND = 1_000;

const DEFAULT_MAX_PENDING_COMMANDS = 8;
const MAX_MAX_PENDING_COMMANDS = 256;

/** New keys are refused at this memory bound; active buckets are never evicted. */
const DEFAULT_LIMIT_MAX_KEYS = 20_000;
const MAX_LIMIT_MAX_KEYS = 1_000_000;

const wsLimitsEnvironmentSchema = z.object({
  WEBSOCKET_MAX_CONNECTIONS_PER_USER: boundedInteger(
    1,
    MAX_MAX_CONNECTIONS_PER_USER,
    DEFAULT_MAX_CONNECTIONS_PER_USER,
  ),
  WEBSOCKET_MAX_CONNECTIONS_PER_ADDRESS: boundedInteger(
    1,
    MAX_MAX_CONNECTIONS_PER_ADDRESS,
    DEFAULT_MAX_CONNECTIONS_PER_ADDRESS,
  ),
  WEBSOCKET_COMMAND_BURST: boundedInteger(1, MAX_COMMAND_BURST, DEFAULT_USER_COMMAND_BURST),
  WEBSOCKET_COMMANDS_PER_SECOND: boundedInteger(
    1,
    MAX_COMMANDS_PER_SECOND,
    DEFAULT_USER_COMMANDS_PER_SECOND,
  ),
  WEBSOCKET_ADDRESS_COMMAND_BURST: boundedInteger(
    1,
    MAX_COMMAND_BURST,
    DEFAULT_ADDRESS_COMMAND_BURST,
  ),
  WEBSOCKET_ADDRESS_COMMANDS_PER_SECOND: boundedInteger(
    1,
    MAX_COMMANDS_PER_SECOND,
    DEFAULT_ADDRESS_COMMANDS_PER_SECOND,
  ),
  WEBSOCKET_MAX_PENDING_COMMANDS: boundedInteger(
    1,
    MAX_MAX_PENDING_COMMANDS,
    DEFAULT_MAX_PENDING_COMMANDS,
  ),
  WEBSOCKET_LIMIT_MAX_KEYS: boundedInteger(1, MAX_LIMIT_MAX_KEYS, DEFAULT_LIMIT_MAX_KEYS),
});

export interface WebSocketConnectionLimits {
  readonly maxPerUser: number;
  readonly maxPerAddress: number;
}

export interface WebSocketLimitsConfig {
  readonly connections: WebSocketConnectionLimits;
  readonly userCommands: TokenBucketOptions;
  readonly addressCommands: TokenBucketOptions;
  readonly maxPendingCommands: number;
  readonly maxKeys: number;
}

export function readWebSocketLimitsConfig(
  environment: Readonly<Record<string, string | undefined>>,
): WebSocketLimitsConfig {
  const parsed = wsLimitsEnvironmentSchema.parse(environment);

  return {
    connections: {
      maxPerUser: parsed.WEBSOCKET_MAX_CONNECTIONS_PER_USER,
      maxPerAddress: parsed.WEBSOCKET_MAX_CONNECTIONS_PER_ADDRESS,
    },
    userCommands: {
      capacity: parsed.WEBSOCKET_COMMAND_BURST,
      refillPerSecond: parsed.WEBSOCKET_COMMANDS_PER_SECOND,
    },
    addressCommands: {
      capacity: parsed.WEBSOCKET_ADDRESS_COMMAND_BURST,
      refillPerSecond: parsed.WEBSOCKET_ADDRESS_COMMANDS_PER_SECOND,
    },
    maxPendingCommands: parsed.WEBSOCKET_MAX_PENDING_COMMANDS,
    maxKeys: parsed.WEBSOCKET_LIMIT_MAX_KEYS,
  };
}
