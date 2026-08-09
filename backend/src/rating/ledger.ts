/**
 * Applies a result in the game's finishing transaction. The ledger primary key
 * makes retries idempotent, while ascending player locks serialize concurrent
 * games without deadlocks.
 */

import { PLAYER_ONE, type Player } from "@poe2/rules";
import { eq, inArray, sql } from "drizzle-orm";

import type { DatabaseExecutor } from "../db/client.js";
import { ratingEvents, users } from "../db/schema.js";
import { withDeviationFloor } from "./bounds.js";
import { afterUnplayedPeriods } from "./decay.js";
import { updateRating, type GlickoSystem, type Rating } from "./glicko2.js";

const DEFAULT_PERIOD_MS = 7 * 24 * 60 * 60 * 1_000;

export interface FinishedRatedGame {
  readonly gameId: string;
  readonly playerOneId: string;
  readonly playerTwoId: string;
  readonly winner: Player;
}

export interface RatingLedger {
  /** Must use the transaction that finished the game. */
  applyFinishedGame(executor: DatabaseExecutor, game: FinishedRatedGame): Promise<void>;
}

export interface RatingLedgerOptions {
  readonly periodMs: number;
  readonly system?: GlickoSystem;
}

export function createRatingLedger(
  options: RatingLedgerOptions = { periodMs: DEFAULT_PERIOD_MS },
): RatingLedger {
  const { periodMs, system } = options;
  if (!Number.isFinite(periodMs) || periodMs <= 0) {
    throw new Error("a rating period must be a positive duration");
  }

  const periodInterval = sql`make_interval(secs => ${periodMs / 1_000})`;

  return {
    async applyFinishedGame(executor, game) {
      // A fixed lock order prevents concurrent games from deadlocking.
      const [firstId, secondId] = [game.playerOneId, game.playerTwoId].sort();
      if (firstId === undefined || secondId === undefined) {
        throw new Error(`game ${game.gameId} has fewer than two players to rate`);
      }

      const locked = new Map<string, Rating>();
      for (const id of [firstId, secondId]) {
        locked.set(id, await lockRating(executor, id));
      }

      // Sample due periods only after both locks are held. Otherwise the first
      // player could cross a boundary while waiting for the second player's row.
      const due = await readDuePeriods(executor, [firstId, secondId], periodInterval);
      const oneLocked = locked.get(game.playerOneId);
      const twoLocked = locked.get(game.playerTwoId);
      if (oneLocked === undefined || twoLocked === undefined) {
        throw new Error(`game ${game.gameId} names a player who does not exist`);
      }

      // The background sweep is only a discovery mechanism. Apply every period
      // already due while these rows are locked so this result cannot erase it.
      const one = afterUnplayedPeriods(oneLocked, due.get(game.playerOneId) ?? 0, system);
      const two = afterUnplayedPeriods(twoLocked, due.get(game.playerTwoId) ?? 0, system);
      const oneWon = game.winner === PLAYER_ONE;

      // Both updates use pre-game values; persist the floor in the ledger itself.
      const oneAfter = withDeviationFloor(
        updateRating(one, [{ opponent: two, score: oneWon ? 1 : 0 }], system),
      );
      const twoAfter = withDeviationFloor(
        updateRating(two, [{ opponent: one, score: oneWon ? 0 : 1 }], system),
      );

      const inserted = await executor
        .insert(ratingEvents)
        .values([
          event(game, game.playerOneId, game.playerTwoId, oneWon ? 1 : 0, one, oneAfter),
          event(game, game.playerTwoId, game.playerOneId, oneWon ? 0 : 1, two, twoAfter),
        ])
        .onConflictDoNothing()
        .returning({ userId: ratingEvents.userId });

      // Never overwrite a newer cached rating when this game was already applied.
      if (inserted.length === 0) {
        return;
      }

      await writeRating(executor, game.playerOneId, oneAfter);
      await writeRating(executor, game.playerTwoId, twoAfter);
    },
  };
}

async function lockRating(executor: DatabaseExecutor, userId: string): Promise<Rating> {
  const [row] = await executor
    .select({
      rating: users.rating,
      deviation: users.ratingDeviation,
      volatility: users.volatility,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .for("update");

  if (row === undefined) {
    throw new Error(`user ${userId} does not exist`);
  }

  return row;
}

async function readDuePeriods(
  executor: DatabaseExecutor,
  userIds: readonly [string, string],
  periodInterval: ReturnType<typeof sql>,
): Promise<ReadonlyMap<string, number>> {
  const rows = await executor
    .select({
      id: users.id,
      // Unrated accounts have no competitive state to decay. This statement
      // begins only after both row locks have been acquired.
      periods: sql<number>`case
        when ${users.ratedGamesPlayed} = 0 then 0
        else greatest(
          0,
          floor(
            extract(epoch from statement_timestamp() - ${users.ratingPeriodAt})
            / extract(epoch from ${periodInterval})
          )
        )::integer
      end`.as("periods"),
    })
    .from(users)
    .where(inArray(users.id, [...userIds]));

  return new Map(rows.map((row) => [row.id, row.periods]));
}

async function writeRating(
  executor: DatabaseExecutor,
  userId: string,
  rating: Rating,
): Promise<void> {
  await executor
    .update(users)
    .set({
      rating: rating.rating,
      ratingDeviation: rating.deviation,
      volatility: rating.volatility,
      // Increment only alongside the ledger insert that applied the game.
      ratedGamesPlayed: sql`${users.ratedGamesPlayed} + 1`,
      // A played result starts a fresh inactivity period.
      ratingPeriodAt: sql`clock_timestamp()`,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(eq(users.id, userId));
}

function event(
  game: FinishedRatedGame,
  userId: string,
  opponentId: string,
  score: number,
  before: Rating,
  after: Rating,
) {
  return {
    gameId: game.gameId,
    userId,
    opponentId,
    score,
    ratingBefore: before.rating,
    ratingDeviationBefore: before.deviation,
    volatilityBefore: before.volatility,
    ratingAfter: after.rating,
    ratingDeviationAfter: after.deviation,
    volatilityAfter: after.volatility,
    // Unlike `now()`, this records the post-lock order of concurrent results.
    createdAt: sql`clock_timestamp()`,
  };
}
