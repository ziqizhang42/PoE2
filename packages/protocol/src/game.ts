/**
 * Wire representation of a game.
 *
 * Every board dimension, cell value, player number, and scoring rule comes from
 * `@poe2/rules`, which stays the single definition of what those mean. This
 * module only describes how they are carried over a transport, so it is shared
 * unchanged by the browser WebSocket protocol and by any later adapter.
 */

import {
  BOARD_SIZE,
  CELL_COUNT,
  EMPTY,
  PLAYER_ONE,
  PLAYER_TWO,
  type Board,
  type Cell,
  type GameResult,
  type Player,
  type ScoreByPlayer,
  type Square,
} from "@poe2/rules";
import { z } from "zod";

import { AuthUserSchema, type AuthUser } from "./auth.js";

export type GameStatus = "waiting" | "active" | "finished";

export const GAME_STATUSES: readonly GameStatus[] = ["waiting", "active", "finished"];

/** A waiting game as it appears in the lobby list. */
export interface LobbyEntry {
  readonly id: string;
  readonly playerOne: AuthUser;
  readonly createdAt: string;
}

interface GameSnapshotFields {
  readonly id: string;
  /**
   * Bumped once per accepted state change. A client echoes the revision it
   * believes it is acting on, so a move computed against a board the server has
   * already replaced is rejected instead of applied.
   */
  readonly revision: number;
  readonly board: Board;
  readonly moves: readonly Square[];
  /** Raw board scores, before Player 2's handicap. */
  readonly scores: ScoreByPlayer;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WaitingGameSnapshot extends GameSnapshotFields {
  readonly status: "waiting";
  readonly players: { readonly playerOne: AuthUser; readonly playerTwo: null };
  readonly sideToMove: null;
  readonly result: null;
}

export interface ActiveGameSnapshot extends GameSnapshotFields {
  readonly status: "active";
  readonly players: { readonly playerOne: AuthUser; readonly playerTwo: AuthUser };
  readonly sideToMove: Player;
  readonly result: null;
}

export interface FinishedGameSnapshot extends GameSnapshotFields {
  readonly status: "finished";
  readonly players: { readonly playerOne: AuthUser; readonly playerTwo: AuthUser };
  readonly sideToMove: null;
  readonly result: GameResult;
}

export type GameSnapshot = WaitingGameSnapshot | ActiveGameSnapshot | FinishedGameSnapshot;

const cellSchema = z.union([z.literal(EMPTY), z.literal(PLAYER_ONE), z.literal(PLAYER_TWO)]);
const playerSchema = z.union([z.literal(PLAYER_ONE), z.literal(PLAYER_TWO)]);

const squareSchema = z.strictObject({
  row: z
    .int()
    .min(0)
    .max(BOARD_SIZE - 1),
  col: z
    .int()
    .min(0)
    .max(BOARD_SIZE - 1),
});

const scoreByPlayerSchema = z.strictObject({
  playerOne: z.int().min(0),
  playerTwo: z.int().min(0),
});

const gameResultSchema = z.strictObject({
  scores: scoreByPlayerSchema,
  winner: playerSchema,
  // Half-points keep the handicap in exact integers, so this is always odd and
  // never zero: a finished game cannot be drawn.
  marginHalfPoints: z.int(),
});

const pairedPlayersSchema = z.strictObject({
  playerOne: AuthUserSchema,
  playerTwo: AuthUserSchema,
});

const snapshotFields = {
  id: z.uuid(),
  revision: z.int().min(0),
  board: z.array(cellSchema).length(CELL_COUNT),
  moves: z.array(squareSchema).max(CELL_COUNT),
  scores: scoreByPlayerSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};

const waitingGameSnapshotSchema = z.strictObject({
  ...snapshotFields,
  status: z.literal("waiting"),
  players: z.strictObject({ playerOne: AuthUserSchema, playerTwo: z.null() }),
  moves: z.array(squareSchema).max(0),
  sideToMove: z.null(),
  result: z.null(),
});

const activeGameSnapshotSchema = z.strictObject({
  ...snapshotFields,
  status: z.literal("active"),
  players: pairedPlayersSchema,
  sideToMove: playerSchema,
  result: z.null(),
});

const finishedGameSnapshotSchema = z.strictObject({
  ...snapshotFields,
  status: z.literal("finished"),
  players: pairedPlayersSchema,
  sideToMove: z.null(),
  result: gameResultSchema,
});

export const CellSchema: z.ZodType<Cell> = cellSchema;
export const PlayerSchema: z.ZodType<Player> = playerSchema;
export const SquareSchema: z.ZodType<Square> = squareSchema;

/** Exactly `CELL_COUNT` cells, in the row-major order `@poe2/rules` indexes by. */
export const BoardSchema: z.ZodType<Board> = snapshotFields.board;

export const ScoreByPlayerSchema: z.ZodType<ScoreByPlayer> = scoreByPlayerSchema;
export const GameResultSchema: z.ZodType<GameResult> = gameResultSchema;

export const LobbyEntrySchema: z.ZodType<LobbyEntry> = z.strictObject({
  id: z.uuid(),
  playerOne: AuthUserSchema,
  createdAt: z.iso.datetime(),
});

export const WaitingGameSnapshotSchema: z.ZodType<WaitingGameSnapshot> = waitingGameSnapshotSchema;
export const ActiveGameSnapshotSchema: z.ZodType<ActiveGameSnapshot> = activeGameSnapshotSchema;
export const FinishedGameSnapshotSchema: z.ZodType<FinishedGameSnapshot> =
  finishedGameSnapshotSchema;

/**
 * The status-dependent invariants are carried by the union rather than by
 * optional fields, so a snapshot claiming to be `active` without a second
 * player, or `finished` without a result, fails validation outright.
 *
 * Consistency the shape cannot express - that replaying `moves` reproduces
 * `board` and `scores` - stays the sending server's responsibility.
 */
export const GameSnapshotSchema: z.ZodType<GameSnapshot> = z.discriminatedUnion("status", [
  waitingGameSnapshotSchema,
  activeGameSnapshotSchema,
  finishedGameSnapshotSchema,
]);
