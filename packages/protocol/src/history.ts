import { CELL_COUNT, type Player, type ScoreByPlayer, type Square } from "@poe2/rules";
import { z } from "zod";

import { AuthUserSchema, type AuthUser } from "./auth.js";
import {
  FinishedGameClockSchema,
  GameOutcomeSchema,
  PlayerSchema,
  ScoreByPlayerSchema,
  SquareSchema,
  TimeControlSchema,
  type FinishedGameClock,
  type GameOutcome,
  type TimeControl,
} from "./game.js";

export interface RatingChange {
  readonly before: number;
  readonly after: number;
}

/** A finished game relative to the subject whose history is requested. */
export interface GameHistoryEntry {
  readonly id: string;
  readonly seat: Player;
  readonly opponent: AuthUser;
  readonly rated: boolean;
  readonly timeControl: TimeControl;
  readonly outcome: GameOutcome;
  readonly scores: ScoreByPlayer;
  readonly plies: number;
  readonly ratingChange: RatingChange | null;
  readonly createdAt: string;
}

export interface GameHistoryPage {
  readonly games: readonly GameHistoryEntry[];
  /** Opaque continuation token; null marks the last page. */
  readonly nextCursor: string | null;
}

export interface GameReplay {
  readonly id: string;
  readonly players: { readonly playerOne: AuthUser; readonly playerTwo: AuthUser };
  readonly rated: boolean;
  readonly timeControl: TimeControl;
  readonly moves: readonly Square[];
  readonly clockHistory: ReplayClockHistory | null;
  readonly outcome: GameOutcome;
  readonly createdAt: string;
}

export interface ReplayMoveClock {
  readonly ply: number;
  readonly acceptedAt: string;
  readonly elapsedMs: number;
  readonly incrementAppliedMs: number;
  readonly remainingMs: { readonly playerOne: number; readonly playerTwo: number };
}

export interface ReplayClockHistory {
  readonly moves: readonly ReplayMoveClock[];
  readonly final: FinishedGameClock;
}

export type GamesErrorCode =
  | "game_not_found"
  | "invalid_request"
  | "rate_limited"
  | "internal_error";

export interface GamesErrorResponse {
  readonly code: GamesErrorCode;
  readonly message: string;
}

export const HISTORY_PAGE_LIMIT = 20;
export const MAX_HISTORY_PAGE_LIMIT = 50;

const ratingChangeSchema = z.strictObject({
  before: z.number().finite(),
  after: z.number().finite(),
});

const historyEntrySchema = z
  .strictObject({
    id: z.uuid(),
    seat: PlayerSchema,
    opponent: AuthUserSchema,
    rated: z.boolean(),
    timeControl: TimeControlSchema,
    outcome: GameOutcomeSchema,
    scores: ScoreByPlayerSchema,
    plies: z.int().min(0).max(CELL_COUNT),
    ratingChange: z.union([ratingChangeSchema, z.null()]),
    createdAt: z.iso.datetime(),
  })
  .superRefine((game, context) => {
    if (game.outcome.reason === "timeout" && game.timeControl.kind === "untimed") {
      context.addIssue({
        code: "custom",
        path: ["outcome", "reason"],
        message: "Only a timed game may finish by timeout",
      });
    }
  });

export const RatingChangeSchema: z.ZodType<RatingChange> = ratingChangeSchema;
export const GameHistoryEntrySchema: z.ZodType<GameHistoryEntry> = historyEntrySchema;

export const GameHistoryPageSchema: z.ZodType<GameHistoryPage> = z.strictObject({
  games: z.array(historyEntrySchema).max(MAX_HISTORY_PAGE_LIMIT),
  nextCursor: z.union([z.string().min(1), z.null()]),
});

export const GameReplaySchema: z.ZodType<GameReplay> = z
  .strictObject({
    id: z.uuid(),
    players: z.strictObject({ playerOne: AuthUserSchema, playerTwo: AuthUserSchema }),
    rated: z.boolean(),
    timeControl: TimeControlSchema,
    moves: z.array(SquareSchema).max(CELL_COUNT),
    clockHistory: z.union([
      z
        .strictObject({
          moves: z.array(
            z.strictObject({
              ply: z.int().min(1).max(CELL_COUNT),
              acceptedAt: z.iso.datetime(),
              elapsedMs: z.int().min(0),
              incrementAppliedMs: z.int().min(0),
              remainingMs: z.strictObject({
                playerOne: z.int().min(0),
                playerTwo: z.int().min(0),
              }),
            }),
          ),
          final: FinishedGameClockSchema,
        })
        .superRefine((history, context) => {
          for (const [index, entry] of history.moves.entries()) {
            if (entry.ply !== index + 1) {
              context.addIssue({
                code: "custom",
                path: ["moves", index, "ply"],
                message: "Clock history plies must be sequential",
              });
            }
          }
        }),
      z.null(),
    ]),
    outcome: GameOutcomeSchema,
    createdAt: z.iso.datetime(),
  })
  .superRefine((game, context) => {
    const timed = game.timeControl.kind === "timed";
    if (timed !== (game.clockHistory !== null)) {
      context.addIssue({
        code: "custom",
        path: ["clockHistory"],
        message: "Clock history presence must match the persisted time control",
      });
    }

    if (game.outcome.reason === "timeout" && !timed) {
      context.addIssue({
        code: "custom",
        path: ["outcome", "reason"],
        message: "Only a timed game may finish by timeout",
      });
    }

    if (game.outcome.reason === "timeout" && game.clockHistory !== null) {
      const loser = game.outcome.winner === 1 ? "playerTwo" : "playerOne";
      if (game.clockHistory.final.remainingMs[loser] !== 0) {
        context.addIssue({
          code: "custom",
          path: ["clockHistory", "final", "remainingMs", loser],
          message: "The player who lost on time must have no time remaining",
        });
      }
    }

    if (game.clockHistory !== null && game.clockHistory.moves.length !== game.moves.length) {
      context.addIssue({
        code: "custom",
        path: ["clockHistory", "moves"],
        message: "Clock history must align with canonical moves",
      });
    }
  });

export const GamesErrorResponseSchema: z.ZodType<GamesErrorResponse> = z.strictObject({
  code: z.enum(["game_not_found", "invalid_request", "rate_limited", "internal_error"]),
  message: z.string().min(1),
});
