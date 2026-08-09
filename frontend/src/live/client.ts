/**
 * Owns one cookie-authenticated WebSocket, correlates command replies, and
 * copies authoritative snapshots into the live store.
 */

import {
  UNTIMED,
  WsServerMessageSchema,
  type TimeControl,
  type WsClientMessage,
  type WsErrorCode,
  type WsGameMoveMessage,
  type WsServerMessage,
} from "@poe2/protocol";
import { PLAYER_ONE, type Player } from "@poe2/rules";

import { browserClock, type CancelTimer, type Clock } from "../runtime/clock.ts";
import {
  createBrowserSocket,
  liveSocketUrl,
  type LiveSocket,
  type LiveSocketFactory,
} from "./socket.ts";
import {
  createLiveStore,
  INITIAL_LIVE_STATE,
  removeGame,
  removeGameReceiptTime,
  upsertGame,
  type LiveStore,
} from "./store.ts";

/** RFC 6455 normal closure, used whenever this end ends the connection. */
const NORMAL_CLOSURE = 1000;

/** RFC 6455 protocol error: the peer sent a frame this build cannot understand. */
const PROTOCOL_ERROR = 1002;

/**
 * RFC 6455 policy violation. The server sends it when the session behind an
 * open socket stops being valid, which is the one authentication failure the
 * browser can actually observe.
 */
const POLICY_VIOLATION = 1008;

const CLIENT_CLOSE_REASON = "client shutdown";
const PROTOCOL_ERROR_REASON = "server protocol did not match";

const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 30_000;

/** A command the server never answers still has to settle, so callers never hang. */
const COMMAND_TIMEOUT_MS = 15_000;

export type LiveCommandFailure = "not_connected" | "connection_lost" | "timed_out" | "rejected";

export type LiveCommandResult =
  | { readonly ok: true; readonly requestId: string }
  | {
      readonly ok: false;
      readonly requestId: string;
      readonly failure: LiveCommandFailure;
      /** Set only when the server itself rejected the command. */
      readonly code: WsErrorCode | null;
      readonly message: string | null;
    };

export interface PlayMoveInput {
  readonly gameId: string;
  readonly expectedRevision: number;
  readonly square: WsGameMoveMessage["square"];
}

export interface ResignGameInput {
  readonly gameId: string;
  /** Prevents conceding a position that changed during confirmation. */
  readonly expectedRevision: number;
}

export interface ReadyCheckCommandInput {
  readonly gameId: string;
  /** Binds the decision to the ready-check snapshot that prompted it. */
  readonly readyCheckGeneration: number;
}

export interface LiveCommands {
  createLobby(
    rated: boolean,
    timeControl?: TimeControl,
    creatorSeat?: Player,
  ): Promise<LiveCommandResult>;
  joinLobby(gameId: string): Promise<LiveCommandResult>;
  cancelLobby(gameId: string): Promise<LiveCommandResult>;
  /** Idempotent within the ready-check generation. */
  readyGame(input: ReadyCheckCommandInput): Promise<LiveCommandResult>;
  declineGame(input: ReadyCheckCommandInput): Promise<LiveCommandResult>;
  playMove(input: PlayMoveInput): Promise<LiveCommandResult>;
  resignGame(input: ResignGameInput): Promise<LiveCommandResult>;
}

export interface LiveClient extends LiveCommands {
  readonly store: LiveStore;
  /** Idempotent for one user; a different user discards the previous state. */
  start(userId: string): void;
  /** Deliberate shutdown: no reconnect, snapshots kept for the signed-in user. */
  disconnect(): void;
  /** Signed out: closes the socket and clears everything user-specific. */
  stop(): void;
}

export interface LiveClientOptions {
  readonly createSocket?: LiveSocketFactory;
  readonly clock?: Clock;
  readonly resolveUrl?: () => string;
  readonly createRequestId?: () => string;
  readonly random?: () => number;
  /**
   * Called when the session behind the socket looks invalid. A refused upgrade
   * reaches the browser as an ordinary connection failure - the `401` is not
   * observable - so this asks the authentication state to re-check rather than
   * deciding anything about the session here.
   */
  readonly onSessionSuspect?: () => void;
  /** Invalidates archives after a finish or a reconnect that may have missed one. */
  readonly onGameHistoryStale?: (userId: string) => void;
}

export type LiveClientFactory = (options: LiveClientOptions) => LiveClient;

/** Bounded exponential backoff with equal jitter, so reconnects do not synchronize. */
export function reconnectDelayMs(attempt: number, random: () => number): number {
  const ceiling = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** attempt);
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

export function parseServerMessage(payload: string): WsServerMessage | null {
  let json: unknown;

  try {
    json = JSON.parse(payload);
  } catch {
    return null;
  }

  const parsed = WsServerMessageSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

interface PendingCommand {
  readonly requestId: string;
  readonly settle: (result: LiveCommandResult) => void;
  readonly cancelTimeout: CancelTimer;
}

export function createLiveClient(options: LiveClientOptions = {}): LiveClient {
  const createSocket = options.createSocket ?? createBrowserSocket;
  const clock = options.clock ?? browserClock;
  const resolveUrl = options.resolveUrl ?? (() => liveSocketUrl(window.location));
  const createRequestId = options.createRequestId ?? (() => crypto.randomUUID());
  const random = options.random ?? Math.random;
  const onSessionSuspect = options.onSessionSuspect ?? (() => {});
  const onGameHistoryStale = options.onGameHistoryStale ?? (() => {});

  const store = createLiveStore();
  const pending = new Map<string, PendingCommand>();

  /**
   * Bumped by every teardown. Socket callbacks and reconnect timers capture the
   * value they were created under, so anything belonging to an abandoned
   * attempt is ignored instead of writing into the state of a newer one.
   */
  let generation = 0;
  let running = false;
  let desiredUserId: string | null = null;
  let socket: LiveSocket | null = null;
  let cancelRetry: CancelTimer | null = null;
  let attempt = 0;
  let sessionEstablished = false;

  const settleAll = (failure: LiveCommandFailure): void => {
    const outstanding = [...pending.values()];
    pending.clear();

    for (const command of outstanding) {
      command.cancelTimeout();
      command.settle({
        ok: false,
        requestId: command.requestId,
        failure,
        code: null,
        message: null,
      });
    }
  };

  const settleCommand = (requestId: string, result: LiveCommandResult): boolean => {
    const command = pending.get(requestId);

    if (command === undefined) {
      return false;
    }

    pending.delete(requestId);
    command.cancelTimeout();
    command.settle(result);
    return true;
  };

  const teardown = (closeCode = NORMAL_CLOSURE, closeReason = CLIENT_CLOSE_REASON): void => {
    generation += 1;
    sessionEstablished = false;
    cancelRetry?.();
    cancelRetry = null;

    const current = socket;
    socket = null;
    settleAll("connection_lost");
    current?.close(closeCode, closeReason);
  };

  const abandonAsUnauthenticated = (): void => {
    teardown();
    running = false;
    desiredUserId = null;
    attempt = 0;
    store.setState({ ...INITIAL_LIVE_STATE, status: "unauthenticated" });
    onSessionSuspect();
  };

  const abandonAsProtocolError = (): void => {
    const userId = desiredUserId;
    teardown(PROTOCOL_ERROR, PROTOCOL_ERROR_REASON);
    running = false;
    attempt = 0;
    // A malformed opening may have left a partial replay, so retain no snapshots.
    store.setState({ ...INITIAL_LIVE_STATE, status: "disconnected", userId });
  };

  const applyServerMessage = (message: WsServerMessage): void => {
    switch (message.type) {
      case "session.ready": {
        if (message.user.id !== desiredUserId) {
          // The server derives identity from the session cookie, so a different
          // user means this browser is no longer who the client was started
          // for. None of their state may be shown.
          abandonAsUnauthenticated();
          return;
        }

        sessionEstablished = true;
        // Replace prior socket state and remain unavailable until replay completion.
        const reconnectAttempts = store.getState().reconnectAttempts;
        store.setState({
          ...INITIAL_LIVE_STATE,
          status: attempt === 0 ? "connecting" : "reconnecting",
          userId: message.user.id,
          reconnectAttempts,
        });
        return;
      }

      case "session.synced": {
        // Never bypass the exact-version `session.ready` handshake.
        if (!sessionEstablished) {
          return;
        }

        const reconnected = attempt > 0;
        attempt = 0;
        store.setState({ status: "ready", synced: true, reconnectAttempts: 0 });
        if (reconnected && desiredUserId !== null) {
          onGameHistoryStale(desiredUserId);
        }
        return;
      }

      case "lobby.snapshot":
        store.setState({ lobbies: message.lobbies });
        return;

      case "game.snapshot": {
        const receivedAtMs = clock.now();
        store.setState((state) => ({
          games: upsertGame(state.games, message.game),
          gameReceivedAtMs: { ...state.gameReceivedAtMs, [message.game.id]: receivedAtMs },
        }));
        if (message.game.status === "finished" && desiredUserId !== null) {
          onGameHistoryStale(desiredUserId);
        }
        return;
      }

      case "game.closed":
        store.setState((state) => ({
          games: removeGame(state.games, message.gameId),
          gameReceivedAtMs: removeGameReceiptTime(state.gameReceivedAtMs, message.gameId),
        }));
        return;

      case "command.accepted":
        settleCommand(message.requestId, { ok: true, requestId: message.requestId });
        return;

      case "command.rejected": {
        const requestId = message.requestId;
        const handled =
          requestId !== null &&
          settleCommand(requestId, {
            ok: false,
            requestId,
            failure: "rejected",
            code: message.code,
            message: message.message,
          });

        if (!handled) {
          store.setState({
            lastRejection: { requestId, code: message.code, message: message.message },
          });
        }
        return;
      }
    }
  };

  const handleClose = (code: number): void => {
    const wasEstablished = sessionEstablished;

    socket = null;
    teardown();

    if (code === POLICY_VIOLATION) {
      abandonAsUnauthenticated();
      return;
    }

    if (!wasEstablished) {
      onSessionSuspect();
    }

    scheduleReconnect();
  };

  const scheduleReconnect = (): void => {
    const delay = reconnectDelayMs(attempt, random);
    const token = generation;
    attempt += 1;

    store.setState({ status: "reconnecting", reconnectAttempts: attempt });

    cancelRetry = clock.schedule(() => {
      cancelRetry = null;
      if (token !== generation || !running) {
        return;
      }
      openSocket();
    }, delay);
  };

  const openSocket = (): void => {
    generation += 1;
    const token = generation;
    sessionEstablished = false;

    store.setState({ status: attempt === 0 ? "connecting" : "reconnecting" });

    socket = createSocket(resolveUrl(), {
      onMessage: (payload) => {
        if (token !== generation) {
          return;
        }

        const message = parseServerMessage(payload);
        if (message === null) {
          // Retrying the same incompatible server cannot heal a protocol mismatch.
          // Fail closed and let the UI ask for a reload/new client build.
          abandonAsProtocolError();
          return;
        }
        applyServerMessage(message);
      },
      onClose: (code) => {
        if (token !== generation) {
          return;
        }
        handleClose(code);
      },
    });
  };

  const send = (message: WsClientMessage): Promise<LiveCommandResult> => {
    const requestId = message.requestId;
    const active = socket;

    if (active === null || store.getState().status !== "ready") {
      return Promise.resolve({
        ok: false,
        requestId,
        failure: "not_connected",
        code: null,
        message: null,
      });
    }

    return new Promise<LiveCommandResult>((resolve) => {
      const cancelTimeout = clock.schedule(() => {
        pending.delete(requestId);
        resolve({ ok: false, requestId, failure: "timed_out", code: null, message: null });
      }, COMMAND_TIMEOUT_MS);

      pending.set(requestId, { requestId, settle: resolve, cancelTimeout });

      try {
        active.send(JSON.stringify(message));
      } catch {
        pending.delete(requestId);
        cancelTimeout();
        resolve({
          ok: false,
          requestId,
          failure: "not_connected",
          code: null,
          message: null,
        });
      }
    });
  };

  return {
    store,

    start(userId) {
      if (running && desiredUserId === userId) {
        return;
      }

      teardown();
      desiredUserId = userId;
      running = true;
      attempt = 0;
      store.setState({ ...INITIAL_LIVE_STATE, userId });
      openSocket();
    },

    disconnect() {
      teardown();
      running = false;
      attempt = 0;
      store.setState({ status: "disconnected", reconnectAttempts: 0 });
    },

    stop() {
      teardown();
      running = false;
      desiredUserId = null;
      attempt = 0;
      store.setState({ ...INITIAL_LIVE_STATE });
    },

    createLobby: (rated, timeControl = UNTIMED, creatorSeat = PLAYER_ONE) =>
      send({ type: "lobby.create", requestId: createRequestId(), rated, timeControl, creatorSeat }),

    joinLobby: (gameId) => send({ type: "lobby.join", requestId: createRequestId(), gameId }),

    cancelLobby: (gameId) => send({ type: "lobby.cancel", requestId: createRequestId(), gameId }),

    readyGame: ({ gameId, readyCheckGeneration }) =>
      send({
        type: "game.ready",
        requestId: createRequestId(),
        gameId,
        readyCheckGeneration,
      }),

    declineGame: ({ gameId, readyCheckGeneration }) =>
      send({
        type: "game.decline",
        requestId: createRequestId(),
        gameId,
        readyCheckGeneration,
      }),

    playMove: (input) =>
      send({
        type: "game.move",
        requestId: createRequestId(),
        gameId: input.gameId,
        expectedRevision: input.expectedRevision,
        square: input.square,
      }),

    resignGame: (input) =>
      send({
        type: "game.resign",
        requestId: createRequestId(),
        gameId: input.gameId,
        expectedRevision: input.expectedRevision,
      }),
  };
}
