/**
 * The browser WebSocket protocol.
 *
 * Frames are JSON text. Every client message carries a `requestId` that the
 * server echoes on `command.accepted` or `command.rejected`, which is the only
 * correlation mechanism: every other server message is an unsolicited state
 * push rather than a reply.
 *
 * Nothing here carries a credential. Authentication happens once, during the
 * HTTP upgrade, and the identity it establishes belongs to the server; a client
 * cannot name a user, a player number, a board, a score, or a result.
 */

import type { Square } from "@poe2/rules";
import { z } from "zod";

import { AuthUserSchema, type AuthUser } from "./auth.js";
import { GameSnapshotSchema, LobbyEntrySchema, SquareSchema } from "./game.js";
import type { GameSnapshot, LobbyEntry } from "./game.js";

export const WS_PROTOCOL_VERSION = 1;

/**
 * Closed set of rejection reasons. `invalid_message` and `internal_error` are
 * transport-level; the rest name a decision the authoritative game service
 * made, and carry the same meaning for any other adapter in front of it.
 */
export type WsErrorCode =
  | "invalid_message"
  | "game_not_found"
  | "game_not_waiting"
  | "cannot_join_own_game"
  | "not_lobby_owner"
  | "not_a_player"
  | "not_your_turn"
  | "stale_game"
  | "occupied"
  | "game_over"
  | "internal_error";

export interface WsLobbyCreateMessage {
  readonly type: "lobby.create";
  readonly requestId: string;
}

export interface WsLobbyJoinMessage {
  readonly type: "lobby.join";
  readonly requestId: string;
  readonly gameId: string;
}

export interface WsLobbyCancelMessage {
  readonly type: "lobby.cancel";
  readonly requestId: string;
  readonly gameId: string;
}

export interface WsGameMoveMessage {
  readonly type: "game.move";
  readonly requestId: string;
  readonly gameId: string;
  /** The revision the client believes it is moving from. */
  readonly expectedRevision: number;
  readonly square: Square;
}

export type WsClientMessage =
  | WsLobbyCreateMessage
  | WsLobbyJoinMessage
  | WsLobbyCancelMessage
  | WsGameMoveMessage;

export interface WsSessionReadyMessage {
  readonly type: "session.ready";
  readonly protocolVersion: number;
  readonly user: AuthUser;
}

export interface WsLobbySnapshotMessage {
  readonly type: "lobby.snapshot";
  readonly lobbies: readonly LobbyEntry[];
}

export interface WsGameSnapshotMessage {
  readonly type: "game.snapshot";
  readonly game: GameSnapshot;
}

export interface WsGameClosedMessage {
  readonly type: "game.closed";
  readonly gameId: string;
}

export interface WsCommandAcceptedMessage {
  readonly type: "command.accepted";
  readonly requestId: string;
}

export interface WsCommandRejectedMessage {
  readonly type: "command.rejected";
  /** `null` when no request ID could be recovered from the offending frame. */
  readonly requestId: string | null;
  readonly code: WsErrorCode;
  readonly message: string;
}

export type WsServerMessage =
  | WsSessionReadyMessage
  | WsLobbySnapshotMessage
  | WsGameSnapshotMessage
  | WsGameClosedMessage
  | WsCommandAcceptedMessage
  | WsCommandRejectedMessage;

const requestIdSchema = z.uuid();
const gameIdSchema = z.uuid();

const errorCodeSchema = z.enum([
  "invalid_message",
  "game_not_found",
  "game_not_waiting",
  "cannot_join_own_game",
  "not_lobby_owner",
  "not_a_player",
  "not_your_turn",
  "stale_game",
  "occupied",
  "game_over",
  "internal_error",
]);

const lobbyCreateMessageSchema = z.strictObject({
  type: z.literal("lobby.create"),
  requestId: requestIdSchema,
});

const lobbyJoinMessageSchema = z.strictObject({
  type: z.literal("lobby.join"),
  requestId: requestIdSchema,
  gameId: gameIdSchema,
});

const lobbyCancelMessageSchema = z.strictObject({
  type: z.literal("lobby.cancel"),
  requestId: requestIdSchema,
  gameId: gameIdSchema,
});

const gameMoveMessageSchema = z.strictObject({
  type: z.literal("game.move"),
  requestId: requestIdSchema,
  gameId: gameIdSchema,
  expectedRevision: z.int().min(0),
  square: SquareSchema,
});

const sessionReadyMessageSchema = z.strictObject({
  type: z.literal("session.ready"),
  protocolVersion: z.literal(WS_PROTOCOL_VERSION),
  user: AuthUserSchema,
});

const lobbySnapshotMessageSchema = z.strictObject({
  type: z.literal("lobby.snapshot"),
  lobbies: z.array(LobbyEntrySchema),
});

const gameSnapshotMessageSchema = z.strictObject({
  type: z.literal("game.snapshot"),
  game: GameSnapshotSchema,
});

const gameClosedMessageSchema = z.strictObject({
  type: z.literal("game.closed"),
  gameId: gameIdSchema,
});

const commandAcceptedMessageSchema = z.strictObject({
  type: z.literal("command.accepted"),
  requestId: requestIdSchema,
});

const commandRejectedMessageSchema = z.strictObject({
  type: z.literal("command.rejected"),
  requestId: requestIdSchema.nullable(),
  code: errorCodeSchema,
  message: z.string().min(1),
});

export const WS_ERROR_CODES: readonly WsErrorCode[] = errorCodeSchema.options;

export const WsErrorCodeSchema: z.ZodType<WsErrorCode> = errorCodeSchema;

export const WsLobbyCreateMessageSchema: z.ZodType<WsLobbyCreateMessage> = lobbyCreateMessageSchema;
export const WsLobbyJoinMessageSchema: z.ZodType<WsLobbyJoinMessage> = lobbyJoinMessageSchema;
export const WsLobbyCancelMessageSchema: z.ZodType<WsLobbyCancelMessage> = lobbyCancelMessageSchema;
export const WsGameMoveMessageSchema: z.ZodType<WsGameMoveMessage> = gameMoveMessageSchema;

export const WsClientMessageSchema: z.ZodType<WsClientMessage> = z.discriminatedUnion("type", [
  lobbyCreateMessageSchema,
  lobbyJoinMessageSchema,
  lobbyCancelMessageSchema,
  gameMoveMessageSchema,
]);

export const WsSessionReadyMessageSchema: z.ZodType<WsSessionReadyMessage> =
  sessionReadyMessageSchema;
export const WsLobbySnapshotMessageSchema: z.ZodType<WsLobbySnapshotMessage> =
  lobbySnapshotMessageSchema;
export const WsGameSnapshotMessageSchema: z.ZodType<WsGameSnapshotMessage> =
  gameSnapshotMessageSchema;
export const WsGameClosedMessageSchema: z.ZodType<WsGameClosedMessage> = gameClosedMessageSchema;
export const WsCommandAcceptedMessageSchema: z.ZodType<WsCommandAcceptedMessage> =
  commandAcceptedMessageSchema;
export const WsCommandRejectedMessageSchema: z.ZodType<WsCommandRejectedMessage> =
  commandRejectedMessageSchema;

export const WsServerMessageSchema: z.ZodType<WsServerMessage> = z.discriminatedUnion("type", [
  sessionReadyMessageSchema,
  lobbySnapshotMessageSchema,
  gameSnapshotMessageSchema,
  gameClosedMessageSchema,
  commandAcceptedMessageSchema,
  commandRejectedMessageSchema,
]);
