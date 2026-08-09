import { describe, expect, it } from "vitest";

import { readWebSocketLimitsConfig } from "./ws-limits.js";

describe("readWebSocketLimitsConfig", () => {
  it("falls back to defaults when nothing is set", () => {
    const config = readWebSocketLimitsConfig({});

    expect(config.connections).toStrictEqual({ maxPerUser: 4, maxPerAddress: 24 });
    expect(config.userCommands).toStrictEqual({ capacity: 20, refillPerSecond: 5 });
    expect(config.addressCommands).toStrictEqual({ capacity: 60, refillPerSecond: 15 });
    expect(config.maxPendingCommands).toBe(8);
    expect(config.maxKeys).toBe(20_000);
  });

  it("reads every limit from the environment", () => {
    const config = readWebSocketLimitsConfig({
      WEBSOCKET_MAX_CONNECTIONS_PER_USER: "2",
      WEBSOCKET_MAX_CONNECTIONS_PER_ADDRESS: "9",
      WEBSOCKET_COMMAND_BURST: "7",
      WEBSOCKET_COMMANDS_PER_SECOND: "3",
      WEBSOCKET_ADDRESS_COMMAND_BURST: "31",
      WEBSOCKET_ADDRESS_COMMANDS_PER_SECOND: "11",
      WEBSOCKET_MAX_PENDING_COMMANDS: "5",
      WEBSOCKET_LIMIT_MAX_KEYS: "1234",
    });

    expect(config.connections).toStrictEqual({ maxPerUser: 2, maxPerAddress: 9 });
    expect(config.userCommands).toStrictEqual({ capacity: 7, refillPerSecond: 3 });
    expect(config.addressCommands).toStrictEqual({ capacity: 31, refillPerSecond: 11 });
    expect(config.maxPendingCommands).toBe(5);
    expect(config.maxKeys).toBe(1234);
  });

  it("tolerates surrounding whitespace", () => {
    expect(
      readWebSocketLimitsConfig({ WEBSOCKET_MAX_CONNECTIONS_PER_USER: " 6 " }).connections
        .maxPerUser,
    ).toBe(6);
  });

  it("rejects a value that is not a whole number", () => {
    expect(() => readWebSocketLimitsConfig({ WEBSOCKET_COMMAND_BURST: "1.5" })).toThrow();
    expect(() => readWebSocketLimitsConfig({ WEBSOCKET_COMMAND_BURST: "lots" })).toThrow();
    expect(() => readWebSocketLimitsConfig({ WEBSOCKET_COMMAND_BURST: "-2" })).toThrow();
  });

  it("rejects an empty value rather than reading it as zero", () => {
    expect(() => readWebSocketLimitsConfig({ WEBSOCKET_MAX_CONNECTIONS_PER_USER: "" })).toThrow();
    expect(() =>
      readWebSocketLimitsConfig({ WEBSOCKET_MAX_CONNECTIONS_PER_USER: "   " }),
    ).toThrow();
  });

  it("refuses a limit of zero, which would deny every connection", () => {
    expect(() => readWebSocketLimitsConfig({ WEBSOCKET_MAX_CONNECTIONS_PER_USER: "0" })).toThrow();
    expect(() => readWebSocketLimitsConfig({ WEBSOCKET_COMMANDS_PER_SECOND: "0" })).toThrow();
  });

  it("refuses a value past its ceiling, so a typo cannot become an allocation", () => {
    expect(() => readWebSocketLimitsConfig({ WEBSOCKET_MAX_CONNECTIONS_PER_USER: "65" })).toThrow();
    expect(() => readWebSocketLimitsConfig({ WEBSOCKET_LIMIT_MAX_KEYS: "1000001" })).toThrow();
    expect(() => readWebSocketLimitsConfig({ WEBSOCKET_MAX_PENDING_COMMANDS: "257" })).toThrow();
  });
});
