/** Serializes each decision under the game's row lock. */

import {
  UNTIMED,
  type AuthUser,
  type GameOutcomeReason,
  type GameStatus,
  type TimeControl,
} from "@poe2/protocol";
import { PLAYER_ONE, PLAYER_TWO, type Player, type Square } from "@poe2/rules";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Database, DatabaseExecutor } from "../db/client.js";
import { gameMoveClocks, gameMoves, games, users } from "../db/schema.js";
import type { StoredClock, StoredGame, StoredMoveClock, StoredReadyCheck } from "./snapshot.js";

const LOBBY_PAGE_LIMIT = 100;

const WAITING_LOBBY_CONSTRAINT = "games_one_waiting_lobby_per_owner";
const UNIQUE_VIOLATION = "23505";

/** Matches only the expected constraint through Drizzle's wrapped error chain. */
function isWaitingLobbyConflict(error: unknown): boolean {
  for (let current: unknown = error; current !== null && current !== undefined;) {
    if (typeof current !== "object") {
      return false;
    }

    const candidate = current as {
      readonly code?: unknown;
      readonly constraint_name?: unknown;
      readonly cause?: unknown;
    };

    if (
      candidate.code === UNIQUE_VIOLATION &&
      candidate.constraint_name === WAITING_LOBBY_CONSTRAINT
    ) {
      return true;
    }

    current = candidate.cause;
  }

  return false;
}

export interface HistoryPageRequest {
  readonly limit: number;
  /** Read strictly before this stable `(finishedAt, id)` position. */
  readonly before: { readonly finishedAt: Date; readonly id: string } | null;
}

export type CreateWaitingGameResult =
  | { readonly ok: true; readonly game: StoredGame }
  | { readonly ok: false; readonly reason: "lobby_already_open" };

/** `finishedAt` is assigned from the database clock during persistence. */
export interface GameFinish {
  readonly reason: GameOutcomeReason;
  readonly winner: Player;
}

export interface ClockTransition {
  readonly playerOneRemainingMs: number;
  readonly playerTwoRemainingMs: number;
  readonly runningPlayer: Player | null;
  readonly turnStartedAt: Date | null;
  readonly deadline: Date | null;
  readonly stoppedAt: Date | null;
}

export interface AcceptedMoveClock extends ClockTransition {
  readonly acceptedAt: Date;
  readonly elapsedMs: number;
  readonly incrementAppliedMs: number;
}

export type GameChange =
  | {
      readonly kind: "join";
      readonly playerTwoId: string;
      readonly readyDeadline: Date;
    }
  | {
      readonly kind: "ready";
      readonly seat: Player;
    }
  | {
      readonly kind: "start";
      readonly seat: Player;
      readonly clock: ClockTransition | null;
    }
  | {
      readonly kind: "abandon_ready";
    }
  | {
      readonly kind: "move";
      readonly ply: number;
      readonly square: Square;
      readonly finished: GameFinish | null;
      readonly clock: AcceptedMoveClock | null;
    }
  | {
      readonly kind: "resign";
      readonly finished: GameFinish;
      readonly clock: ClockTransition | null;
    }
  | {
      readonly kind: "timeout";
      readonly finished: GameFinish & { readonly reason: "timeout" };
      readonly clock: ClockTransition;
    };

export type GameDecision<TError> =
  | { readonly ok: true; readonly change: GameChange | null }
  | { readonly ok: false; readonly error: TError; readonly change?: GameChange };

export type GameRemovalDecision<TError> =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: TError };

export type GameUpdateResult<TError> =
  | { readonly ok: true; readonly game: StoredGame; readonly changed: boolean }
  | { readonly ok: false; readonly error: TError; readonly committedGame?: StoredGame };

export interface ActiveGameDeadline {
  readonly gameId: string;
  readonly deadline: Date;
  readonly serverNow: Date;
}

export interface GameRepository {
  /** The newest waiting lobbies, capped so new rooms remain discoverable. */
  listWaitingGames(): Promise<readonly StoredGame[]>;
  listOpenGamesForUser(userId: string): Promise<readonly StoredGame[]>;
  /** Finished games newest first, using keyset pagination. */
  listFinishedGamesForUser(
    userId: string,
    page: HistoryPageRequest,
  ): Promise<readonly StoredGame[]>;
  findGame(gameId: string): Promise<StoredGame | null>;
  /** Ready-check and move deadlines, earliest first. */
  listPendingDeadlines(limit: number): Promise<readonly ActiveGameDeadline[]>;
  createWaitingGame(
    creatorId: string,
    rated: boolean,
    timeControl: TimeControl,
    creatorSeat: Player,
  ): Promise<CreateWaitingGameResult>;
  /** Applies `decide` under a row lock; a rejection without a change writes nothing. */
  updateGame<TError>(
    gameId: string,
    decide: (game: StoredGame | null, decisionAt: Date) => GameDecision<TError>,
  ): Promise<GameUpdateResult<TError>>;
  removeGame<TError>(
    gameId: string,
    decide: (game: StoredGame | null) => GameRemovalDecision<TError>,
  ): Promise<GameRemovalDecision<TError>>;
}

const OPEN_STATUSES: readonly GameStatus[] = ["waiting", "ready_check", "active"];

const playerOneUsers = alias(users, "player_one_users");
const playerTwoUsers = alias(users, "player_two_users");

function databaseNow() {
  return sql<Date>`date_trunc('milliseconds', clock_timestamp())`.mapWith(games.createdAt);
}

interface GameRow {
  readonly id: string;
  readonly status: GameStatus;
  readonly revision: number;
  readonly rated: boolean;
  readonly playerOneReady: boolean;
  readonly playerTwoReady: boolean;
  readonly readyDeadlineAt: Date | null;
  readonly readyCheckGeneration: number;
  readonly activatedRevision: number | null;
  readonly initialTimeMs: number | null;
  readonly incrementMs: number | null;
  readonly playerOneRemainingMs: number | null;
  readonly playerTwoRemainingMs: number | null;
  readonly runningPlayer: number | null;
  readonly turnStartedAt: Date | null;
  readonly deadlineAt: Date | null;
  readonly clockStoppedAt: Date | null;
  readonly serverNow: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly playerOneId: string;
  readonly playerOneUsername: string;
  readonly playerTwoId: string | null;
  readonly playerTwoUsername: string | null;
  readonly creatorId: string;
  readonly creatorSeat: number;
  readonly finishedAt: Date | null;
  readonly outcomeReason: GameOutcomeReason | null;
  readonly winner: number | null;
}

function toSeat(winner: number): Player {
  if (winner !== PLAYER_ONE && winner !== PLAYER_TWO) {
    throw new Error(`stored winner ${String(winner)} is not a seat`);
  }

  return winner;
}

function selectGames(executor: DatabaseExecutor) {
  return executor
    .select({
      id: games.id,
      status: games.status,
      revision: games.revision,
      rated: games.rated,
      playerOneReady: games.playerOneReady,
      playerTwoReady: games.playerTwoReady,
      readyDeadlineAt: games.readyDeadlineAt,
      readyCheckGeneration: games.readyCheckGeneration,
      activatedRevision: games.activatedRevision,
      initialTimeMs: games.initialTimeMs,
      incrementMs: games.incrementMs,
      playerOneRemainingMs: games.playerOneRemainingMs,
      playerTwoRemainingMs: games.playerTwoRemainingMs,
      runningPlayer: games.runningPlayer,
      turnStartedAt: games.turnStartedAt,
      deadlineAt: games.deadlineAt,
      clockStoppedAt: games.clockStoppedAt,
      serverNow: databaseNow(),
      createdAt: games.createdAt,
      updatedAt: games.updatedAt,
      playerOneId: playerOneUsers.id,
      playerOneUsername: playerOneUsers.username,
      playerTwoId: playerTwoUsers.id,
      playerTwoUsername: playerTwoUsers.username,
      creatorId: games.creatorId,
      creatorSeat: games.creatorSeat,
      finishedAt: games.finishedAt,
      outcomeReason: games.outcomeReason,
      winner: games.winner,
    })
    .from(games)
    .innerJoin(playerOneUsers, eq(playerOneUsers.id, games.playerOneId))
    .leftJoin(playerTwoUsers, eq(playerTwoUsers.id, games.playerTwoId));
}

async function loadMovesByGame(
  executor: DatabaseExecutor,
  gameIds: readonly string[],
): Promise<Map<string, Square[]>> {
  const movesByGame = new Map<string, Square[]>();
  if (gameIds.length === 0) {
    return movesByGame;
  }

  const rows = await executor
    .select({ gameId: gameMoves.gameId, row: gameMoves.row, col: gameMoves.col })
    .from(gameMoves)
    .where(inArray(gameMoves.gameId, [...gameIds]))
    .orderBy(asc(gameMoves.gameId), asc(gameMoves.ply));

  for (const move of rows) {
    const moves = movesByGame.get(move.gameId) ?? [];
    moves.push({ row: move.row, col: move.col });
    movesByGame.set(move.gameId, moves);
  }

  return movesByGame;
}

async function loadMoveClocksByGame(
  executor: DatabaseExecutor,
  gameIds: readonly string[],
): Promise<Map<string, StoredMoveClock[]>> {
  const clocksByGame = new Map<string, StoredMoveClock[]>();
  if (gameIds.length === 0) {
    return clocksByGame;
  }

  const rows = await executor
    .select({
      gameId: gameMoveClocks.gameId,
      ply: gameMoveClocks.ply,
      acceptedAt: gameMoveClocks.acceptedAt,
      elapsedMs: gameMoveClocks.elapsedMs,
      incrementAppliedMs: gameMoveClocks.incrementAppliedMs,
      playerOneRemainingMs: gameMoveClocks.playerOneRemainingMs,
      playerTwoRemainingMs: gameMoveClocks.playerTwoRemainingMs,
    })
    .from(gameMoveClocks)
    .where(inArray(gameMoveClocks.gameId, [...gameIds]))
    .orderBy(asc(gameMoveClocks.gameId), asc(gameMoveClocks.ply));

  for (const row of rows) {
    const clocks = clocksByGame.get(row.gameId) ?? [];
    clocks.push({
      ply: row.ply,
      acceptedAt: row.acceptedAt,
      elapsedMs: row.elapsedMs,
      incrementAppliedMs: row.incrementAppliedMs,
      playerOneRemainingMs: row.playerOneRemainingMs,
      playerTwoRemainingMs: row.playerTwoRemainingMs,
    });
    clocksByGame.set(row.gameId, clocks);
  }

  return clocksByGame;
}

function toTimeControl(row: GameRow): TimeControl {
  if (row.initialTimeMs === null && row.incrementMs === null) {
    return UNTIMED;
  }

  if (row.initialTimeMs === null || row.incrementMs === null) {
    throw new Error(`stored game ${row.id} has half a time control`);
  }

  return {
    kind: "timed",
    initialMs: row.initialTimeMs,
    incrementMs: row.incrementMs,
  };
}

function toReadyCheck(row: GameRow): StoredReadyCheck | null {
  if (row.status !== "ready_check") {
    return null;
  }
  if (row.readyDeadlineAt === null) {
    throw new Error(`ready check for game ${row.id} has no deadline`);
  }

  return {
    generation: row.readyCheckGeneration,
    playerOneReady: row.playerOneReady,
    playerTwoReady: row.playerTwoReady,
    deadline: row.readyDeadlineAt,
  };
}

function toClock(row: GameRow): StoredClock | null {
  const noBalances = row.playerOneRemainingMs === null || row.playerTwoRemainingMs === null;

  if (row.status === "active") {
    if (
      noBalances ||
      row.runningPlayer === null ||
      row.turnStartedAt === null ||
      row.deadlineAt === null
    ) {
      return null;
    }

    return {
      state: "running",
      playerOneRemainingMs: row.playerOneRemainingMs,
      playerTwoRemainingMs: row.playerTwoRemainingMs,
      runningPlayer: toSeat(row.runningPlayer),
      turnStartedAt: row.turnStartedAt,
      deadline: row.deadlineAt,
    };
  }

  if (row.status === "finished") {
    if (noBalances || row.clockStoppedAt === null) {
      return null;
    }

    return {
      state: "stopped",
      playerOneRemainingMs: row.playerOneRemainingMs,
      playerTwoRemainingMs: row.playerTwoRemainingMs,
      stoppedAt: row.clockStoppedAt,
    };
  }

  return null;
}

function toStoredGame(
  row: GameRow,
  moves: readonly Square[],
  moveClocks: readonly StoredMoveClock[],
): StoredGame {
  const playerTwo: AuthUser | null =
    row.playerTwoId === null || row.playerTwoUsername === null
      ? null
      : { id: row.playerTwoId, username: row.playerTwoUsername };

  const outcome =
    row.finishedAt === null || row.outcomeReason === null || row.winner === null
      ? null
      : { reason: row.outcomeReason, winner: toSeat(row.winner), finishedAt: row.finishedAt };

  return {
    id: row.id,
    playerOne: { id: row.playerOneId, username: row.playerOneUsername },
    playerTwo,
    creatorId: row.creatorId,
    creatorSeat: toSeat(row.creatorSeat),
    status: row.status,
    revision: row.revision,
    rated: row.rated,
    timeControl: toTimeControl(row),
    readyCheckGeneration: row.readyCheckGeneration,
    readyCheck: toReadyCheck(row),
    activatedRevision: row.activatedRevision,
    clock: toClock(row),
    moveClocks,
    serverNow: row.serverNow,
    moves,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    outcome,
  };
}

async function withMoves(
  executor: DatabaseExecutor,
  rows: readonly GameRow[],
): Promise<readonly StoredGame[]> {
  const movesByGame = await loadMovesByGame(
    executor,
    rows.map((row) => row.id),
  );
  const clocksByGame = await loadMoveClocksByGame(
    executor,
    rows.map((row) => row.id),
  );

  return rows.map((row) =>
    toStoredGame(row, movesByGame.get(row.id) ?? [], clocksByGame.get(row.id) ?? []),
  );
}

async function loadGame(executor: DatabaseExecutor, gameId: string): Promise<StoredGame | null> {
  const rows = await selectGames(executor).where(eq(games.id, gameId)).limit(1);
  const [stored] = await withMoves(executor, rows);

  return stored ?? null;
}

/** Locks only the game row; joined state is loaded afterwards in the transaction. */
async function lockGame(executor: DatabaseExecutor, gameId: string): Promise<boolean> {
  const rows = await executor
    .select({ id: games.id })
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1)
    .for("update");

  return rows.length > 0;
}

export interface GameRepositoryOptions {
  readonly readDecisionAt?: (executor: DatabaseExecutor) => Promise<Date>;
  /** Runs before commit so finish side effects, such as rating, stay atomic. */
  readonly onGameFinished?: (
    executor: DatabaseExecutor,
    game: StoredGame,
    finish: GameFinish,
  ) => Promise<void>;
}

export function createGameRepository(
  db: Database,
  options: GameRepositoryOptions = {},
): GameRepository {
  const readDecisionAt = options.readDecisionAt ?? readDatabaseNow;

  async function applyChange(
    executor: DatabaseExecutor,
    game: StoredGame,
    change: GameChange,
  ): Promise<void> {
    if (change.kind === "join") {
      // Waiting games store their owner in player one; joining settles physical seats.
      const seats =
        game.creatorSeat === PLAYER_ONE
          ? { playerOneId: game.playerOne.id, playerTwoId: change.playerTwoId }
          : { playerOneId: change.playerTwoId, playerTwoId: game.playerOne.id };

      await executor
        .update(games)
        .set({
          ...seats,
          status: "ready_check",
          revision: game.revision + 1,
          readyDeadlineAt: change.readyDeadline,
          readyCheckGeneration: game.readyCheckGeneration + 1,
          playerOneReady: false,
          playerTwoReady: false,
          updatedAt: sql`now()`,
        })
        .where(eq(games.id, game.id));
      return;
    }

    if (change.kind === "ready") {
      await executor
        .update(games)
        .set({
          revision: game.revision + 1,
          ...(change.seat === PLAYER_ONE ? { playerOneReady: true } : { playerTwoReady: true }),
          updatedAt: sql`now()`,
        })
        .where(eq(games.id, game.id));
      return;
    }

    if (change.kind === "start") {
      const revision = game.revision + 1;
      await executor
        .update(games)
        .set({
          status: "active",
          revision,
          playerOneReady: false,
          playerTwoReady: false,
          readyDeadlineAt: null,
          activatedRevision: revision,
          updatedAt: sql`now()`,
          ...(change.clock === null ? {} : clockColumns(change.clock)),
        })
        .where(eq(games.id, game.id));
      return;
    }

    if (change.kind === "abandon_ready") {
      await executor
        .update(games)
        .set({
          // Restore the waiting representation regardless of the creator's chosen seat.
          playerOneId: game.creatorId,
          playerTwoId: null,
          status: "waiting",
          revision: game.revision + 1,
          readyDeadlineAt: null,
          playerOneReady: false,
          playerTwoReady: false,
          updatedAt: sql`now()`,
        })
        .where(eq(games.id, game.id));
      return;
    }

    if (change.kind === "move") {
      await executor.insert(gameMoves).values({
        gameId: game.id,
        ply: change.ply,
        row: change.square.row,
        col: change.square.col,
      });

      if (change.clock !== null) {
        await executor.insert(gameMoveClocks).values({
          gameId: game.id,
          ply: change.ply,
          acceptedAt: change.clock.acceptedAt,
          elapsedMs: change.clock.elapsedMs,
          incrementAppliedMs: change.clock.incrementAppliedMs,
          playerOneRemainingMs: change.clock.playerOneRemainingMs,
          playerTwoRemainingMs: change.clock.playerTwoRemainingMs,
        });
      }
    }

    const finish = change.finished;

    // Take the finish timestamp after rating locks so history and ledger order agree.
    if (finish !== null) {
      await options.onGameFinished?.(executor, game, finish);
    }

    await executor
      .update(games)
      .set({
        status: finish === null ? "active" : "finished",
        revision: game.revision + 1,
        updatedAt: sql`now()`,
        ...(change.clock === null ? {} : clockColumns(change.clock)),
        // The outcome constraint requires these fields to move together.
        ...(finish === null
          ? {}
          : {
              status: "finished" as const,
              // History cursors pass through JavaScript Date, so persist the
              // same millisecond precision before this value can become a key.
              finishedAt: databaseNow(),
              outcomeReason: finish.reason,
              winner: finish.winner,
            }),
      })
      .where(eq(games.id, game.id));
  }

  return {
    async listWaitingGames() {
      const rows = await selectGames(db)
        .where(eq(games.status, "waiting"))
        .orderBy(desc(games.createdAt), desc(games.id))
        .limit(LOBBY_PAGE_LIMIT);

      return withMoves(db, rows);
    },

    async listOpenGamesForUser(userId) {
      const rows = await selectGames(db)
        .where(
          and(
            inArray(games.status, [...OPEN_STATUSES]),
            or(eq(games.playerOneId, userId), eq(games.playerTwoId, userId)),
          ),
        )
        .orderBy(asc(games.createdAt), asc(games.id));

      return withMoves(db, rows);
    },

    async listFinishedGamesForUser(userId, page) {
      const seat = or(eq(games.playerOneId, userId), eq(games.playerTwoId, userId));
      const before = page.before;

      const rows = await selectGames(db)
        .where(
          before === null
            ? and(eq(games.status, "finished"), seat)
            : and(
                eq(games.status, "finished"),
                seat,
                // Explicit casts give the raw row constructor parameter types.
                sql`(${games.finishedAt}, ${games.id}) < (${before.finishedAt.toISOString()}::timestamptz, ${before.id}::uuid)`,
              ),
        )
        .orderBy(desc(games.finishedAt), desc(games.id))
        .limit(page.limit);

      return withMoves(db, rows);
    },

    findGame: (gameId) => loadGame(db, gameId),

    async listPendingDeadlines(limit) {
      // The state constraints make at most one deadline non-null.
      const pending = sql<Date>`coalesce(${games.deadlineAt}, ${games.readyDeadlineAt})`.mapWith(
        games.createdAt,
      );

      return db
        .select({ gameId: games.id, deadline: pending, serverNow: databaseNow() })
        .from(games)
        .where(
          or(
            and(eq(games.status, "active"), sql`${games.deadlineAt} is not null`),
            // Kept identical to the partial-index predicate.
            sql`${games.readyDeadlineAt} is not null`,
          ),
        )
        .orderBy(asc(pending), asc(games.id))
        .limit(limit)
        .then((rows) =>
          rows.map((row) => ({
            gameId: row.gameId,
            deadline: row.deadline,
            serverNow: row.serverNow,
          })),
        );
    },

    async createWaitingGame(creatorId, rated, timeControl, creatorSeat) {
      let created: { readonly id: string } | undefined;

      try {
        [created] = await db
          .insert(games)
          .values({
            playerOneId: creatorId,
            creatorId,
            creatorSeat,
            rated,
            initialTimeMs: timeControl.initialMs,
            incrementMs: timeControl.incrementMs,
          })
          .returning({ id: games.id });
      } catch (error: unknown) {
        if (isWaitingLobbyConflict(error)) {
          return { ok: false, reason: "lobby_already_open" };
        }

        throw error;
      }

      if (created === undefined) {
        throw new Error("inserting a waiting game returned no row");
      }

      const stored = await loadGame(db, created.id);
      if (stored === null) {
        throw new Error(`game ${created.id} disappeared immediately after creation`);
      }

      return { ok: true, game: stored };
    },

    updateGame(gameId, decide) {
      return db.transaction(async (transaction) => {
        const exists = await lockGame(transaction, gameId);
        const stored = exists ? await loadGame(transaction, gameId) : null;
        const decisionAt = await readDecisionAt(transaction);
        const decision = decide(stored, decisionAt);

        if (!decision.ok && decision.change === undefined) {
          return { ok: false, error: decision.error };
        }
        if (stored === null) {
          throw new Error(`game ${gameId} was accepted for update but does not exist`);
        }

        const change = decision.change;
        if (change !== null && change !== undefined) {
          await applyChange(transaction, stored, change);
        }

        const reloaded = await loadGame(transaction, gameId);
        if (reloaded === null) {
          throw new Error(`game ${gameId} disappeared while being updated`);
        }
        // Keep the snapshot anchored to the decision instant sampled under the lock.
        const updated: StoredGame = { ...reloaded, serverNow: decisionAt };

        if (!decision.ok) {
          return { ok: false, error: decision.error, committedGame: updated };
        }

        return { ok: true, game: updated, changed: change !== null };
      });
    },

    removeGame(gameId, decide) {
      return db.transaction(async (transaction) => {
        const exists = await lockGame(transaction, gameId);
        const stored = exists ? await loadGame(transaction, gameId) : null;
        const decision = decide(stored);

        if (!decision.ok) {
          return decision;
        }

        await transaction.delete(games).where(eq(games.id, gameId));
        return { ok: true };
      });
    },
  };
}

function clockColumns(clock: ClockTransition) {
  return {
    playerOneRemainingMs: clock.playerOneRemainingMs,
    playerTwoRemainingMs: clock.playerTwoRemainingMs,
    runningPlayer: clock.runningPlayer,
    turnStartedAt: clock.turnStartedAt,
    deadlineAt: clock.deadline,
    clockStoppedAt: clock.stoppedAt,
  };
}

async function readDatabaseNow(executor: DatabaseExecutor): Promise<Date> {
  // Raw timestamptz expressions may bypass the column mapper and arrive as strings.
  const rows = await executor.execute(
    sql`select date_trunc('milliseconds', clock_timestamp()) as "decisionAt"`,
  );
  const value = (rows[0] as { readonly decisionAt?: unknown } | undefined)?.decisionAt;

  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string") {
    const decoded = new Date(value);
    if (!Number.isNaN(decoded.getTime())) {
      return decoded;
    }
  }

  if (value === undefined) {
    throw new Error("database clock did not return a timestamp");
  }

  throw new Error("database clock returned an invalid timestamp");
}
