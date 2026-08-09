import { z } from "zod";

import { UsernameSchema } from "./auth.js";

export interface PublicPlayerStatistics {
  readonly totalFinishedGames: number;
  readonly wins: number;
  readonly losses: number;
  readonly ratedWins: number;
  readonly ratedLosses: number;
  readonly ratedGames: number;
  readonly casualGames: number;
  readonly boardFullGames: number;
  readonly resignationGames: number;
  readonly timeoutGames: number;
}

/** Whole percentile among rated players; null means outside that population. */
export type RatingPercentile = number | null;

export interface RatingPoint {
  readonly at: string;
  readonly rating: number;
}

export const MAX_RATING_HISTORY = 100;

export interface PublicPlayerProfile {
  readonly username: string;
  readonly createdAt: string;
  readonly rating: {
    readonly value: number;
    readonly deviation: number;
    readonly percentile: RatingPercentile;
  };
  readonly statistics: PublicPlayerStatistics;
  /** Recent rated results oldest first, including the starting point. */
  readonly ratingHistory: readonly RatingPoint[];
}

export type PlayerErrorCode =
  | "player_not_found"
  | "invalid_request"
  | "invalid_cursor"
  | "rate_limited"
  | "internal_error";

export interface PlayerErrorResponse {
  readonly code: PlayerErrorCode;
  readonly message: string;
}

const countSchema = z.int().min(0);

const statisticsSchema = z
  .strictObject({
    totalFinishedGames: countSchema,
    wins: countSchema,
    losses: countSchema,
    ratedWins: countSchema,
    ratedLosses: countSchema,
    ratedGames: countSchema,
    casualGames: countSchema,
    boardFullGames: countSchema,
    resignationGames: countSchema,
    timeoutGames: countSchema,
  })
  .superRefine((statistics, context) => {
    const totals = [
      statistics.wins + statistics.losses,
      statistics.ratedGames + statistics.casualGames,
      statistics.boardFullGames + statistics.resignationGames + statistics.timeoutGames,
    ];

    if (totals.some((total) => total !== statistics.totalFinishedGames)) {
      context.addIssue({
        code: "custom",
        message: "Finished-game statistics must describe the same total",
      });
    }

    if (statistics.ratedWins + statistics.ratedLosses !== statistics.ratedGames) {
      context.addIssue({
        code: "custom",
        message: "Rated win/loss statistics must describe the rated game total",
      });
    }
  });

export const PublicPlayerStatisticsSchema: z.ZodType<PublicPlayerStatistics> = statisticsSchema;

export const PublicPlayerProfileSchema: z.ZodType<PublicPlayerProfile> = z.strictObject({
  username: UsernameSchema,
  createdAt: z.iso.datetime(),
  rating: z.strictObject({
    value: z.int(),
    deviation: z.int().min(1),
    percentile: z.union([z.int().min(0).max(100), z.null()]),
  }),
  statistics: statisticsSchema,
  ratingHistory: z
    .array(z.strictObject({ at: z.iso.datetime(), rating: z.int() }))
    .max(MAX_RATING_HISTORY + 1),
});

export const PlayerErrorResponseSchema: z.ZodType<PlayerErrorResponse> = z.strictObject({
  code: z.enum([
    "player_not_found",
    "invalid_request",
    "invalid_cursor",
    "rate_limited",
    "internal_error",
  ]),
  message: z.string().min(1),
});
