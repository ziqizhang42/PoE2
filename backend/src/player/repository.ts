import {
  MAX_RATING_HISTORY,
  type PlayerActivity,
  type PlayerDirectoryEntry,
  type PublicPlayerProfile,
  type RatingPoint,
} from "@poe2/protocol";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database, DatabaseExecutor } from "../db/client.js";
import { ratingEvents, users } from "../db/schema.js";

export interface PlayerRepository {
  listDirectory(): Promise<readonly PlayerDirectoryEntry[]>;
  listPlayerActivities(): Promise<readonly PlayerActivityRecord[]>;
  findPublicProfile(normalizedUsername: string): Promise<PublicPlayerProfile | null>;
  findUserIdByUsername(normalizedUsername: string): Promise<string | null>;
}

export interface PlayerActivityRecord {
  readonly id: string;
  readonly activity: PlayerActivity;
}

const INITIAL_RATING = 1500;

const directoryRowSchema = z.strictObject({
  id: z.uuid(),
  username: z.string(),
  rating: z.number().int(),
  colorPercentile: z.number().int().min(0).max(100),
});

const activityRowSchema = z.strictObject({
  id: z.uuid(),
  activity: z.enum(["open_room", "in_game"]),
});

const rowSchema = z.strictObject({
  id: z.uuid(),
  username: z.string(),
  // Raw SQL bypasses Drizzle's timestamptz mapper.
  createdAt: z.coerce.date(),
  ratingValue: z.number().int(),
  ratingDeviation: z.number().int(),
  ratingPercentile: z.union([z.number().int().min(0).max(100), z.null()]),
  totalFinishedGames: z.number().int().min(0),
  wins: z.number().int().min(0),
  losses: z.number().int().min(0),
  ratedWins: z.number().int().min(0),
  ratedLosses: z.number().int().min(0),
  ratedGames: z.number().int().min(0),
  casualGames: z.number().int().min(0),
  boardFullGames: z.number().int().min(0),
  resignationGames: z.number().int().min(0),
  timeoutGames: z.number().int().min(0),
});

/** Builds the newest rating segment from ledger events, oldest point first. */
async function readRatingHistory(
  executor: DatabaseExecutor,
  userId: string,
): Promise<readonly RatingPoint[]> {
  const rows = await executor
    .select({
      at: ratingEvents.createdAt,
      before: ratingEvents.ratingBefore,
      after: ratingEvents.ratingAfter,
    })
    .from(ratingEvents)
    .where(eq(ratingEvents.userId, userId))
    .orderBy(desc(ratingEvents.createdAt))
    .limit(MAX_RATING_HISTORY);

  const oldestFirst = [...rows].reverse();
  const first = oldestFirst[0];
  if (first === undefined) {
    return [];
  }

  return [
    { at: first.at.toISOString(), rating: Math.round(first.before) },
    ...oldestFirst.map((row) => ({ at: row.at.toISOString(), rating: Math.round(row.after) })),
  ];
}

export function createPlayerRepository(db: Database): PlayerRepository {
  return {
    async listDirectory() {
      const rows = await db.execute(sql`
        with rated_population as (
          select
            count(*)::integer as total,
            count(*) filter (where rating < ${INITIAL_RATING})::integer as initial_below
          from users
          where rated_games_played > 0
        ), directory as (
          select
            u.id as "id",
            u.username as "username",
            case
              when u.rated_games_played = 0 then ${INITIAL_RATING}
              else round(u.rating)::integer
            end as "rating",
            case
              when p.total = 0 then 50
              when u.rated_games_played = 0
                then round(100.0 * p.initial_below / p.total)::integer
              else round(100.0 * (
                select count(*)
                from users lower_player
                where lower_player.rated_games_played > 0
                  and lower_player.rating < u.rating
              ) / p.total)::integer
            end as "colorPercentile",
            u.normalized_username as "normalizedUsername"
          from users u
          cross join rated_population p
        )
        select "id", "username", "rating", "colorPercentile"
        from directory
        order by
          "rating" desc,
          "normalizedUsername" collate "C" asc,
          "username" collate "C" asc,
          "id" asc
      `);

      return rows.map((row) => directoryRowSchema.parse(row));
    },

    async listPlayerActivities() {
      const rows = await db.execute(sql`
        with occupied_seats as (
          select player_one_id as id, status::text as status
          from games
          where status in ('waiting', 'ready_check', 'active')
          union all
          select player_two_id as id, status::text as status
          from games
          where status in ('ready_check', 'active') and player_two_id is not null
        )
        select
          id as "id",
          case
            when bool_or(status in ('ready_check', 'active')) then 'in_game'
            else 'open_room'
          end as "activity"
        from occupied_seats
        group by id
        order by id
      `);

      return rows.map((row) => activityRowSchema.parse(row));
    },

    async findPublicProfile(normalizedUsername) {
      return db.transaction(
        async (executor) => {
          // Seat-specific branches use both partial history indexes without deduplication.
          const rows = await executor.execute(sql`
        with target as (
          select id, username, created_at, rating, rating_deviation, rated_games_played
          from users
          where normalized_username = ${normalizedUsername}
          limit 1
        ), rated_population as (
          -- Only players with a rated result belong to the ladder population.
          select
            count(*)::integer as total,
            count(*) filter (where u.rating < (select rating from target))::integer as below
          from users u
          where u.rated_games_played > 0
        ), finished as (
          select g.rated, g.outcome_reason::text as outcome_reason, g.winner, 1::smallint as seat
          from games g
          join target t on g.player_one_id = t.id
          where g.status = 'finished'
          union all
          select g.rated, g.outcome_reason::text as outcome_reason, g.winner, 2::smallint as seat
          from games g
          join target t on g.player_two_id = t.id
          where g.status = 'finished'
        )
        select
          t.id as "id",
          t.username as "username",
          t.created_at as "createdAt",
          round(t.rating)::integer as "ratingValue",
          greatest(1, round(t.rating_deviation)::integer) as "ratingDeviation",
          -- Unrated players are off the ladder, not at its zero percentile.
          case
            when t.rated_games_played = 0 or p.total = 0 then null
            else round(100.0 * p.below / p.total)::integer
          end as "ratingPercentile",
          count(f.seat)::integer as "totalFinishedGames",
          count(f.seat) filter (where f.winner = f.seat)::integer as "wins",
          count(f.seat) filter (where f.winner <> f.seat)::integer as "losses",
          count(f.seat) filter (where f.rated and f.winner = f.seat)::integer as "ratedWins",
          count(f.seat) filter (where f.rated and f.winner <> f.seat)::integer as "ratedLosses",
          count(f.seat) filter (where f.rated)::integer as "ratedGames",
          count(f.seat) filter (where not f.rated)::integer as "casualGames",
          count(f.seat) filter (where f.outcome_reason = 'board_full')::integer as "boardFullGames",
          count(f.seat) filter (where f.outcome_reason = 'resignation')::integer as "resignationGames",
          count(f.seat) filter (where f.outcome_reason = 'timeout')::integer as "timeoutGames"
        from target t
        cross join rated_population p
        left join finished f on true
        group by
          t.id, t.username, t.created_at, t.rating, t.rating_deviation,
          t.rated_games_played, p.total, p.below
          `);

          const candidate = rows[0];
          if (candidate === undefined) {
            return null;
          }

          const row = rowSchema.parse(candidate);
          const ratingHistory = await readRatingHistory(executor, row.id);

          return {
            username: row.username,
            createdAt: row.createdAt.toISOString(),
            rating: {
              value: row.ratingValue,
              deviation: row.ratingDeviation,
              percentile: row.ratingPercentile,
            },
            ratingHistory,
            statistics: {
              totalFinishedGames: row.totalFinishedGames,
              wins: row.wins,
              losses: row.losses,
              ratedWins: row.ratedWins,
              ratedLosses: row.ratedLosses,
              ratedGames: row.ratedGames,
              casualGames: row.casualGames,
              boardFullGames: row.boardFullGames,
              resignationGames: row.resignationGames,
              timeoutGames: row.timeoutGames,
            },
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },

    async findUserIdByUsername(normalizedUsername) {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.normalizedUsername, normalizedUsername))
        .limit(1);

      return rows[0]?.id ?? null;
    },
  };
}
