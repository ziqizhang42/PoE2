import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
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

// Mirrored in frozen migrations and checked against rating/glicko2.ts by tests.
const INITIAL_RATING_VALUE = 1500;
const INITIAL_RATING_DEVIATION = 350;
const INITIAL_VOLATILITY = 0.06;

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    username: varchar("username", { length: 32 }).notNull(),
    normalizedUsername: varchar("normalized_username", { length: 32 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    // Cached ledger head. Decay may widen deviation without creating an event.
    rating: doublePrecision("rating").notNull().default(INITIAL_RATING_VALUE),
    ratingDeviation: doublePrecision("rating_deviation")
      .notNull()
      .default(INITIAL_RATING_DEVIATION),
    volatility: doublePrecision("volatility").notNull().default(INITIAL_VOLATILITY),
    // Explicit ladder membership; deviation can return to its ceiling after decay.
    ratedGamesPlayed: integer("rated_games_played").notNull().default(0),
    // Advancing this boundary by whole periods makes decay idempotent.
    ratingPeriodAt: timestamp("rating_period_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("users_normalized_username_unique").on(table.normalizedUsername),
    // Unrated accounts have nothing to decay or rank.
    index("users_rating_period_index")
      .on(table.ratingPeriodAt)
      .where(sql`${table.ratedGamesPlayed} > 0`),
    index("users_rated_rating_index")
      .on(table.rating)
      .where(sql`${table.ratedGamesPlayed} > 0`),
    check("users_rating_deviation_positive", sql`${table.ratingDeviation} > 0`),
    check("users_volatility_positive", sql`${table.volatility} > 0`),
    check("users_rated_games_played_not_negative", sql`${table.ratedGamesPlayed} >= 0`),
  ],
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

export const gameStatus = pgEnum("game_status", ["waiting", "ready_check", "active", "finished"]);

export const gameOutcomeReason = pgEnum("game_outcome_reason", [
  "board_full",
  "resignation",
  "timeout",
]);

/** Moves are canonical; boards and scores are always derived from them. */
export const games = pgTable(
  "games",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    playerOneId: uuid("player_one_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playerTwoId: uuid("player_two_id").references(() => users.id, { onDelete: "cascade" }),
    status: gameStatus("status").notNull().default("waiting"),
    revision: integer("revision").notNull().default(0),
    rated: boolean("rated").notNull().default(false),
    // Waiting games keep their sole occupant in player_one_id; creatorSeat records
    // the physical seat to use after a join and creatorId survives seat rewrites.
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    creatorSeat: smallint("creator_seat").notNull().default(1),
    playerOneReady: boolean("player_one_ready").notNull().default(false),
    playerTwoReady: boolean("player_two_ready").notNull().default(false),
    readyDeadlineAt: timestamp("ready_deadline_at", { withTimezone: true }),
    // Increments on every join and remains stable for that ready-check cycle.
    readyCheckGeneration: integer("ready_check_generation").notNull().default(0),
    // Turn parity starts here because ready-check revisions occur before play.
    activatedRevision: integer("activated_revision"),
    // Both null means untimed.
    initialTimeMs: integer("initial_time_ms"),
    incrementMs: integer("increment_ms"),
    playerOneRemainingMs: integer("player_one_remaining_ms"),
    playerTwoRemainingMs: integer("player_two_remaining_ms"),
    runningPlayer: smallint("running_player"),
    turnStartedAt: timestamp("turn_started_at", { withTimezone: true }),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    clockStoppedAt: timestamp("clock_stopped_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    // Cursors round-trip through JavaScript Date, whose precision is milliseconds.
    finishedAt: timestamp("finished_at", { withTimezone: true, precision: 3 }),
    outcomeReason: gameOutcomeReason("outcome_reason"),
    winner: smallint("winner"),
  },
  (table) => [
    index("games_status_created_at_index").on(table.status, table.createdAt),
    index("games_player_one_id_index").on(table.playerOneId),
    index("games_creator_id_index").on(table.creatorId),
    index("games_player_two_id_index").on(table.playerTwoId),
    check("games_revision_non_negative", sql`${table.revision} >= 0`),
    check(
      "games_players_distinct",
      sql`${table.playerTwoId} is null or ${table.playerTwoId} <> ${table.playerOneId}`,
    ),
    check(
      "games_second_seat_matches_status",
      sql`(${table.status} = 'waiting') = (${table.playerTwoId} is null)`,
    ),
    // The index, rather than a read-before-write check, closes concurrent creates.
    // It includes ready checks so an expiry can safely return to waiting. Negative
    // status tests avoid consuming a newly added enum value in the migration.
    uniqueIndex("games_one_waiting_lobby_per_owner")
      .on(table.creatorId)
      .where(sql`${table.status} <> 'active' and ${table.status} <> 'finished'`),
    check("games_winner_is_a_seat", sql`${table.winner} is null or ${table.winner} in (1, 2)`),
    check("games_creator_seat_is_a_seat", sql`${table.creatorSeat} in (1, 2)`),
    check(
      "games_creator_holds_their_seat",
      sql`${table.creatorId} = case when ${table.playerTwoId} is null or ${table.creatorSeat} = 1 then ${table.playerOneId} else ${table.playerTwoId} end`,
    ),
    check(
      "games_outcome_matches_status",
      sql`(${table.status} = 'finished') = (${table.finishedAt} is not null and ${table.outcomeReason} is not null and ${table.winner} is not null)`,
    ),
    // Frozen migrations repeat these protocol bounds; integration tests compare them.
    check(
      "games_time_control_configuration",
      sql`(${table.initialTimeMs} is null and ${table.incrementMs} is null)
        or (${table.initialTimeMs} is not null
          and ${table.initialTimeMs} >= 10000
          and ${table.initialTimeMs} <= 10800000
          and mod(${table.initialTimeMs}, 1000) = 0
          and ${table.incrementMs} is not null
          and ${table.incrementMs} >= 0
          and ${table.incrementMs} <= 180000
          and mod(${table.incrementMs}, 1000) = 0)`,
    ),
    check(
      "games_ready_check_state",
      sql`(${table.status}::text = 'ready_check') = (${table.readyDeadlineAt} is not null)
        and (${table.status}::text = 'ready_check' or (not ${table.playerOneReady} and not ${table.playerTwoReady}))
        and not (${table.playerOneReady} and ${table.playerTwoReady})`,
    ),
    check(
      "games_ready_check_generation",
      sql`${table.readyCheckGeneration} >= 0
        and (${table.status}::text <> 'ready_check' or ${table.readyCheckGeneration} > 0)`,
    ),
    check(
      "games_activated_revision",
      sql`(${table.status} in ('active', 'finished')) = (${table.activatedRevision} is not null)
        and (${table.activatedRevision} is null or ${table.activatedRevision} <= ${table.revision})`,
    ),
    check(
      "games_rated_requires_clock",
      sql`not (${table.rated} and ${table.initialTimeMs} is null)`,
    ),
    check(
      "games_clock_state",
      sql`
        (${table.initialTimeMs} is null
          and ${table.playerOneRemainingMs} is null
          and ${table.playerTwoRemainingMs} is null
          and ${table.runningPlayer} is null
          and ${table.turnStartedAt} is null
          and ${table.deadlineAt} is null
          and ${table.clockStoppedAt} is null)
        or
        (${table.initialTimeMs} is not null and (
          (${table.status}::text in ('waiting', 'ready_check')
            and ${table.playerOneRemainingMs} is null
            and ${table.playerTwoRemainingMs} is null
            and ${table.runningPlayer} is null
            and ${table.turnStartedAt} is null
            and ${table.deadlineAt} is null
            and ${table.clockStoppedAt} is null)
          or
          (${table.status} = 'active'
            and ${table.playerOneRemainingMs} is not null
            and ${table.playerOneRemainingMs} > 0
            and ${table.playerTwoRemainingMs} is not null
            and ${table.playerTwoRemainingMs} > 0
            and ${table.runningPlayer} is not null
            and ${table.runningPlayer} in (1, 2)
            and ${table.runningPlayer} = case when mod(${table.revision} - ${table.activatedRevision}, 2) = 0 then 1 else 2 end
            and ${table.turnStartedAt} is not null
            and ${table.deadlineAt} is not null
            and ${table.deadlineAt} = ${table.turnStartedAt} +
              (case when ${table.runningPlayer} = 1 then ${table.playerOneRemainingMs} else ${table.playerTwoRemainingMs} end) * interval '1 millisecond'
            and ${table.clockStoppedAt} is null)
          or
          (${table.status} = 'finished'
            and ${table.playerOneRemainingMs} is not null
            and ${table.playerOneRemainingMs} >= 0
            and ${table.playerTwoRemainingMs} is not null
            and ${table.playerTwoRemainingMs} >= 0
            and ${table.runningPlayer} is null
            and ${table.turnStartedAt} is null
            and ${table.deadlineAt} is null
            and ${table.clockStoppedAt} is not null)
        ))`,
    ),
    check(
      "games_timeout_clock",
      sql`${table.outcomeReason} is distinct from 'timeout' or (${table.initialTimeMs} is not null and ((${table.winner} = 1 and ${table.playerTwoRemainingMs} = 0) or (${table.winner} = 2 and ${table.playerOneRemainingMs} = 0)))`,
    ),
    // Separate seat indexes support the history query's OR predicate.
    index("games_player_one_history_index")
      .on(table.playerOneId, table.finishedAt.desc(), table.id.desc())
      .where(sql`${table.status} = 'finished'`),
    index("games_player_two_history_index")
      .on(table.playerTwoId, table.finishedAt.desc(), table.id.desc())
      .where(sql`${table.status} = 'finished'`),
    index("games_active_deadline_index")
      .on(table.deadlineAt, table.id)
      .where(sql`${table.status} = 'active' and ${table.deadlineAt} is not null`),
    // The state constraint makes a non-null ready deadline equivalent to ready_check;
    // omitting the enum cast keeps this predicate usable by the matching query.
    index("games_ready_deadline_index")
      .on(table.readyDeadlineAt, table.id)
      .where(sql`${table.readyDeadlineAt} is not null`),
  ],
);

/** One immutable before/after rating event per player and game. */
export const ratingEvents = pgTable(
  "rating_events",
  {
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    opponentId: uuid("opponent_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    score: smallint("score").notNull(),
    ratingBefore: doublePrecision("rating_before").notNull(),
    ratingDeviationBefore: doublePrecision("rating_deviation_before").notNull(),
    volatilityBefore: doublePrecision("volatility_before").notNull(),
    ratingAfter: doublePrecision("rating_after").notNull(),
    ratingDeviationAfter: doublePrecision("rating_deviation_after").notNull(),
    volatilityAfter: doublePrecision("volatility_after").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.userId] }),
    index("rating_events_user_created_at_index").on(table.userId, table.createdAt.desc()),
    check("rating_events_score_is_a_result", sql`${table.score} in (0, 1)`),
    check("rating_events_players_distinct", sql`${table.userId} <> ${table.opponentId}`),
  ],
);

/** Primary and unique keys backstop turn and square concurrency. */
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

/** Clock accounting for one accepted canonical move in a timed game. */
export const gameMoveClocks = pgTable(
  "game_move_clocks",
  {
    gameId: uuid("game_id").notNull(),
    ply: smallint("ply").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    elapsedMs: integer("elapsed_ms").notNull(),
    incrementAppliedMs: integer("increment_applied_ms").notNull(),
    playerOneRemainingMs: integer("player_one_remaining_ms").notNull(),
    playerTwoRemainingMs: integer("player_two_remaining_ms").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.ply] }),
    foreignKey({
      columns: [table.gameId, table.ply],
      foreignColumns: [gameMoves.gameId, gameMoves.ply],
      name: "game_move_clocks_move_fk",
    }).onDelete("cascade"),
    check("game_move_clocks_elapsed_non_negative", sql`${table.elapsedMs} >= 0`),
    check("game_move_clocks_increment_non_negative", sql`${table.incrementAppliedMs} >= 0`),
    check(
      "game_move_clocks_balances_non_negative",
      sql`${table.playerOneRemainingMs} >= 0 and ${table.playerTwoRemainingMs} >= 0`,
    ),
  ],
);
