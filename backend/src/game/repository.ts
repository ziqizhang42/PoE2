/**
 * Persistence for games and their canonical move history.
 *
 * Every state change is decided inside a transaction that already holds the
 * game's row lock. `decide` is a pure function of the state as it stands under
 * that lock, so two concurrent commands cannot both observe the same revision
 * and both write: the second waits, then sees the first one's result. The
 * `(game_id, ply)` primary key and the unique square index back that up at the
 * schema level.
 */

import type { AuthUser, GameStatus } from "@poe2/protocol";
import type { Square } from "@poe2/rules";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Database, DatabaseExecutor } from "../db/client.js";
import { gameMoves, games, users } from "../db/schema.js";
import type { StoredGame } from "./snapshot.js";

export type GameChange =
  | { readonly kind: "join"; readonly playerTwoId: string }
  | {
      readonly kind: "move";
      readonly ply: number;
      readonly square: Square;
      /** Whether this move filled the board and ended the game. */
      readonly finished: boolean;
    };

export type GameDecision<TError> =
  | { readonly ok: true; readonly change: GameChange }
  | { readonly ok: false; readonly error: TError };

export type GameRemovalDecision<TError> =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: TError };

export type GameUpdateResult<TError> =
  | { readonly ok: true; readonly game: StoredGame }
  | { readonly ok: false; readonly error: TError };

export interface GameRepository {
  listWaitingGames(): Promise<readonly StoredGame[]>;
  /** Waiting or active games the user holds a seat in; finished ones are excluded. */
  listOpenGamesForUser(userId: string): Promise<readonly StoredGame[]>;
  findGame(gameId: string): Promise<StoredGame | null>;
  createWaitingGame(playerOneId: string): Promise<StoredGame>;
  /**
   * Locks the game, offers it to `decide`, and applies the returned change in
   * the same transaction. A rejected decision writes nothing.
   */
  updateGame<TError>(
    gameId: string,
    decide: (game: StoredGame | null) => GameDecision<TError>,
  ): Promise<GameUpdateResult<TError>>;
  removeGame<TError>(
    gameId: string,
    decide: (game: StoredGame | null) => GameRemovalDecision<TError>,
  ): Promise<GameRemovalDecision<TError>>;
}

const OPEN_STATUSES: readonly GameStatus[] = ["waiting", "active"];

const playerOneUsers = alias(users, "player_one_users");
const playerTwoUsers = alias(users, "player_two_users");

interface GameRow {
  readonly id: string;
  readonly status: GameStatus;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly playerOneId: string;
  readonly playerOneUsername: string;
  readonly playerTwoId: string | null;
  readonly playerTwoUsername: string | null;
}

function selectGames(executor: DatabaseExecutor) {
  return executor
    .select({
      id: games.id,
      status: games.status,
      revision: games.revision,
      createdAt: games.createdAt,
      updatedAt: games.updatedAt,
      playerOneId: playerOneUsers.id,
      playerOneUsername: playerOneUsers.username,
      playerTwoId: playerTwoUsers.id,
      playerTwoUsername: playerTwoUsers.username,
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

function toStoredGame(row: GameRow, moves: readonly Square[]): StoredGame {
  const playerTwo: AuthUser | null =
    row.playerTwoId === null || row.playerTwoUsername === null
      ? null
      : { id: row.playerTwoId, username: row.playerTwoUsername };

  return {
    id: row.id,
    playerOne: { id: row.playerOneId, username: row.playerOneUsername },
    playerTwo,
    status: row.status,
    revision: row.revision,
    moves,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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

  return rows.map((row) => toStoredGame(row, movesByGame.get(row.id) ?? []));
}

async function loadGame(executor: DatabaseExecutor, gameId: string): Promise<StoredGame | null> {
  const rows = await selectGames(executor).where(eq(games.id, gameId)).limit(1);
  const [stored] = await withMoves(executor, rows);

  return stored ?? null;
}

/**
 * Takes the game's row lock without joining anything else, so no user row is
 * locked as a side effect. The full state is read afterwards, inside the same
 * transaction.
 */
async function lockGame(executor: DatabaseExecutor, gameId: string): Promise<boolean> {
  const rows = await executor
    .select({ id: games.id })
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1)
    .for("update");

  return rows.length > 0;
}

export function createGameRepository(db: Database): GameRepository {
  async function applyChange(
    executor: DatabaseExecutor,
    game: StoredGame,
    change: GameChange,
  ): Promise<void> {
    if (change.kind === "join") {
      await executor
        .update(games)
        .set({
          playerTwoId: change.playerTwoId,
          status: "active",
          revision: game.revision + 1,
          updatedAt: sql`now()`,
        })
        .where(eq(games.id, game.id));
      return;
    }

    await executor.insert(gameMoves).values({
      gameId: game.id,
      ply: change.ply,
      row: change.square.row,
      col: change.square.col,
    });

    await executor
      .update(games)
      .set({
        status: change.finished ? "finished" : "active",
        revision: game.revision + 1,
        updatedAt: sql`now()`,
      })
      .where(eq(games.id, game.id));
  }

  return {
    async listWaitingGames() {
      const rows = await selectGames(db)
        .where(eq(games.status, "waiting"))
        .orderBy(asc(games.createdAt), asc(games.id));

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

    findGame: (gameId) => loadGame(db, gameId),

    async createWaitingGame(playerOneId) {
      const [created] = await db.insert(games).values({ playerOneId }).returning({ id: games.id });

      if (created === undefined) {
        throw new Error("inserting a waiting game returned no row");
      }

      const stored = await loadGame(db, created.id);
      if (stored === null) {
        throw new Error(`game ${created.id} disappeared immediately after creation`);
      }

      return stored;
    },

    updateGame(gameId, decide) {
      return db.transaction(async (transaction) => {
        const exists = await lockGame(transaction, gameId);
        const stored = exists ? await loadGame(transaction, gameId) : null;
        const decision = decide(stored);

        if (!decision.ok) {
          return { ok: false, error: decision.error };
        }
        if (stored === null) {
          throw new Error(`game ${gameId} was accepted for update but does not exist`);
        }

        await applyChange(transaction, stored, decision.change);

        const updated = await loadGame(transaction, gameId);
        if (updated === null) {
          throw new Error(`game ${gameId} disappeared while being updated`);
        }

        return { ok: true, game: updated };
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
