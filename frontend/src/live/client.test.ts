import { WS_PROTOCOL_VERSION, type WsServerMessage } from "@poe2/protocol";
import { PLAYER_ONE, PLAYER_TWO } from "@poe2/rules";
import { describe, expect, it, vi } from "vitest";

import {
  createFakeClock,
  finishedGame,
  GAME_ID,
  lobbyEntry,
  OTHER_GAME_ID,
  sessionReady,
  USER_ONE,
  USER_TWO,
  waitingGame,
  type FakeClock,
  type FakeTimer,
} from "../test/fakes.ts";
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
const PROTOCOL_ERROR = 1002;

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

interface Harness {
  readonly client: LiveClient;
  readonly clock: FakeClock;
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
  const clock = createFakeClock();
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

  return {
    client,
    clock,
    sockets,
    timers: clock.timers,
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
    pendingTimers: clock.pending,
    fireTimers: clock.fire,
    sent: (index) => socketAt(index).sent.map((payload) => JSON.parse(payload) as unknown),
  };
}

/** Brings a harness to the point where commands are accepted. */
function connected(overrides: LiveClientOptions = {}): Harness {
  const harness = createHarness(overrides);
  harness.client.start(USER_ONE.id);
  harness.deliver(sessionReady());
  harness.deliver({ type: "session.synced" });
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

  it("becomes ready only once the server has finished the opening sync", () => {
    const harness = createHarness();
    harness.client.start(USER_ONE.id);

    expect(harness.client.store.getState().status).toBe("connecting");

    harness.deliver(sessionReady());

    expect(harness.client.store.getState()).toMatchObject({
      status: "connecting",
      userId: USER_ONE.id,
      synced: false,
    });

    harness.deliver({ type: "session.synced" });

    expect(harness.client.store.getState().status).toBe("ready");
  });

  it("is not synced until the server says the opening state is complete", () => {
    const harness = createHarness();
    harness.client.start(USER_ONE.id);
    harness.deliver(sessionReady());

    // `session.ready` precedes the reads that produce the opening snapshots, so
    // on its own it rules nothing out.
    expect(harness.client.store.getState().synced).toBe(false);

    harness.deliver({ type: "lobby.snapshot", lobbies: [] });
    expect(harness.client.store.getState().synced).toBe(false);

    harness.deliver({ type: "session.synced" });
    expect(harness.client.store.getState().synced).toBe(true);
  });

  it("fails closed when session.ready advertises another protocol version", async () => {
    const harness = createHarness();
    harness.client.start(USER_ONE.id);
    harness.deliver(
      JSON.stringify({
        type: "session.ready",
        protocolVersion: WS_PROTOCOL_VERSION + 1,
        user: USER_ONE,
      }),
    );

    expect(harness.client.store.getState()).toMatchObject({
      status: "disconnected",
      synced: false,
    });
    expect(harness.socket().closed).toEqual({
      code: PROTOCOL_ERROR,
      reason: "server protocol did not match",
    });
    expect(harness.pendingTimers()).toEqual([]);

    // Callbacks from the abandoned generation cannot revive it.
    harness.deliver({ type: "session.synced" });
    expect(harness.client.store.getState().status).toBe("disconnected");
    await expect(harness.client.createLobby(false)).resolves.toMatchObject({
      ok: false,
      failure: "not_connected",
    });
  });

  it("stops being synced when a reconnect replays the opening sequence", () => {
    const harness = connected();
    expect(harness.client.store.getState().synced).toBe(true);

    harness.close(ABNORMAL_CLOSURE);
    harness.fireTimers();
    harness.deliver(sessionReady());

    expect(harness.client.store.getState()).toMatchObject({
      status: "reconnecting",
      synced: false,
    });
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

  it("replaces player presence and activity exactly as sent", () => {
    const harness = connected();
    const players = [
      { id: USER_ONE.id, online: true, activity: "open_room" as const },
      { id: USER_TWO.id, online: false, activity: "in_game" as const },
    ];

    harness.deliver({ type: "players.status", players });
    expect(harness.client.store.getState().playerStatuses).toEqual(players);

    harness.deliver({
      type: "players.status",
      players: [{ id: USER_ONE.id, online: true, activity: null }],
    });
    expect(harness.client.store.getState().playerStatuses).toEqual([
      { id: USER_ONE.id, online: true, activity: null },
    ]);
  });

  it("invalidates the directory when durable player data changed", () => {
    const onPlayerDirectoryStale = vi.fn<() => void>();
    const harness = connected({ onPlayerDirectoryStale });

    harness.deliver({ type: "players.changed" });

    expect(onPlayerDirectoryStale).toHaveBeenCalledTimes(1);
  });

  it("upserts a game snapshot by id", () => {
    const harness = connected();
    harness.clock.advance(1_250);
    harness.deliver({ type: "game.snapshot", game: waitingGame() });
    harness.deliver({ type: "game.snapshot", game: waitingGame(OTHER_GAME_ID) });
    harness.deliver({ type: "game.snapshot", game: { ...waitingGame(), revision: 0 } });

    expect(harness.client.store.getState().games.map((game) => game.id)).toEqual([
      GAME_ID,
      OTHER_GAME_ID,
    ]);
    expect(harness.client.store.getState().gameReceivedAtMs[GAME_ID]).toBe(1_250);
  });

  it("reports a finished snapshot so the current user's history can be invalidated", () => {
    const onGameHistoryStale = vi.fn<(userId: string) => void>();
    const harness = connected({ onGameHistoryStale });

    harness.deliver({ type: "game.snapshot", game: finishedGame() });

    expect(onGameHistoryStale).toHaveBeenCalledTimes(1);
    expect(onGameHistoryStale).toHaveBeenCalledWith(USER_ONE.id);
  });

  it("drops a game the server closed", () => {
    const harness = connected();
    harness.deliver({ type: "game.snapshot", game: waitingGame() });
    harness.deliver({ type: "game.closed", gameId: GAME_ID });

    expect(harness.client.store.getState().games).toEqual([]);
    expect(harness.client.store.getState().gameReceivedAtMs[GAME_ID]).toBeUndefined();
  });

  it("replaces everything the previous socket held once a reconnect is confirmed", () => {
    const harness = connected();
    harness.deliver({ type: "game.snapshot", game: waitingGame() });
    harness.deliver({
      type: "players.status",
      players: [{ id: USER_ONE.id, online: true, activity: "open_room" }],
    });

    harness.close(ABNORMAL_CLOSURE);
    harness.fireTimers();
    harness.deliver(sessionReady());

    expect(harness.client.store.getState().games).toEqual([]);
    expect(harness.client.store.getState().playerStatuses).toEqual([]);
    expect(harness.client.store.getState().synced).toBe(false);
    expect(harness.client.store.getState().status).toBe("reconnecting");

    harness.deliver({ type: "session.synced" });

    expect(harness.client.store.getState().status).toBe("ready");
  });

  it("refreshes history after reconnect sync because finished games are not replayed", () => {
    const onGameHistoryStale = vi.fn<(userId: string) => void>();
    const harness = connected({ onGameHistoryStale });
    expect(onGameHistoryStale).not.toHaveBeenCalled();

    harness.close(ABNORMAL_CLOSURE);
    harness.fireTimers();
    harness.deliver(sessionReady());
    harness.deliver({ type: "session.synced" });

    expect(onGameHistoryStale).toHaveBeenCalledTimes(1);
    expect(onGameHistoryStale).toHaveBeenCalledWith(USER_ONE.id);
  });

  it.each([
    ["invalid JSON", "not json at all"],
    ["an unknown type", JSON.stringify({ type: "lobby.exploded" })],
    ["a snapshot that fails the schema", JSON.stringify({ type: "lobby.snapshot", lobbies: 7 })],
    ["a non-object body", JSON.stringify([1, 2, 3])],
  ])("fails closed on %s", (_label, payload) => {
    const harness = connected();
    harness.deliver({ type: "lobby.snapshot", lobbies: [lobbyEntry()] });

    harness.deliver(payload);

    expect(harness.client.store.getState()).toMatchObject({
      lobbies: [],
      status: "disconnected",
      synced: false,
    });
    expect(harness.socket().closed).toEqual({
      code: PROTOCOL_ERROR,
      reason: "server protocol did not match",
    });
    expect(harness.pendingTimers()).toEqual([]);
  });
});

describe("commands", () => {
  it("sends every supported command in the shared shape", () => {
    const harness = connected();

    void harness.client.createLobby(false);
    void harness.client.joinLobby(GAME_ID);
    void harness.client.cancelLobby(GAME_ID);
    void harness.client.playMove({
      gameId: GAME_ID,
      expectedRevision: 4,
      square: { row: 3, col: 3 },
    });
    void harness.client.resignGame({ gameId: GAME_ID, expectedRevision: 5 });

    expect(harness.sent()).toEqual([
      {
        type: "lobby.create",
        requestId: requestId(0),
        rated: false,
        timeControl: { kind: "untimed", initialMs: null, incrementMs: null },
        creatorSeat: PLAYER_ONE,
      },
      { type: "lobby.join", requestId: requestId(1), gameId: GAME_ID },
      { type: "lobby.cancel", requestId: requestId(2), gameId: GAME_ID },
      {
        type: "game.move",
        requestId: requestId(3),
        gameId: GAME_ID,
        expectedRevision: 4,
        square: { row: 3, col: 3 },
      },
      { type: "game.resign", requestId: requestId(4), gameId: GAME_ID, expectedRevision: 5 },
    ]);
  });

  it("carries the chosen stakes, clock and seat on a created lobby", () => {
    const harness = connected();

    void harness.client.createLobby(
      true,
      { kind: "timed", initialMs: 300_000, incrementMs: 3_000 },
      PLAYER_TWO,
    );

    expect(harness.sent()).toEqual([
      {
        type: "lobby.create",
        requestId: requestId(0),
        rated: true,
        timeControl: { kind: "timed", initialMs: 300_000, incrementMs: 3_000 },
        creatorSeat: PLAYER_TWO,
      },
    ]);
  });

  it("settles a command with the acceptance that echoes its request ID", async () => {
    const harness = connected();
    const result = harness.client.createLobby(false);

    harness.deliver({ type: "command.accepted", requestId: requestId(0) });

    await expect(result).resolves.toEqual({ ok: true, requestId: requestId(0) });
  });

  it("settles the right command when several are outstanding", async () => {
    const harness = connected();
    const first = harness.client.createLobby(false);
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

  it("refuses a command while the opening state is not synced", async () => {
    const harness = createHarness();
    harness.client.start(USER_ONE.id);
    harness.deliver(sessionReady());

    await expect(harness.client.createLobby(false)).resolves.toMatchObject({
      ok: false,
      failure: "not_connected",
    });
    expect(harness.socket().sent).toEqual([]);
  });

  it("settles every outstanding command when the connection drops", async () => {
    const harness = connected();
    const pending = harness.client.createLobby(false);

    harness.close(ABNORMAL_CLOSURE);

    await expect(pending).resolves.toMatchObject({
      ok: false,
      requestId: requestId(0),
      failure: "connection_lost",
    });
  });

  it("settles a command the server never answers", async () => {
    const harness = connected();
    const pending = harness.client.createLobby(false);

    harness.fireTimers();

    await expect(pending).resolves.toMatchObject({ ok: false, failure: "timed_out" });
  });

  it("settles outstanding commands when the user signs out", async () => {
    const harness = connected();
    const pending = harness.client.createLobby(false);

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

  it("keeps increasing backoff until opening synchronization succeeds", () => {
    const harness = connected();

    harness.close(ABNORMAL_CLOSURE);
    expect(harness.pendingTimers()[0]?.delayMs).toBe(375);
    harness.fireTimers();
    harness.deliver(sessionReady());

    expect(harness.client.store.getState()).toMatchObject({
      status: "reconnecting",
      reconnectAttempts: 1,
    });

    harness.close(ABNORMAL_CLOSURE);
    expect(harness.pendingTimers()[0]?.delayMs).toBe(750);
    harness.fireTimers();
    harness.deliver(sessionReady());

    expect(harness.client.store.getState().reconnectAttempts).toBe(2);

    harness.deliver({ type: "session.synced" });

    expect(harness.client.store.getState()).toMatchObject({
      status: "ready",
      reconnectAttempts: 0,
    });

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
    const harness = createHarness();
    harness.client.start(USER_ONE.id);
    harness.deliver(sessionReady());

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

  it.each([
    "",
    "{",
    // A version this client was not built against is rejected rather than guessed at.
    JSON.stringify({
      type: "session.ready",
      protocolVersion: WS_PROTOCOL_VERSION + 1,
      user: USER_ONE,
    }),
  ])("returns null for %s", (payload) => {
    expect(parseServerMessage(payload)).toBeNull();
  });
});
