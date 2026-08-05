import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    username: varchar("username", { length: 32 }).notNull(),
    normalizedUsername: varchar("normalized_username", { length: 32 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("users_normalized_username_unique").on(table.normalizedUsername)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_id_index").on(table.userId),
    index("sessions_expires_at_index").on(table.expiresAt),
  ],
);

export const gameStatus = pgEnum("game_status", ["waiting", "active", "finished"]);

/**
 * A game's authoritative state is its seats plus `game_moves`. The board and
 * the scores are never stored: they are replayed from the move history through
 * `@poe2/rules`, so a client cannot assert a position, and a scoring change
 * cannot leave stale totals behind in the database.
 *
 * Board geometry appears here only as literal bounds. Repeating the numbers is
 * deliberate - a migration is frozen SQL, so it could not track a constant
 * anyway, and importing one would make `drizzle-kit` depend on a built package.
 */
export const games = pgTable(
  "games",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Both seats cascade: a game is meaningless once either participant is
    // gone, and there is no anonymous-player state to preserve.
    playerOneId: uuid("player_one_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playerTwoId: uuid("player_two_id").references(() => users.id, { onDelete: "cascade" }),
    status: gameStatus("status").notNull().default("waiting"),
    revision: integer("revision").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("games_status_created_at_index").on(table.status, table.createdAt),
    index("games_player_one_id_index").on(table.playerOneId),
    index("games_player_two_id_index").on(table.playerTwoId),
    check("games_revision_non_negative", sql`${table.revision} >= 0`),
    check(
      "games_players_distinct",
      sql`${table.playerTwoId} is null or ${table.playerTwoId} <> ${table.playerOneId}`,
    ),
    // The second seat is exactly what separates a lobby from a live game, so
    // an occupied waiting game or an empty active game cannot be written.
    check(
      "games_second_seat_matches_status",
      sql`(${table.status} = 'waiting') = (${table.playerTwoId} is null)`,
    ),
  ],
);

/**
 * The canonical move history. `(game_id, ply)` is the primary key and
 * `(game_id, row, col)` is unique, so two concurrent writers cannot both take
 * the same turn or the same square even if a transaction were to miss the row
 * lock the service takes.
 */
export const gameMoves = pgTable(
  "game_moves",
  {
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    ply: smallint("ply").notNull(),
    row: smallint("row").notNull(),
    col: smallint("col").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.ply] }),
    uniqueIndex("game_moves_square_unique").on(table.gameId, table.row, table.col),
    check("game_moves_ply_range", sql`${table.ply} >= 0 and ${table.ply} < 49`),
    check("game_moves_row_range", sql`${table.row} >= 0 and ${table.row} < 7`),
    check("game_moves_col_range", sql`${table.col} >= 0 and ${table.col} < 7`),
  ],
);
