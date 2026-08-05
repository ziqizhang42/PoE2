/**
 * The browser WebSocket adapter.
 *
 * It owns framing, authentication, and fan-out. Every rule
 * about who may do what to a game lives in the game service, which this module
 * calls exactly the way any other adapter would.
 *
 * See [docs/protocol.md](../../../docs/protocol.md) for the wire contract.
 */

import { Buffer } from "node:buffer";
import { clearTimeout, setTimeout } from "node:timers";

import { fastifyCookie } from "@fastify/cookie";
import websocket from "@fastify/websocket";
import {
  WS_PROTOCOL_VERSION,
  WsClientMessageSchema,
  type AuthUser,
  type GameSnapshot,
  type WsClientMessage,
  type WsErrorCode,
  type WsServerMessage,
} from "@poe2/protocol";
import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
} from "fastify";
import { z } from "zod";
import type { RawData, WebSocket } from "ws";

import type { AuthService } from "../auth/service.js";
import type { AuthConfig } from "../config/auth.js";
import { isAllowedOrigin, type WebSocketConfig } from "../config/websocket.js";
import type { GameErrorCode, GameService } from "../game/service.js";
import { sendMessage, type ConnectionHub } from "./ws-hub.js";

export const WS_ROUTE = "/api/ws";

/**
 * Commands are a few hundred bytes at most. The cap is what stops an
 * authenticated socket from buffering megabytes of frame before anything looks
 * at it; `ws` closes the connection itself once a frame exceeds it.
 */
export const WS_MAX_PAYLOAD_BYTES = 16 * 1024;

/** RFC 6455 "policy violation": used when a socket's session stops being valid. */
const POLICY_VIOLATION = 1008;

/** RFC 6455 "internal error": used when the server cannot serve the socket. */
const INTERNAL_ERROR = 1011;

/** How long a peer gets to answer a close frame before the socket is dropped. */
const CLOSE_GRACE_MS = 1_000;

export interface WebSocketHttpOptions extends AuthConfig, WebSocketConfig {
  readonly authService: AuthService;
  readonly gameService: GameService;
  readonly hub: ConnectionHub;
}

/** What the upgrade established, carried from the auth hook to the handler. */
interface SocketSession {
  readonly user: AuthUser;
  readonly token: string;
}

const requestIdSchema = z.uuid();

const REJECTION_MESSAGES: Readonly<Record<WsErrorCode, string>> = {
  invalid_message: "Message did not match the protocol",
  game_not_found: "That game does not exist",
  game_not_waiting: "That game is no longer waiting for an opponent",
  cannot_join_own_game: "You cannot join your own lobby",
  not_lobby_owner: "Only the player who opened a lobby can cancel it",
  not_a_player: "You are not a player in that game",
  not_your_turn: "It is not your turn",
  stale_game: "The game has moved on since that revision",
  occupied: "That square is already taken",
  game_over: "That game has already finished",
  internal_error: "The command could not be processed",
};

/**
 * The service reports domain decisions in its own vocabulary; only this table
 * turns them into wire codes. `invalid_square` cannot reach a browser, because
 * the schema bounds coordinates before the service is called.
 */
const WS_ERROR_BY_GAME_ERROR: Readonly<Record<GameErrorCode, WsErrorCode>> = {
  game_not_found: "game_not_found",
  game_not_waiting: "game_not_waiting",
  cannot_join_own_game: "cannot_join_own_game",
  not_lobby_owner: "not_lobby_owner",
  not_a_player: "not_a_player",
  not_your_turn: "not_your_turn",
  stale_game: "stale_game",
  occupied: "occupied",
  game_over: "game_over",
  invalid_square: "invalid_message",
};

const webSocketRoutes: FastifyPluginAsync<WebSocketHttpOptions> = async (app, options) => {
  // Keyed by the request object, which is the same instance in the hook and in
  // the handler. Nothing outside one upgrade can reach the session.
  const sessions = new WeakMap<FastifyRequest, SocketSession>();

  app.get(
    WS_ROUTE,
    {
      websocket: true,
      /**
       * Runs before the upgrade completes, so an unauthenticated or
       * cross-origin caller gets an HTTP status and never a socket. The user is
       * taken from the session cookie; the client cannot name one.
       */
      onRequest: async (request, reply) => {
        // The auth plugin's error handler is encapsulated in its own scope, so
        // an unexpected failure here would otherwise reach Fastify's default
        // handler and put the internal message on the wire.
        try {
          if (!isAllowedOrigin(options, request.headers.origin)) {
            return reply.code(403).send({ code: "forbidden_origin" });
          }

          const token = readSessionCookie(request, options.sessionCookieName);
          if (token === null) {
            return reply.code(401).send({ code: "unauthenticated" });
          }

          const user = await options.authService.authenticateSession(token);
          if (user === null) {
            return reply.code(401).send({ code: "unauthenticated" });
          }

          sessions.set(request, { user, token });
          return undefined;
        } catch (error) {
          request.log.error({ err: error }, "websocket upgrade failed unexpectedly");
          return reply.code(500).send({ code: "internal_error" });
        }
      },
    },
    (socket, request) => {
      const session = sessions.get(request);

      if (session === undefined) {
        // Unreachable while the hook above runs, and a closed socket is the
        // only safe response if it ever became reachable.
        closeSocket(socket, POLICY_VIOLATION, "unauthenticated");
        return;
      }

      handleConnection(socket, session, request.log, options);
    },
  );
};

/**
 * Registers the WebSocket transport on `app`.
 *
 * `@fastify/websocket` must be registered before any route it serves, and it is
 * registered directly on `app` rather than inside the route plugin so that the
 * `injectWS` test helper it decorates lands on the instance callers hold.
 */
export async function registerWebSocket(
  app: FastifyInstance,
  options: WebSocketHttpOptions,
): Promise<void> {
  await app.register(websocket, {
    options: { maxPayload: WS_MAX_PAYLOAD_BYTES, perMessageDeflate: false },
  });

  await app.register(webSocketRoutes, options);
}

function handleConnection(
  socket: WebSocket,
  session: SocketSession,
  log: FastifyBaseLogger,
  options: WebSocketHttpOptions,
): void {
  const { hub, gameService } = options;

  // Pending until the opening sequence has been sent: hub traffic from other
  // users buffers behind it rather than arriving before `session.ready`.
  hub.add(session.user.id, socket);

  /** Set when the connection is given up on, so queued frames stop early. */
  let abandoned = false;

  /**
   * One command at a time, in arrival order. Handlers await the database, so
   * without this a second frame could overtake the first and, for example, be
   * validated against a revision its predecessor has not yet consumed.
   */
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (work: () => Promise<void>): void => {
    queue = queue.then(work).catch((error: unknown) => {
      log.error({ err: error }, "websocket work failed outside command handling");
    });
  };

  // Attached synchronously: a frame that arrives before the initial state has
  // been sent must still be queued behind it rather than dropped.
  socket.on("message", (data: RawData, isBinary: boolean) => {
    enqueue(async () => {
      if (abandoned) {
        return;
      }
      await handleFrame(socket, session, log, options, data, isBinary);
    });
  });

  socket.on("error", (error: Error) => {
    log.warn({ err: error }, "websocket connection error");
  });

  socket.on("close", () => {
    hub.remove(session.user.id, socket);
  });

  enqueue(async () => {
    try {
      sendMessage(socket, {
        type: "session.ready",
        protocolVersion: WS_PROTOCOL_VERSION,
        user: session.user,
      });

      sendMessage(socket, {
        type: "lobby.snapshot",
        lobbies: await gameService.listWaitingLobbies(),
      });

      for (const game of await gameService.listOpenGames(session.user.id)) {
        sendMessage(socket, { type: "game.snapshot", game });
      }
    } catch (error) {
      // A client that never learned its own state must not go on issuing
      // commands against it, so the connection is given up rather than left
      // half-initialized.
      log.error({ err: error }, "websocket opening sequence failed");
      abandoned = true;
      hub.remove(session.user.id, socket);
      closeSocket(socket, INTERNAL_ERROR, "could not establish session state");
      return;
    }

    hub.activate(session.user.id, socket);
  });
}

async function handleFrame(
  socket: WebSocket,
  session: SocketSession,
  log: FastifyBaseLogger,
  options: WebSocketHttpOptions,
  data: RawData,
  isBinary: boolean,
): Promise<void> {
  const reject = (requestId: string | null, code: WsErrorCode): void => {
    sendMessage(socket, {
      type: "command.rejected",
      requestId,
      code,
      message: REJECTION_MESSAGES[code],
    });
  };

  // The identity is re-derived per command rather than trusted for the life of
  // the socket, so logging out or letting a session expire ends the connection
  // instead of leaving a long-lived authenticated channel behind.
  const actor = await options.authService.authenticateSession(session.token);
  if (actor === null) {
    closeSocket(socket, POLICY_VIOLATION, "session is no longer valid");
    return;
  }

  if (isBinary) {
    reject(null, "invalid_message");
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(frameText(data));
  } catch {
    reject(null, "invalid_message");
    return;
  }

  const parsed = WsClientMessageSchema.safeParse(payload);
  if (!parsed.success) {
    reject(recoverRequestId(payload), "invalid_message");
    return;
  }

  const message = parsed.data;

  let outcome: CommandOutcome;
  try {
    outcome = await runCommand(actor, options, message);
  } catch (error) {
    log.error({ err: error, command: message.type }, "websocket command failed unexpectedly");
    reject(message.requestId, "internal_error");
    return;
  }

  if (!outcome.ok) {
    reject(message.requestId, WS_ERROR_BY_GAME_ERROR[outcome.code]);
    return;
  }

  sendMessage(socket, { type: "command.accepted", requestId: message.requestId });

  // The change is committed and the command has been acknowledged. A failure
  // publishing it must never be turned into a rejection of a command that
  // actually succeeded; the next snapshot any client receives corrects them.
  try {
    await outcome.publish();
  } catch (error) {
    log.error({ err: error, command: message.type }, "websocket fan-out failed after a commit");
  }
}

/**
 * A command's outcome, with the fan-out held back as `publish`.
 *
 * Splitting them is what keeps acknowledgement honest: everything that can
 * still refuse the command happens before it is acknowledged, and everything
 * after acknowledgement is notification that may only be logged.
 */
type CommandOutcome =
  | { readonly ok: false; readonly code: GameErrorCode }
  | { readonly ok: true; readonly publish: () => Promise<void> };

async function runCommand(
  actor: AuthUser,
  options: WebSocketHttpOptions,
  message: WsClientMessage,
): Promise<CommandOutcome> {
  const { hub, gameService } = options;

  const broadcastLobbies = async (): Promise<void> => {
    hub.broadcast({ type: "lobby.snapshot", lobbies: await gameService.listWaitingLobbies() });
  };

  const sendGameToPlayers = (game: GameSnapshot): void => {
    const snapshot: WsServerMessage = { type: "game.snapshot", game };
    for (const userId of participantIds(game)) {
      hub.send(userId, snapshot);
    }
  };

  switch (message.type) {
    case "lobby.create": {
      const result = await gameService.createGame(actor.id);
      if (!result.ok) {
        return { ok: false, code: result.code };
      }

      return {
        ok: true,
        publish: async () => {
          sendGameToPlayers(result.value);
          await broadcastLobbies();
        },
      };
    }

    case "lobby.join": {
      const result = await gameService.joinGame({ actorId: actor.id, gameId: message.gameId });
      if (!result.ok) {
        return { ok: false, code: result.code };
      }

      return {
        ok: true,
        publish: async () => {
          sendGameToPlayers(result.value);
          await broadcastLobbies();
        },
      };
    }

    case "lobby.cancel": {
      const result = await gameService.cancelGame({ actorId: actor.id, gameId: message.gameId });
      if (!result.ok) {
        return { ok: false, code: result.code };
      }

      return {
        ok: true,
        publish: async () => {
          hub.send(actor.id, { type: "game.closed", gameId: result.value.gameId });
          await broadcastLobbies();
        },
      };
    }

    case "game.move": {
      const result = await gameService.playMove({
        actorId: actor.id,
        gameId: message.gameId,
        expectedRevision: message.expectedRevision,
        square: message.square,
      });

      if (!result.ok) {
        return { ok: false, code: result.code };
      }

      return {
        ok: true,
        publish: () => {
          sendGameToPlayers(result.value);
          return Promise.resolve();
        },
      };
    }
  }
}

/**
 * Ends a connection the server has decided it may no longer serve.
 *
 * The close frame is sent first so the peer learns why, but a peer that never
 * answers it would otherwise hold the socket - and its hub entry - open for
 * good, so the transport is dropped once the grace period lapses.
 */
function closeSocket(socket: WebSocket, code: number, reason: string): void {
  socket.close(code, reason);

  const grace = setTimeout(() => socket.terminate(), CLOSE_GRACE_MS);
  grace.unref();
  socket.once("close", () => clearTimeout(grace));
}

function participantIds(game: GameSnapshot): readonly string[] {
  return game.players.playerTwo === null
    ? [game.players.playerOne.id]
    : [game.players.playerOne.id, game.players.playerTwo.id];
}

function frameText(data: RawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }

  return Buffer.from(data).toString("utf8");
}

/**
 * Correlates a rejection with the frame that caused it when the frame is
 * malformed but still names a plausible request. Anything else is answered with
 * a null request ID rather than an echo of untrusted input.
 */
function recoverRequestId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }

  const candidate = (payload as { readonly requestId?: unknown }).requestId;
  const parsed = requestIdSchema.safeParse(candidate);

  return parsed.success ? parsed.data : null;
}

function readSessionCookie(request: FastifyRequest, cookieName: string): string | null {
  const header = request.headers.cookie;
  if (header === undefined) {
    return null;
  }

  // Parsed straight from the header: `@fastify/cookie` is registered inside the
  // auth plugin's scope, so `request.cookies` does not exist here.
  const token = fastifyCookie.parse(header)[cookieName];

  return token === undefined || token.length === 0 ? null : token;
}
