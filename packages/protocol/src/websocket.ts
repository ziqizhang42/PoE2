import type { Player, Square } from "@poe2/rules";
import { z } from "zod";

import { AuthUserSchema, type AuthUser } from "./auth.js";
import {
  GameSnapshotSchema,
  LobbyEntrySchema,
  PlayerSchema,
  SquareSchema,
  TimeControlSchema,
} from "./game.js";
import type { GameSnapshot, LobbyEntry, TimeControl } from "./game.js";

export const WS_PROTOCOL_VERSION = 1;

export const PLAYER_ACTIVITIES = ["open_room", "in_game"] as const;
export type PlayerActivity = (typeof PLAYER_ACTIVITIES)[number];

export interface PlayerStatus {
  readonly id: string;
  readonly online: boolean;
  readonly activity: PlayerActivity | null;
}

/** Closed rejection set shared by client and adapter. */
export type WsErrorCode =
  | "invalid_message"
  | "game_not_found"
  | "game_not_waiting"
  | "cannot_join_own_game"
  | "not_lobby_owner"
  | "not_a_player"
  | "game_not_ready_check"
  | "not_your_turn"
  | "stale_game"
  | "occupied"
  | "game_over"
  | "lobby_already_open"
  | "rated_requires_clock"
  | "rate_limited"
  | "internal_error";

export interface WsLobbyCreateMessage {
  readonly type: "lobby.create";
  readonly requestId: string;
  readonly rated: boolean;
  readonly creatorSeat: Player;
  readonly timeControl: TimeControl;
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
  readonly expectedRevision: number;
  readonly square: Square;
}

export interface WsGameResignMessage {
  readonly type: "game.resign";
  readonly requestId: string;
  readonly gameId: string;
  readonly expectedRevision: number;
}

/** Idempotent within one ready-check generation. */
export interface WsGameReadyMessage {
  readonly type: "game.ready";
  readonly requestId: string;
  readonly gameId: string;
  readonly readyCheckGeneration: number;
}

/** Releases the joining seat without recording a result. */
export interface WsGameDeclineMessage {
  readonly type: "game.decline";
  readonly requestId: string;
  readonly gameId: string;
  readonly readyCheckGeneration: number;
}

export type WsClientMessage =
  | WsLobbyCreateMessage
  | WsLobbyJoinMessage
  | WsLobbyCancelMessage
  | WsGameReadyMessage
  | WsGameDeclineMessage
  | WsGameMoveMessage
  | WsGameResignMessage;

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

/** Complete replacement; omitted players are offline with no current activity. */
export interface WsPlayersStatusMessage {
  readonly type: "players.status";
  readonly players: readonly PlayerStatus[];
}

/** Invalidates the HTTP directory after its durable fields may have changed. */
export interface WsPlayersChangedMessage {
  readonly type: "players.changed";
}

/** Marks the opening replay complete; session.ready alone does not. */
export interface WsSessionSyncedMessage {
  readonly type: "session.synced";
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
  | WsSessionSyncedMessage
  | WsLobbySnapshotMessage
  | WsGameSnapshotMessage
  | WsGameClosedMessage
  | WsPlayersStatusMessage
  | WsPlayersChangedMessage
  | WsCommandAcceptedMessage
  | WsCommandRejectedMessage;

const requestIdSchema = z.uuid();
const gameIdSchema = z.uuid();

// `satisfies` checks the list against the union; adapter tests check the reverse.
const ERROR_CODES = [
  "invalid_message",
  "game_not_found",
  "game_not_waiting",
  "cannot_join_own_game",
  "not_lobby_owner",
  "not_a_player",
  "game_not_ready_check",
  "not_your_turn",
  "stale_game",
  "occupied",
  "game_over",
  "lobby_already_open",
  "rated_requires_clock",
  "rate_limited",
  "internal_error",
] as const satisfies readonly WsErrorCode[];

const errorCodeSchema = z.enum(ERROR_CODES);

const lobbyCreateMessageSchema = z.strictObject({
  type: z.literal("lobby.create"),
  requestId: requestIdSchema,
  rated: z.boolean(),
  creatorSeat: PlayerSchema,
  timeControl: TimeControlSchema,
});

// Applied after constructing the discriminated union because its members must
// remain plain object schemas.
function checkRatedHasClock(message: WsClientMessage, context: z.RefinementCtx): void {
  if (message.type !== "lobby.create") {
    return;
  }
  if (message.rated && message.timeControl.kind === "untimed") {
    context.addIssue({
      code: "custom",
      path: ["timeControl"],
      message: "A rated game must have a clock",
    });
  }
}

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

const gameReadyMessageSchema = z.strictObject({
  type: z.literal("game.ready"),
  requestId: requestIdSchema,
  gameId: gameIdSchema,
  readyCheckGeneration: z.int().min(1),
});

const gameDeclineMessageSchema = z.strictObject({
  type: z.literal("game.decline"),
  requestId: requestIdSchema,
  gameId: gameIdSchema,
  readyCheckGeneration: z.int().min(1),
});

const gameMoveMessageSchema = z.strictObject({
  type: z.literal("game.move"),
  requestId: requestIdSchema,
  gameId: gameIdSchema,
  expectedRevision: z.int().min(0),
  square: SquareSchema,
});

const gameResignMessageSchema = z.strictObject({
  type: z.literal("game.resign"),
  requestId: requestIdSchema,
  gameId: gameIdSchema,
  expectedRevision: z.int().min(0),
});

const sessionReadyMessageSchema = z.strictObject({
  type: z.literal("session.ready"),
  protocolVersion: z.literal(WS_PROTOCOL_VERSION),
  user: AuthUserSchema,
});

const sessionSyncedMessageSchema = z.strictObject({
  type: z.literal("session.synced"),
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

const playerStatusSchema: z.ZodType<PlayerStatus> = z.strictObject({
  id: z.uuid(),
  online: z.boolean(),
  activity: z.union([z.enum(PLAYER_ACTIVITIES), z.null()]),
});

const playersStatusMessageSchema = z.strictObject({
  type: z.literal("players.status"),
  players: z.array(playerStatusSchema),
});

const playersChangedMessageSchema = z.strictObject({
  type: z.literal("players.changed"),
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

export const WsLobbyCreateMessageSchema: z.ZodType<WsLobbyCreateMessage> =
  lobbyCreateMessageSchema.superRefine(checkRatedHasClock);
export const WsLobbyJoinMessageSchema: z.ZodType<WsLobbyJoinMessage> = lobbyJoinMessageSchema;
export const WsLobbyCancelMessageSchema: z.ZodType<WsLobbyCancelMessage> = lobbyCancelMessageSchema;
export const WsGameReadyMessageSchema: z.ZodType<WsGameReadyMessage> = gameReadyMessageSchema;
export const WsGameDeclineMessageSchema: z.ZodType<WsGameDeclineMessage> = gameDeclineMessageSchema;
export const WsGameMoveMessageSchema: z.ZodType<WsGameMoveMessage> = gameMoveMessageSchema;
export const WsGameResignMessageSchema: z.ZodType<WsGameResignMessage> = gameResignMessageSchema;

export const WsClientMessageSchema: z.ZodType<WsClientMessage> = z
  .discriminatedUnion("type", [
    lobbyCreateMessageSchema,
    lobbyJoinMessageSchema,
    lobbyCancelMessageSchema,
    gameReadyMessageSchema,
    gameDeclineMessageSchema,
    gameMoveMessageSchema,
    gameResignMessageSchema,
  ])
  .superRefine(checkRatedHasClock);

export const WsSessionReadyMessageSchema: z.ZodType<WsSessionReadyMessage> =
  sessionReadyMessageSchema;
export const WsSessionSyncedMessageSchema: z.ZodType<WsSessionSyncedMessage> =
  sessionSyncedMessageSchema;
export const WsLobbySnapshotMessageSchema: z.ZodType<WsLobbySnapshotMessage> =
  lobbySnapshotMessageSchema;
export const WsGameSnapshotMessageSchema: z.ZodType<WsGameSnapshotMessage> =
  gameSnapshotMessageSchema;
export const WsGameClosedMessageSchema: z.ZodType<WsGameClosedMessage> = gameClosedMessageSchema;
export const PlayerStatusSchema: z.ZodType<PlayerStatus> = playerStatusSchema;
export const WsPlayersStatusMessageSchema: z.ZodType<WsPlayersStatusMessage> =
  playersStatusMessageSchema;
export const WsPlayersChangedMessageSchema: z.ZodType<WsPlayersChangedMessage> =
  playersChangedMessageSchema;
export const WsCommandAcceptedMessageSchema: z.ZodType<WsCommandAcceptedMessage> =
  commandAcceptedMessageSchema;
export const WsCommandRejectedMessageSchema: z.ZodType<WsCommandRejectedMessage> =
  commandRejectedMessageSchema;

export const WsServerMessageSchema: z.ZodType<WsServerMessage> = z.discriminatedUnion("type", [
  sessionReadyMessageSchema,
  sessionSyncedMessageSchema,
  lobbySnapshotMessageSchema,
  gameSnapshotMessageSchema,
  gameClosedMessageSchema,
  playersStatusMessageSchema,
  playersChangedMessageSchema,
  commandAcceptedMessageSchema,
  commandRejectedMessageSchema,
]);
