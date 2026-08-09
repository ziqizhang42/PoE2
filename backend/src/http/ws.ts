import { Buffer } from "node:buffer";
import { clearTimeout, setTimeout } from "node:timers";

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
import { createCommandQueue } from "../limits/command-queue.js";
import type { ConnectionAdmission } from "../limits/connection-registry.js";
import type { WebSocketLimits } from "../limits/websocket-limits.js";
import { clientAddressKey } from "./client-address.js";
import { readSessionCookie } from "./session.js";
import { sendMessage, type ConnectionHub } from "./ws-hub.js";

export const WS_ROUTE = "/api/ws";

/** Bounds memory consumed before a frame is parsed. */
export const WS_MAX_PAYLOAD_BYTES = 16 * 1024;

/** RFC 6455 "policy violation": used when a socket's session stops being valid. */
const POLICY_VIOLATION = 1008;

/** RFC 6455 "internal error": used when the server cannot serve the socket. */
const INTERNAL_ERROR = 1011;

/** RFC 6455 "try again later": used when a peer outruns its bounded queue. */
const TRY_AGAIN_LATER = 1013;

/** How long a peer gets to answer a close frame before the socket is dropped. */
const CLOSE_GRACE_MS = 1_000;

export interface WebSocketHttpOptions extends AuthConfig, WebSocketConfig {
  readonly authService: AuthService;
  readonly gameService: GameService;
  readonly hub: ConnectionHub;
  readonly limits: WebSocketLimits;
}

interface SocketSession {
  readonly user: AuthUser;
  readonly token: string;
  readonly address: string;
  readonly admission: ConnectionAdmission;
}

const requestIdSchema = z.uuid();

/** Exhaustive so the adapter cannot omit a shared wire error code. */
export const REJECTION_MESSAGES: Readonly<Record<WsErrorCode, string>> = {
  invalid_message: "Message did not match the protocol",
  game_not_found: "That game does not exist",
  game_not_waiting: "That game is no longer waiting for an opponent",
  cannot_join_own_game: "You cannot join your own lobby",
  not_lobby_owner: "Only the player who opened a lobby can cancel it",
  not_a_player: "You are not a player in that game",
  game_not_ready_check: "That game is not waiting for both players to confirm",
  not_your_turn: "It is not your turn",
  stale_game: "The game has moved on since that revision",
  occupied: "That square is already taken",
  game_over: "That game has already finished",
  lobby_already_open: "You already have a lobby waiting for an opponent",
  rated_requires_clock: "A rated game needs a clock; choose a time control or open a casual game",
  rate_limited: "Too many commands; slow down and try again",
  internal_error: "The command could not be processed",
};

const WS_ERROR_BY_GAME_ERROR: Readonly<Record<GameErrorCode, WsErrorCode>> = {
  game_not_found: "game_not_found",
  game_not_waiting: "game_not_waiting",
  cannot_join_own_game: "cannot_join_own_game",
  not_lobby_owner: "not_lobby_owner",
  not_a_player: "not_a_player",
  game_not_ready_check: "game_not_ready_check",
  not_your_turn: "not_your_turn",
  stale_game: "stale_game",
  occupied: "occupied",
  game_over: "game_over",
  lobby_already_open: "lobby_already_open",
  rated_requires_clock: "rated_requires_clock",
  deadline_capacity: "rate_limited",
  invalid_square: "invalid_message",
};

const webSocketRoutes: FastifyPluginAsync<WebSocketHttpOptions> = async (app, options) => {
  const sessions = new WeakMap<FastifyRequest, SocketSession>();

  app.get(
    WS_ROUTE,
    {
      websocket: true,
      /** Rejects unauthenticated and cross-origin callers before the upgrade. */
      onRequest: async (request, reply) => {
        // Keep unexpected authentication details out of Fastify's default response.
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

          // Reserve synchronously so concurrent upgrades cannot pass the same count.
          // Unclaimed reservations expire if the upgrade never reaches its handler.
          const address = clientAddressKey(request);
          const admission = await options.limits.connections.admit({
            userId: user.id,
            address,
          });

          if (admission === null) {
            return reply.code(429).send({ code: "too_many_connections" });
          }

          sessions.set(request, { user, token, address, admission });
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
        closeSocket(socket, POLICY_VIOLATION, "unauthenticated");
        return;
      }

      if (!session.admission.claim()) {
        closeSocket(socket, TRY_AGAIN_LATER, "connection admission expired");
        return;
      }

      handleConnection(socket, session, request.log, options);
    },
  );
};

/** Registers the websocket plugin before its route, preserving `injectWS` on `app`. */
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

  // Buffer hub traffic until the opening sequence has been sent.
  hub.add(session.user.id, socket);

  let abandoned = false;

  const queue = createCommandQueue({
    maxDepth: options.limits.maxPendingCommands,
    onError: (error: unknown) => {
      log.error({ err: error }, "websocket work failed outside command handling");
    },
  });

  // Attach before asynchronous opening reads so early frames queue behind them.
  socket.on("message", (data: RawData, isBinary: boolean) => {
    const accepted = queue.enqueue(async () => {
      if (abandoned) {
        return;
      }
      await handleFrame(socket, session, log, options, data, isBinary);
    });

    if (!accepted && !abandoned) {
      // Queue-overflow replies would bypass command budgets, so shed the connection.
      abandoned = true;
      hub.remove(session.user.id, socket);
      closeSocket(socket, TRY_AGAIN_LATER, "command backlog exceeded");
    }
  });

  socket.on("error", (error: Error) => {
    log.warn({ err: error }, "websocket connection error");
  });

  socket.on("close", () => {
    hub.remove(session.user.id, socket);
    session.admission.release();
  });

  queue.enqueue(async () => {
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

      // Only this marker means the opening state is complete.
      sendMessage(socket, { type: "session.synced" });
    } catch (error) {
      // Do not leave a half-initialized client able to issue commands.
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
  // Parse first so even throttled requests can be correlated.
  const frame = readFrame(data, isBinary);
  const requestId = frame.ok ? recoverRequestId(frame.payload) : null;

  // Charge before session I/O, including malformed frames, to bound database work.
  const budget = await spendCommandBudget(session, options.limits);
  if (!budget.allowed) {
    reject(socket, requestId, "rate_limited");
    return;
  }

  if (!frame.ok) {
    reject(socket, requestId, "invalid_message");
    return;
  }

  // Revalidate per command so logout and expiry end the authenticated channel.
  const actor = await options.authService.authenticateSession(session.token);
  if (actor === null) {
    closeSocket(socket, POLICY_VIOLATION, "session is no longer valid");
    return;
  }

  const parsed = WsClientMessageSchema.safeParse(frame.payload);
  if (!parsed.success) {
    reject(socket, requestId, "invalid_message");
    return;
  }

  const message = parsed.data;

  let outcome: CommandOutcome;
  try {
    outcome = await runCommand(actor, options, message);
  } catch (error) {
    log.error({ err: error, command: message.type }, "websocket command failed unexpectedly");
    reject(socket, message.requestId, "internal_error");
    return;
  }

  if (!outcome.ok) {
    reject(socket, message.requestId, WS_ERROR_BY_GAME_ERROR[outcome.code]);
    if (outcome.publish !== undefined) {
      try {
        await outcome.publish();
      } catch (error) {
        log.error({ err: error, command: message.type }, "websocket fan-out failed after timeout");
      }
    }
    return;
  }

  sendMessage(socket, { type: "command.accepted", requestId: message.requestId });

  // Fan-out happens after acknowledgement and cannot reverse a committed command.
  try {
    await outcome.publish();
  } catch (error) {
    log.error({ err: error, command: message.type }, "websocket fan-out failed after a commit");
  }
}

function reject(socket: WebSocket, requestId: string | null, code: WsErrorCode): void {
  sendMessage(socket, {
    type: "command.rejected",
    requestId,
    code,
    message: REJECTION_MESSAGES[code],
  });
}

type ReadFrame = { readonly ok: true; readonly payload: unknown } | { readonly ok: false };

function readFrame(data: RawData, isBinary: boolean): ReadFrame {
  if (isBinary) {
    return { ok: false };
  }

  try {
    return { ok: true, payload: JSON.parse(frameText(data)) };
  } catch {
    return { ok: false };
  }
}

/** Charges account first, then address; a later refusal does not refund either. */
async function spendCommandBudget(
  session: SocketSession,
  limits: WebSocketLimits,
): Promise<{ readonly allowed: boolean }> {
  const user = await limits.userCommands.consume(session.user.id);

  if (!user.allowed) {
    return user;
  }

  return limits.addressCommands.consume(session.address);
}

/** Separates the decision from best-effort post-acknowledgement fan-out. */
type CommandOutcome =
  | { readonly ok: false; readonly code: GameErrorCode; readonly publish?: () => Promise<void> }
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

  /** Fan-out for a reopened lobby whose released player is absent from its snapshot. */
  const publishAbandonedCheck = async (
    game: GameSnapshot,
    releasedPlayerId: string,
  ): Promise<void> => {
    hub.send(game.players.playerOne.id, { type: "game.snapshot", game });
    hub.send(releasedPlayerId, { type: "game.closed", gameId: game.id });
    await broadcastLobbies();
  };

  const sendGameToPlayers = (game: GameSnapshot): void => {
    const snapshot: WsServerMessage = { type: "game.snapshot", game };
    for (const userId of participantIds(game)) {
      hub.send(userId, snapshot);
    }
  };

  switch (message.type) {
    case "lobby.create": {
      const result = await gameService.createGame({
        actorId: actor.id,
        rated: message.rated,
        timeControl: message.timeControl,
        creatorSeat: message.creatorSeat,
      });
      if (!result.ok) {
        return result.committed === undefined
          ? { ok: false, code: result.code }
          : {
              ok: false,
              code: result.code,
              publish: () => {
                sendGameToPlayers(result.committed as GameSnapshot);
                return Promise.resolve();
              },
            };
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
        return result.committed === undefined
          ? { ok: false, code: result.code }
          : {
              ok: false,
              code: result.code,
              publish: () => {
                sendGameToPlayers(result.committed as GameSnapshot);
                return Promise.resolve();
              },
            };
      }

      return {
        ok: true,
        publish: async () => {
          sendGameToPlayers(result.value);
          await broadcastLobbies();
        },
      };
    }

    case "game.ready": {
      const result = await gameService.readyGame({
        actorId: actor.id,
        gameId: message.gameId,
        readyCheckGeneration: message.readyCheckGeneration,
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

    case "game.decline": {
      const result = await gameService.declineGame({
        actorId: actor.id,
        gameId: message.gameId,
        readyCheckGeneration: message.readyCheckGeneration,
      });
      if (!result.ok) {
        return { ok: false, code: result.code };
      }

      return {
        ok: true,
        publish: async () => {
          await publishAbandonedCheck(result.value.game, result.value.releasedPlayerId);
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
        const committed = result.committed;
        return committed === undefined
          ? { ok: false, code: result.code }
          : {
              ok: false,
              code: result.code,
              publish: () => {
                sendGameToPlayers(committed);
                return Promise.resolve();
              },
            };
      }

      return {
        ok: true,
        publish: () => {
          sendGameToPlayers(result.value);
          return Promise.resolve();
        },
      };
    }

    case "game.resign": {
      const result = await gameService.resignGame({
        actorId: actor.id,
        gameId: message.gameId,
        expectedRevision: message.expectedRevision,
      });

      if (!result.ok) {
        const committed = result.committed;
        return committed === undefined
          ? { ok: false, code: result.code }
          : {
              ok: false,
              code: result.code,
              publish: () => {
                sendGameToPlayers(committed);
                return Promise.resolve();
              },
            };
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

/** Sends a close frame, then drops peers that outlive the grace period. */
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

/** Recovers only a valid UUID for correlating malformed requests. */
function recoverRequestId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }

  const candidate = (payload as { readonly requestId?: unknown }).requestId;
  const parsed = requestIdSchema.safeParse(candidate);

  return parsed.success ? parsed.data : null;
}
