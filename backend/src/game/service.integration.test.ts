import type { AuthUser, GameSnapshot } from "@poe2/protocol";
import { GameSnapshotSchema } from "@poe2/protocol";
import { allSquares, CELL_COUNT, gameResult, replay, scoreBoard, type Square } from "@poe2/rules";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { normalizeUsername } from "../auth/username.js";
import { readDatabaseConfig } from "../config/database.js";
import { createDatabaseClient } from "../db/client.js";
import { gameMoves, games, users } from "../db/schema.js";
import { createGameRepository } from "./repository.js";
import { createGameService } from "./service.js";

const PASSWORD_HASH = "$argon2id$test";
const MISSING_GAME_ID = "9a3c9f5e-1f2b-4c3d-8e7f-0a1b2c3d4e5f";

const database = createDatabaseClient(readDatabaseConfig(process.env));
const repository = createGameRepository(database.db);
const service = createGameService(repository);

let alice: AuthUser;
let bob: AuthUser;
let carol: AuthUser;

// Users cascade to games, which cascade to moves, so one delete clears everything.
beforeEach(async () => {
  await database.db.delete(users);
  [alice, bob, carol] = await Promise.all([seedUser("Alice"), seedUser("Bob"), seedUser("Carol")]);
});

afterAll(() => database.close());

async function seedUser(username: string): Promise<AuthUser> {
  const [user] = await database.db
    .insert(users)
    .values({
      username,
      normalizedUsername: normalizeUsername(username),
      passwordHash: PASSWORD_HASH,
    })
    .returning({ id: users.id, username: users.username });

  if (user === undefined) {
    throw new Error(`expected ${username} to be created`);
  }

  return user;
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; code: string }): T {
  if (!result.ok) {
    throw new Error(`expected the operation to succeed, got ${result.code}`);
  }

  return result.value;
}

/** A waiting lobby opened by `owner`. */
async function openLobby(owner: AuthUser): Promise<GameSnapshot> {
  return unwrap(await service.createGame(owner.id));
}

/** An active game with `owner` as Player 1 and `opponent` as Player 2. */
async function startGame(owner: AuthUser, opponent: AuthUser): Promise<GameSnapshot> {
  const lobby = await openLobby(owner);
  return unwrap(await service.joinGame({ actorId: opponent.id, gameId: lobby.id }));
}

async function storedMoves(gameId: string): Promise<readonly Square[]> {
  const rows = await database.db
    .select({ ply: gameMoves.ply, row: gameMoves.row, col: gameMoves.col })
    .from(gameMoves)
    .where(eq(gameMoves.gameId, gameId))
    .orderBy(asc(gameMoves.ply));

  expect(rows.map((move) => move.ply)).toEqual(rows.map((_move, index) => index));

  return rows.map((move) => ({ row: move.row, col: move.col }));
}

async function storedGameRow(gameId: string) {
  const [row] = await database.db
    .select({
      status: games.status,
      revision: games.revision,
      playerTwoId: games.playerTwoId,
      updatedAt: games.updatedAt,
    })
    .from(games)
    .where(eq(games.id, gameId));

  return row;
}

describe("creating and listing lobbies", () => {
  it("stores a waiting game at revision 0 with only the creator seated", async () => {
    const lobby = await openLobby(alice);

    expect(GameSnapshotSchema.safeParse(lobby).success).toBe(true);
    expect(lobby).toMatchObject({
      status: "waiting",
      revision: 0,
      players: { playerOne: alice, playerTwo: null },
      sideToMove: null,
      result: null,
      moves: [],
    });

    expect(await storedGameRow(lobby.id)).toMatchObject({
      status: "waiting",
      revision: 0,
      playerTwoId: null,
    });
  });

  it("lists every waiting lobby, oldest first, and drops them once joined", async () => {
    const first = await openLobby(alice);
    const second = await openLobby(bob);

    expect((await service.listWaitingLobbies()).map((entry) => entry.id)).toEqual([
      first.id,
      second.id,
    ]);

    await service.joinGame({ actorId: carol.id, gameId: first.id });

    expect((await service.listWaitingLobbies()).map((entry) => entry.id)).toEqual([second.id]);
  });
});

describe("joining", () => {
  it("seats the joiner, activates the game, and bumps the revision once", async () => {
    const lobby = await openLobby(alice);
    const joined = unwrap(await service.joinGame({ actorId: bob.id, gameId: lobby.id }));

    expect(joined).toMatchObject({
      id: lobby.id,
      status: "active",
      revision: 1,
      players: { playerOne: alice, playerTwo: bob },
      sideToMove: 1,
      result: null,
    });

    expect(await storedGameRow(lobby.id)).toMatchObject({
      status: "active",
      revision: 1,
      playerTwoId: bob.id,
    });
  });

  it("refuses the creator, an already-active game, and an unknown game", async () => {
    const lobby = await openLobby(alice);

    await expect(service.joinGame({ actorId: alice.id, gameId: lobby.id })).resolves.toEqual({
      ok: false,
      code: "cannot_join_own_game",
    });

    await service.joinGame({ actorId: bob.id, gameId: lobby.id });

    await expect(service.joinGame({ actorId: carol.id, gameId: lobby.id })).resolves.toEqual({
      ok: false,
      code: "game_not_waiting",
    });
    await expect(service.joinGame({ actorId: bob.id, gameId: MISSING_GAME_ID })).resolves.toEqual({
      ok: false,
      code: "game_not_found",
    });
  });

  it("gives the seat to exactly one of two simultaneous joiners", async () => {
    const lobby = await openLobby(alice);

    const [first, second] = await Promise.all([
      service.joinGame({ actorId: bob.id, gameId: lobby.id }),
      service.joinGame({ actorId: carol.id, gameId: lobby.id }),
    ]);

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    const loser = first.ok ? second : first;
    expect(loser).toEqual({ ok: false, code: "game_not_waiting" });

    // One seat consumed, one revision consumed.
    expect(await storedGameRow(lobby.id)).toMatchObject({ status: "active", revision: 1 });
  });
});

describe("cancelling", () => {
  it("lets the owner withdraw a waiting lobby and removes it from storage", async () => {
    const lobby = await openLobby(alice);

    await expect(service.cancelGame({ actorId: alice.id, gameId: lobby.id })).resolves.toEqual({
      ok: true,
      value: { gameId: lobby.id },
    });

    expect(await storedGameRow(lobby.id)).toBeUndefined();
    expect(await service.listWaitingLobbies()).toEqual([]);
  });

  it("refuses a non-owner and leaves the lobby standing", async () => {
    const lobby = await openLobby(alice);

    await expect(service.cancelGame({ actorId: bob.id, gameId: lobby.id })).resolves.toEqual({
      ok: false,
      code: "not_lobby_owner",
    });
    expect(await storedGameRow(lobby.id)).toBeDefined();
  });

  it("refuses to withdraw a game that is already being played", async () => {
    const game = await startGame(alice, bob);

    await expect(service.cancelGame({ actorId: alice.id, gameId: game.id })).resolves.toEqual({
      ok: false,
      code: "game_not_waiting",
    });
    expect(await storedGameRow(game.id)).toMatchObject({ status: "active" });
  });
});

describe("playing moves", () => {
  const square = { row: 3, col: 3 };

  it("persists the move, bumps the revision, and replays the board", async () => {
    const game = await startGame(alice, bob);

    const played = unwrap(
      await service.playMove({
        actorId: alice.id,
        gameId: game.id,
        expectedRevision: game.revision,
        square,
      }),
    );

    expect(GameSnapshotSchema.safeParse(played).success).toBe(true);
    expect(played.revision).toBe(game.revision + 1);
    expect(played.moves).toEqual([square]);
    expect(played.sideToMove).toBe(2);
    expect(played.scores).toEqual(scoreBoard(played.board));

    expect(await storedMoves(game.id)).toEqual([square]);
    expect(await storedGameRow(game.id)).toMatchObject({ status: "active", revision: 2 });
  });

  it("refuses a lobby nobody has joined, without writing anything", async () => {
    const lobby = await openLobby(alice);

    await expect(
      service.playMove({ actorId: alice.id, gameId: lobby.id, expectedRevision: 0, square }),
    ).resolves.toEqual({ ok: false, code: "not_your_turn" });

    expect(await storedMoves(lobby.id)).toEqual([]);
    expect(await storedGameRow(lobby.id)).toMatchObject({ status: "waiting", revision: 0 });
  });

  it("refuses a stranger, the wrong side, and a stale revision", async () => {
    const game = await startGame(alice, bob);

    await expect(
      service.playMove({ actorId: carol.id, gameId: game.id, expectedRevision: 1, square }),
    ).resolves.toEqual({ ok: false, code: "not_a_player" });

    await expect(
      service.playMove({ actorId: bob.id, gameId: game.id, expectedRevision: 1, square }),
    ).resolves.toEqual({ ok: false, code: "not_your_turn" });

    await expect(
      service.playMove({ actorId: alice.id, gameId: game.id, expectedRevision: 0, square }),
    ).resolves.toEqual({ ok: false, code: "stale_game" });

    expect(await storedMoves(game.id)).toEqual([]);
    expect(await storedGameRow(game.id)).toMatchObject({ revision: 1 });
  });

  it("refuses an occupied square", async () => {
    const game = await startGame(alice, bob);
    const played = unwrap(
      await service.playMove({
        actorId: alice.id,
        gameId: game.id,
        expectedRevision: 1,
        square,
      }),
    );

    await expect(
      service.playMove({
        actorId: bob.id,
        gameId: game.id,
        expectedRevision: played.revision,
        square,
      }),
    ).resolves.toEqual({ ok: false, code: "occupied" });

    expect(await storedMoves(game.id)).toEqual([square]);
  });

  it("lets only one of two moves against the same revision through", async () => {
    const game = await startGame(alice, bob);

    const [first, second] = await Promise.all([
      service.playMove({
        actorId: alice.id,
        gameId: game.id,
        expectedRevision: 1,
        square: { row: 0, col: 0 },
      }),
      service.playMove({
        actorId: alice.id,
        gameId: game.id,
        expectedRevision: 1,
        square: { row: 6, col: 6 },
      }),
    ]);

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect((first.ok ? second : first).ok).toBe(false);

    // One ply, one revision, one square.
    expect(await storedMoves(game.id)).toHaveLength(1);
    expect(await storedGameRow(game.id)).toMatchObject({ revision: 2 });
  });

  it("finishes on the 49th move and reports the result the rules package computes", async () => {
    const game = await startGame(alice, bob);
    const squares = allSquares();
    let snapshot = game;

    for (const [index, next] of squares.entries()) {
      const actor = index % 2 === 0 ? alice : bob;
      snapshot = unwrap(
        await service.playMove({
          actorId: actor.id,
          gameId: game.id,
          expectedRevision: snapshot.revision,
          square: next,
        }),
      );
    }

    const replayed = replay(squares);
    if (!replayed.ok) {
      throw new Error("expected a full row-major fill to be legal");
    }

    expect(snapshot.status).toBe("finished");
    expect(snapshot.sideToMove).toBeNull();
    expect(snapshot.result).toEqual(gameResult(replayed.game));
    expect(snapshot.scores).toEqual(scoreBoard(replayed.game.board));
    expect(snapshot.revision).toBe(CELL_COUNT + 1);
    expect(GameSnapshotSchema.safeParse(snapshot).success).toBe(true);

    expect(await storedGameRow(game.id)).toMatchObject({
      status: "finished",
      revision: CELL_COUNT + 1,
    });
    expect(await storedMoves(game.id)).toHaveLength(CELL_COUNT);

    await expect(
      service.playMove({
        actorId: bob.id,
        gameId: game.id,
        expectedRevision: snapshot.revision,
        square: { row: 0, col: 0 },
      }),
    ).resolves.toEqual({ ok: false, code: "game_over" });
  });
});

describe("reconstruction and reconnection", () => {
  it("rebuilds an interrupted game from its persisted moves alone", async () => {
    const game = await startGame(alice, bob);
    const squares = allSquares().slice(0, 5);
    let revision = game.revision;

    for (const [index, square] of squares.entries()) {
      const actor = index % 2 === 0 ? alice : bob;
      revision = unwrap(
        await service.playMove({
          actorId: actor.id,
          gameId: game.id,
          expectedRevision: revision,
          square,
        }),
      ).revision;
    }

    // A fresh service over a fresh repository: nothing is carried in memory.
    const reconnected = createGameService(createGameRepository(database.db));
    const [restored] = await reconnected.listOpenGames(bob.id);
    const replayed = replay(squares);

    if (restored === undefined || !replayed.ok) {
      throw new Error("expected the game to be restored");
    }

    expect(restored.id).toBe(game.id);
    expect(restored.moves).toEqual(squares);
    expect(restored.board).toEqual(replayed.game.board);
    expect(restored.scores).toEqual(scoreBoard(replayed.game.board));
    expect(restored.revision).toBe(revision);
    expect(restored.sideToMove).toBe(2);
  });

  it("returns a user's waiting and active games and nobody else's", async () => {
    const lobby = await openLobby(alice);
    const active = await startGame(bob, alice);
    await openLobby(carol);

    const forAlice = await service.listOpenGames(alice.id);

    expect(forAlice.map((game) => game.id).sort()).toEqual([lobby.id, active.id].sort());
    expect((await service.listOpenGames(carol.id)).map((game) => game.status)).toEqual(["waiting"]);
  });

  it("keeps a finished game stored but out of the open-game list", async () => {
    const game = await startGame(alice, bob);
    let revision = game.revision;

    for (const [index, square] of allSquares().entries()) {
      const actor = index % 2 === 0 ? alice : bob;
      revision = unwrap(
        await service.playMove({
          actorId: actor.id,
          gameId: game.id,
          expectedRevision: revision,
          square,
        }),
      ).revision;
    }

    expect(await service.listOpenGames(alice.id)).toEqual([]);
    expect(await service.listOpenGames(bob.id)).toEqual([]);

    const stored = await repository.findGame(game.id);
    expect(stored?.status).toBe("finished");
    expect(stored?.moves).toHaveLength(CELL_COUNT);
  });
});
