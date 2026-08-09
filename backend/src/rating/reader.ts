import type { RatingChange } from "@poe2/protocol";
import { and, eq, inArray } from "drizzle-orm";

import type { Database } from "../db/client.js";
import { ratingEvents } from "../db/schema.js";

export interface RatingReader {
  /** Omits games that were casual or did not include this player. */
  changesForGames(
    userId: string,
    gameIds: readonly string[],
  ): Promise<ReadonlyMap<string, RatingChange>>;
}

export function createRatingReader(db: Database): RatingReader {
  return {
    async changesForGames(userId, gameIds) {
      if (gameIds.length === 0) {
        return new Map();
      }

      const rows = await db
        .select({
          gameId: ratingEvents.gameId,
          before: ratingEvents.ratingBefore,
          after: ratingEvents.ratingAfter,
        })
        .from(ratingEvents)
        .where(and(eq(ratingEvents.userId, userId), inArray(ratingEvents.gameId, [...gameIds])));

      return new Map(rows.map((row) => [row.gameId, { before: row.before, after: row.after }]));
    },
  };
}
