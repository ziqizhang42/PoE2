import type { WsServerMessage } from "@poe2/protocol";
import { describe, expect, it, vi } from "vitest";

import {
  GAME_ID,
  lobbyEntry,
  OTHER_GAME_ID,
  sessionReady,
  USER_ONE,
  USER_TWO,
  waitingGame,
} from "../test/fakes.ts";
import type { LiveClock } from "./clock.ts";
import {
  createLiveClient,
  parseServerMessage,
  reconnectDelayMs,
  type LiveClient,
  type LiveClientOptions,
} from "./client.ts";
import type { LiveSocketFactory, LiveSocketHandlers } from "./socket.ts";

const SOCKET_URL = "ws://localhost:5173/api/ws";
const ABNORMAL_CLOSURE = 1006;
const POLICY_VIOLATION = 1008;

/** Deterministic, schema-valid request IDs so correlation can be asserted. */
function requestId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

interface FakeSocket {
  readonly url: string;
  readonly sent: string[];
  readonly handlers: LiveSocketHandlers;
  closed: { code: number; reason: string } | null;
}

interface FakeTimer {
  readonly callback: () => void;
  readonly delayMs: number;
  cancelled: boolean;
  fired: boolean;
}

interface Harness {
  readonly client: LiveClient;
  readonly sockets: FakeSocket[];
  readonly timers: FakeTimer[];
  readonly suspect: () => void;
  socket(index?: number): FakeSocket;
  deliver(message: WsServerMessage | string, index?: number): void;
  close(code: number, index?: number): void;
  pendingTimers(): FakeTimer[];
  fireTimers(): void;
  sent(index?: number): unknown[];
}

function createHarness(overrides: LiveClientOptions = {}): Harness {
  const sockets: FakeSocket[] = [];
  const timers: FakeTimer[] = [];
  const suspect = vi.fn<() => void>();
  let nextRequestId = 0;

  const createSocket: LiveSocketFactory = (url, handlers) => {
    const socket: FakeSocket = { url, sent: [], handlers, closed: null };
    sockets.push(socket);

    return {
      send(payload) {
        if (socket.closed !== null) {
          throw new Error("socket is closed");
        }
        socket.sent.push(payload);
      },
      close(code, reason) {
        socket.closed = { code, reason };
      },
    };
  };

  const clock: LiveClock = {
    schedule(callback, delayMs) {
      const timer: FakeTimer = { callback, delayMs, cancelled: false, fired: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  };

  const client = createLiveClient({
    createSocket,
    clock,
    resolveUrl: () => SOCKET_URL,
    createRequestId: () => requestId(nextRequestId++),
    random: () => 0.5,
    onSessionSuspect: suspect,
    ...overrides,
  });

  const socketAt = (index = sockets.length - 1): FakeSocket => {
    const socket = sockets[index];
    if (socket === undefined) {
      throw new Error(`no socket at index ${index}`);
    }
    return socket;
  };

  const pendingTimers = (): FakeTimer[] =>
    timers.filter((timer) => !timer.cancelled && !timer.fired);

  return {
    client,
    sockets,
    timers,
    suspect,
    socket: socketAt,
    deliver(message, index) {
      socketAt(index).handlers.onMessage(
        typeof message === "string" ? message : JSON.stringify(message),
      );
    },
    close(code, index) {
      socketAt(index).handlers.onClose(code);
    },
    pendingTimers,
    fireTimers() {
      for (const timer of pendingTimers()) {
        timer.fired = true;
        timer.callback();
      }
    },
    sent: (index) => socketAt(index).sent.map((payload) => JSON.parse(payload) as unknown),
  };
}

/** Brings a harness to the point where commands are accepted. */
function connected(overrides: LiveClientOptions = {}): Harness {
  const harness = createHarness(overrides);
  harness.client.start(USER_ONE.id);
  harness.deliver(sessionReady());
  return harness;
}

describe("connection lifecycle", () => {
  it("opens one same-origin socket once a user is confirmed", () => {
    const harness = createHarness();
    harness.client.start(USER_ONE.id);

    expect(harness.sockets).toHaveLength(1);
    expect(harness.socket().url).toBe(SOCKET_URL);
    expect(harness.client.store.getState().status).toBe("connecting");
    expect(harness.client.store.getState().userId).toBe(USER_ONE.id);
  });

  it("becomes ready only when the server has confirmed the session", () => {
    const harness = createHarness();
    harness.client.start(USER_ONE.id);

    expect(harness.client.store.getState().status).toBe("connecting");

    harness.deliver(sessionReady());

    expect(harness.client.store.getState().status).toBe("ready");
  });

  it("does not open a second socket for a user it is already serving", () => {
    const harness = connected();
    harness.client.start(USER_ONE.id);

    expect(harness.sockets).toHaveLength(1);
    expect(harness.socket().closed).toBeNull();
  });

  it("discards the previous user's state when a different user starts", () => {
    const harness = connected();
    harness.deliver({ type: "lobby.snapshot", lobbies: [lobbyEntry()] });

    harness.client.start(USER_TWO.id);

    expect(harness.socket(0).closed).toEqual({ code: 1000, reason: "client shutdown" });
    expect(harness.sockets).toHaveLength(2);
    expect(harness.client.store.getState().lobbies).toEqual([]);
    expect(harness.client.store.getState().userId).toBe(USER_TWO.id);
  });

  it("closes the socket and clears live state when the user signs out", () => {
    const harness = connected();
    harness.deliver({ type: "game.snapshot", game: waitingGame() });

    harness.client.stop();

    expect(harness.socket().closed).not.toBeNull();
    expect(harness.client.store.getState()).toMatchObject({
      status: "idle",
      userId: null,
      games: [],
      lobbies: [],
    });
  });

  it("ignores frames from a socket it has already abandoned", () => {
    const harness = connected();
    const abandoned = harness.socket(0);

    harness.client.stop();
    abandoned.handlers.onMessage(
      JSON.stringify({ type: "lobby.snapshot", lobbies: [lobbyEntry()] }),
    );
    abandoned.handlers.onClose(ABNORMAL_CLOSURE);

    expect(harness.client.store.getState().lobbies).toEqual([]);
    expect(harness.client.store.getState().status).toBe("idle");
    expect(harness.pendingTimers()).toHaveLength(0);
  });

  it("gives up the connection when the server names a different user", () => {
    const harness = createHarness();
    harness.client.start(USER_ONE.id);
    harness.deliver(sessionReady(USER_TWO));

    expect(harness.client.store.getState()).toMatchObject({
      status: "unauthenticated",
      userId: null,
    });
    expect(harness.socket().closed).not.toBeNull();
    expect(harness.suspect).toHaveBeenCalled();
  });
});

describe("server messages", () => {
  it("applies the authoritative lobby list as sent", () => {
    const harness = connected();
    harness.deliver({ type: "lobby.snapshot", lobbies: [lobbyEntry()] });

    expect(harness.client.store.getState().lobbies).toEqual([lobbyEntry()]);
  });

  it("upserts a game snapshot by id", () => {
    const harness = connected();
    harness.deliver({ type: "game.snapshot", game: waitingGame() });
    harness.deliver({ type: "game.snapshot", game: waitingGame(OTHER_GAME_ID) });
    harness.deliver({ type: "game.snapshot", game: { ...waitingGame(), revision: 0 } });

    expect(harness.client.store.getState().games.map((game) => game.id)).toEqual([
      GAME_ID,
      OTHER_GAME_ID,
    ]);
  });

  it("drops a game the server closed", () => {
    const harness = connected();
    harness.deliver({ type: "game.snapshot", game: waitingGame() });
    harness.deliver({ type: "game.closed", gameId: GAME_ID });

    expect(harness.client.store.getState().games).toEqual([]);
  });

  it("replaces everything the previous socket held once a reconnect is confirmed", () => {
    const harness = connected();
    harness.deliver({ type: "game.snapshot", game: waitingGame() });

    harness.close(ABNORMAL_CLOSURE);
    harness.fireTimers();
    harness.deliver(sessionReady());

    expect(harness.client.store.getState().games).toEqual([]);
    expect(harness.client.store.getState().status).toBe("ready");
  });

  it.each([
    ["invalid JSON", "not json at all"],
    ["an unknown type", JSON.stringify({ type: "lobby.exploded" })],
    ["a snapshot that fails the schema", JSON.stringify({ type: "lobby.snapshot", lobbies: 7 })],
    ["a non-object body", JSON.stringify([1, 2, 3])],
  ])("ignores %s without disturbing the connection", (_label, payload) => {
    const harness = connected();
    harness.deliver({ type: "lobby.snapshot", lobbies: [lobbyEntry()] });

    harness.deliver(payload);

    expect(harness.client.store.getState().lobbies).toEqual([lobbyEntry()]);
    expect(harness.client.store.getState().status).toBe("ready");
  });
});

describe("commands", () => {
  it("sends every supported command in the shared shape", () => {
    const harness = connected();

    void harness.client.createLobby();
    void harness.client.joinLobby(GAME_ID);
    void harness.client.cancelLobby(GAME_ID);
    void harness.client.playMove({
      gameId: GAME_ID,
      expectedRevision: 4,
      square: { row: 3, col: 3 },
    });

    expect(harness.sent()).toEqual([
      { type: "lobby.create", requestId: requestId(0) },
      { type: "lobby.join", requestId: requestId(1), gameId: GAME_ID },
      { type: "lobby.cancel", requestId: requestId(2), gameId: GAME_ID },
      {
        type: "game.move",
        requestId: requestId(3),
        gameId: GAME_ID,
        expectedRevision: 4,
        square: { row: 3, col: 3 },
      },
    ]);
  });

  it("settles a command with the acceptance that echoes its request ID", async () => {
    const harness = connected();
    const result = harness.client.createLobby();

    harness.deliver({ type: "command.accepted", requestId: requestId(0) });

    await expect(result).resolves.toEqual({ ok: true, requestId: requestId(0) });
  });

  it("settles the right command when several are outstanding", async () => {
    const harness = connected();
    const first = harness.client.createLobby();
    const second = harness.client.joinLobby(GAME_ID);

    harness.deliver({
      type: "command.rejected",
      requestId: requestId(1),
      code: "cannot_join_own_game",
      message: "You cannot join your own lobby",
    });
    harness.deliver({ type: "command.accepted", requestId: requestId(0) });

    await expect(second).resolves.toEqual({
      ok: false,
      requestId: requestId(1),
      failure: "rejected",
      code: "cannot_join_own_game",
      message: "You cannot join your own lobby",
    });
    await expect(first).resolves.toEqual({ ok: true, requestId: requestId(0) });
    expect(harness.client.store.getState().lastRejection).toBeNull();
  });

  it("records a rejection that names no command", () => {
    const harness = connected();

    harness.deliver({
      type: "command.rejected",
      requestId: null,
      code: "invalid_message",
      message: "Message did not match the protocol",
    });

    expect(harness.client.store.getState().lastRejection).toEqual({
      requestId: null,
      code: "invalid_message",
      message: "Message did not match the protocol",
    });
  });

  it("refuses a command while the connection is not ready", async () => {
    const harness = createHarness();
    harness.client.start(USER_ONE.id);

    await expect(harness.client.createLobby()).resolves.toMatchObject({
      ok: false,
      failure: "not_connected",
    });
    expect(harness.socket().sent).toEqual([]);
  });

  it("settles every outstanding command when the connection drops", async () => {
    const harness = connected();
    const pending = harness.client.createLobby();

    harness.close(ABNORMAL_CLOSURE);

    await expect(pending).resolves.toMatchObject({
      ok: false,
      requestId: requestId(0),
      failure: "connection_lost",
    });
  });

  it("settles a command the server never answers", async () => {
    const harness = connected();
    const pending = harness.client.createLobby();

    harness.fireTimers();

    await expect(pending).resolves.toMatchObject({ ok: false, failure: "timed_out" });
  });

  it("settles outstanding commands when the user signs out", async () => {
    const harness = connected();
    const pending = harness.client.createLobby();

    harness.client.stop();

    await expect(pending).resolves.toMatchObject({ ok: false, failure: "connection_lost" });
  });
});

describe("reconnection", () => {
  it("retries with bounded exponential backoff", () => {
    const harness = connected();

    harness.close(ABNORMAL_CLOSURE);
    expect(harness.pendingTimers()[0]?.delayMs).toBe(375);
    expect(harness.client.store.getState()).toMatchObject({
      status: "reconnecting",
      reconnectAttempts: 1,
    });

    harness.fireTimers();
    expect(harness.sockets).toHaveLength(2);
    expect(harness.client.store.getState().status).toBe("reconnecting");

    harness.close(ABNORMAL_CLOSURE);
    expect(harness.pendingTimers()[0]?.delayMs).toBe(750);

    harness.fireTimers();
    harness.close(ABNORMAL_CLOSURE);
    expect(harness.pendingTimers()[0]?.delayMs).toBe(1500);
  });

  it("resets the backoff once a session is confirmed again", () => {
    const harness = connected();

    harness.close(ABNORMAL_CLOSURE);
    harness.fireTimers();
    harness.close(ABNORMAL_CLOSURE);
    harness.fireTimers();
    harness.deliver(sessionReady());

    expect(harness.client.store.getState().reconnectAttempts).toBe(0);

    harness.close(ABNORMAL_CLOSURE);

    expect(harness.pendingTimers()[0]?.delayMs).toBe(375);
  });

  it("asks for the session to be re-checked when a socket fails before it is established", () => {
    const harness = createHarness();
    harness.client.start(USER_ONE.id);

    harness.close(ABNORMAL_CLOSURE);

    expect(harness.suspect).toHaveBeenCalledTimes(1);
  });

  it("does not treat an established connection dropping as a session problem", () => {
    const harness = connected();

    harness.close(ABNORMAL_CLOSURE);

    expect(harness.suspect).not.toHaveBeenCalled();
  });

  it("does not reconnect after a policy close", () => {
    const harness = connected();

    harness.close(POLICY_VIOLATION);

    expect(harness.client.store.getState().status).toBe("unauthenticated");
    expect(harness.pendingTimers()).toHaveLength(0);
    expect(harness.suspect).toHaveBeenCalledTimes(1);
  });

  it("does not reconnect after a deliberate shutdown", () => {
    const harness = connected();
    harness.deliver({ type: "game.snapshot", game: waitingGame() });

    harness.client.disconnect();

    expect(harness.client.store.getState().status).toBe("disconnected");
    expect(harness.pendingTimers()).toHaveLength(0);
    expect(harness.client.store.getState().games).toHaveLength(1);
  });

  it("cancels a scheduled retry when the user signs out first", () => {
    const harness = connected();
    harness.close(ABNORMAL_CLOSURE);

    harness.client.stop();
    harness.fireTimers();

    expect(harness.sockets).toHaveLength(1);
    expect(harness.client.store.getState().status).toBe("idle");
  });
});

describe("reconnectDelayMs", () => {
  it("grows exponentially and stops at the ceiling", () => {
    const delays = [0, 1, 2, 6, 20].map((attempt) => reconnectDelayMs(attempt, () => 1));

    expect(delays).toEqual([500, 1000, 2000, 30_000, 30_000]);
  });

  it("never drops below half the ceiling, so retries stay spread out", () => {
    expect(reconnectDelayMs(0, () => 0)).toBe(250);
    expect(reconnectDelayMs(3, () => 0)).toBe(2000);
  });
});

describe("parseServerMessage", () => {
  it("returns the validated message", () => {
    expect(parseServerMessage(JSON.stringify(sessionReady()))).toEqual(sessionReady());
  });

  it.each(["", "{", JSON.stringify({ type: "session.ready", protocolVersion: 2, user: USER_ONE })])(
    "returns null for %s",
    (payload) => {
      expect(parseServerMessage(payload)).toBeNull();
    },
  );
});
