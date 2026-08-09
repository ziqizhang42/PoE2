/**
 * Applies every whole inactive rating period and advances the stored boundary by
 * that exact amount. This makes passes idempotent, preserves partial periods, and
 * catches up after downtime. Each player is re-read and locked in its own
 * transaction so a concurrent game result cannot be overwritten.
 */

import { and, asc, eq, gt, lte, sql } from "drizzle-orm";

import type { Database } from "../db/client.js";
import { users } from "../db/schema.js";
import { MAX_DEVIATION, withDeviationCeiling } from "./bounds.js";
import { skippedPeriod, type GlickoSystem, type Rating } from "./glicko2.js";

export interface RatingDecayOptions {
  readonly periodMs: number;
  readonly batchSize: number;
  readonly system?: GlickoSystem;
}

export interface RatingDecayPass {
  readonly decayed: number;
  readonly more: boolean;
}

export interface RatingDecay {
  runOnce(): Promise<RatingDecayPass>;
}

/** Iteration remains correct if skipped periods later update volatility too. */
export function afterUnplayedPeriods(
  rating: Rating,
  periods: number,
  system: GlickoSystem | undefined,
): Rating {
  if (periods === 0) {
    return rating;
  }

  let decayed = rating;
  for (let period = 0; period < periods; period += 1) {
    decayed = skippedPeriod(decayed, system);

    // Stop once further inactive periods cannot change the stored deviation.
    if (decayed.deviation >= MAX_DEVIATION) {
      break;
    }
  }

  return withDeviationCeiling(decayed);
}

export function createRatingDecay(db: Database, options: RatingDecayOptions): RatingDecay {
  const { periodMs, batchSize, system } = options;

  if (!Number.isFinite(periodMs) || periodMs <= 0) {
    throw new Error("a rating period must be a positive duration");
  }
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error("a decay batch must hold at least one player");
  }

  const periodInterval = sql`make_interval(secs => ${periodMs / 1000})`;

  return {
    async runOnce() {
      // Stable bounded batches keep a pass from monopolizing the database.
      const due = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            gt(users.ratedGamesPlayed, 0),
            lte(users.ratingPeriodAt, sql`now() - ${periodInterval}`),
          ),
        )
        .orderBy(asc(users.id))
        .limit(batchSize);

      let decayed = 0;

      for (const { id } of due) {
        if (await decayOne(db, id, periodInterval, system)) {
          decayed += 1;
        }
      }

      return { decayed, more: due.length === batchSize };
    },
  };
}

async function decayOne(
  db: Database,
  userId: string,
  periodInterval: ReturnType<typeof sql>,
  system: GlickoSystem | undefined,
): Promise<boolean> {
  return db.transaction(async (executor) => {
    // Recheck under lock because a game may have reset the boundary after the scan.
    const [row] = await executor
      .select({
        rating: users.rating,
        deviation: users.ratingDeviation,
        volatility: users.volatility,
        periods: sql<number>`floor(
          extract(epoch from now() - ${users.ratingPeriodAt})
          / extract(epoch from ${periodInterval})
        )::integer`.as("periods"),
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .for("update");

    if (row === undefined || row.periods < 1) {
      return false;
    }

    const decayed = afterUnplayedPeriods(row, row.periods, system);

    await executor
      .update(users)
      .set({
        // Absence changes confidence, not the rating estimate.
        ratingDeviation: decayed.deviation,
        // Preserve the elapsed fraction of the next period.
        ratingPeriodAt: sql`${users.ratingPeriodAt} + ${row.periods} * ${periodInterval}`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(eq(users.id, userId));

    return true;
  });
}
