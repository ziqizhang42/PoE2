import { UNTIMED, type AuthUser, type GameSnapshot, type TimeControl } from "@poe2/protocol";
import { GameSnapshotSchema } from "@poe2/protocol";
import {
  allSquares,
  CELL_COUNT,
  gameResult,
  PLAYER_ONE,
  PLAYER_TWO,
  replay,
  scoreBoard,
  type Player,
  type Square,
} from "@poe2/rules";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { normalizeUsername } from "../auth/username.js";
import { readDatabaseConfig } from "../config/database.js";
import { createDatabaseClient } from "../db/client.js";
import { gameMoveClocks, gameMoves, games, ratingEvents, users } from "../db/schema.js";
import { INITIAL_RATING } from "../rating/glicko2.js";
import { createRatingLedger } from "../rating/ledger.js";
import { createGameRepository, type GameRepositoryOptions } from "./repository.js";
import { createGameService } from "./service.js";

const PASSWORD_HASH = "$argon2id$test";
const MISSING_GAME_ID = "9a3c9f5e-1f2b-4c3d-8e7f-0a1b2c3d4e5f";

const database = createDatabaseClient(readDatabaseConfig(process.env));

/** Uses the production finish hook to exercise result/rating atomicity. */
const ratingLedger = createRatingLedger();
const applyFinishedRating: NonNullable<GameRepositoryOptions["onGameFinished"]> = async (
  executor,
  game,
  finish,
) => {
  if (!game.rated || game.playerTwo === null) {
    return;
  }

  await ratingLedger.applyFinishedGame(executor, {
    gameId: game.id,
    playerOneId: game.playerOne.id,
    playerTwoId: game.playerTwo.id,
    winner: finish.winner,
  });
};
const repository = createGameRepository(database.db, {
  onGameFinished: applyFinishedRating,
});
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

function readyGeneration(game: GameSnapshot): number {
  if (game.status !== "ready_check") {
    throw new Error(`expected a ready check, got ${game.status}`);
  }
  return game.readyCheck.generation;
}

const RATED_CONTROL: TimeControl = { kind: "timed", initialMs: 600_000, incrementMs: 5_000 };

/** A waiting lobby opened by `owner`. */
async function openLobby(
  owner: AuthUser,
  rated = false,
  creatorSeat: Player = PLAYER_ONE,
): Promise<GameSnapshot> {
  return unwrap(
    await service.createGame({
      actorId: owner.id,
      rated,
      timeControl: rated ? RATED_CONTROL : UNTIMED,
      creatorSeat,
    }),
  );
}

/** Creates, joins, and confirms an active game. */
async function startGame(
  owner: AuthUser,
  opponent: AuthUser,
  rated = false,
): Promise<GameSnapshot> {
  const lobby = await openLobby(owner, rated);
  const joined = unwrap(await service.joinGame({ actorId: opponent.id, gameId: lobby.id }));
  const readyCheckGeneration = readyGeneration(joined);
  unwrap(await service.readyGame({ actorId: owner.id, gameId: lobby.id, readyCheckGeneration }));
  return unwrap(
    await service.readyGame({ actorId: opponent.id, gameId: lobby.id, readyCheckGeneration }),
  );
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
      playerOneId: games.playerOneId,
      playerTwoId: games.playerTwoId,
      creatorId: games.creatorId,
      creatorSeat: games.creatorSeat,
      playerOneReady: games.playerOneReady,
      playerTwoReady: games.playerTwoReady,
      readyDeadlineAt: games.readyDeadlineAt,
      readyCheckGeneration: games.readyCheckGeneration,
      activatedRevision: games.activatedRevision,
      updatedAt: games.updatedAt,
      finishedAt: games.finishedAt,
      outcomeReason: games.outcomeReason,
      winner: games.winner,
      initialTimeMs: games.initialTimeMs,
      incrementMs: games.incrementMs,
      playerOneRemainingMs: games.playerOneRemainingMs,
      playerTwoRemainingMs: games.playerTwoRemainingMs,
      runningPlayer: games.runningPlayer,
      turnStartedAt: games.turnStartedAt,
      deadlineAt: games.deadlineAt,
      clockStoppedAt: games.clockStoppedAt,
    })
    .from(games)
    .where(eq(games.id, gameId));

  return row;
}

function controlledHarness(initialDecisionAt: Date) {
  let decisionAt = initialDecisionAt;
  const controlledRepository = createGameRepository(database.db, {
    readDecisionAt: () => Promise.resolve(new Date(decisionAt)),
    onGameFinished: applyFinishedRating,
  });

  const controlledService = createGameService(controlledRepository);

  return {
    repository: controlledRepository,
    service: controlledService,
    setDecisionAt(next: Date) {
      decisionAt = next;
    },
    async start(gameId: string): Promise<GameSnapshot> {
      const joined = unwrap(await controlledService.joinGame({ actorId: bob.id, gameId }));
      const readyCheckGeneration = readyGeneration(joined);
      unwrap(
        await controlledService.readyGame({ actorId: alice.id, gameId, readyCheckGeneration }),
      );
      return unwrap(
        await controlledService.readyGame({ actorId: bob.id, gameId, readyCheckGeneration }),
      );
    },
  };
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
      outcome: null,
      moves: [],
    });

    expect(await storedGameRow(lobby.id)).toMatchObject({
      status: "waiting",
      revision: 0,
      playerTwoId: null,
    });
  });

  it("lists the newest waiting lobby first and drops rooms once joined", async () => {
    const first = await openLobby(alice);
    const second = await openLobby(bob);
    await database.db
      .update(games)
      .set({ createdAt: new Date("2026-08-04T10:00:00.000Z") })
      .where(eq(games.id, first.id));
    await database.db
      .update(games)
      .set({ createdAt: new Date("2026-08-04T10:01:00.000Z") })
      .where(eq(games.id, second.id));

    expect((await service.listWaitingLobbies()).map((entry) => entry.id)).toEqual([
      second.id,
      first.id,
    ]);

    await service.joinGame({ actorId: carol.id, gameId: first.id });

    expect((await service.listWaitingLobbies()).map((entry) => entry.id)).toEqual([second.id]);
  });

  it("keeps newly opened rooms visible after the lobby snapshot reaches its cap", async () => {
    const owners = await database.db
      .insert(users)
      .values(
        Array.from({ length: 101 }, (_unused, index) => {
          const username = `Lobby${String(index).padStart(3, "0")}`;
          return {
            username,
            normalizedUsername: normalizeUsername(username),
            passwordHash: PASSWORD_HASH,
          };
        }),
      )
      .returning({ id: users.id, username: users.username });

    await database.db.insert(games).values(
      owners.map((owner) => {
        const index = Number(owner.username.slice("Lobby".length));
        const openedAt = new Date(Date.UTC(2026, 7, 4, 10, index));
        return {
          playerOneId: owner.id,
          creatorId: owner.id,
          createdAt: openedAt,
          updatedAt: openedAt,
        };
      }),
    );

    const listed = await service.listWaitingLobbies();

    expect(listed).toHaveLength(100);
    expect(listed[0]?.owner.username).toBe("Lobby100");
    expect(listed.at(-1)?.owner.username).toBe("Lobby001");
    expect(listed.some((entry) => entry.owner.username === "Lobby000")).toBe(false);
  });
});

describe("joining", () => {
  it("seats the joiner, opens a ready check, and bumps the revision once", async () => {
    const lobby = await openLobby(alice);
    const joined = unwrap(await service.joinGame({ actorId: bob.id, gameId: lobby.id }));

    expect(joined).toMatchObject({
      id: lobby.id,
      status: "ready_check",
      revision: 1,
      players: { playerOne: alice, playerTwo: bob },
      sideToMove: null,
      outcome: null,
    });

    expect(await storedGameRow(lobby.id)).toMatchObject({
      status: "ready_check",
      revision: 1,
      playerTwoId: bob.id,
      playerOneReady: false,
      playerTwoReady: false,
      readyCheckGeneration: 1,
      activatedRevision: null,
    });
  });

  it("moves the owner into the second seat when that is the one they took", async () => {
    const lobby = await openLobby(alice, false, PLAYER_TWO);

    expect((await service.listWaitingLobbies())[0]).toMatchObject({
      owner: alice,
      creatorSeat: PLAYER_TWO,
    });

    const joined = unwrap(await service.joinGame({ actorId: bob.id, gameId: lobby.id }));

    expect(joined).toMatchObject({
      status: "ready_check",
      players: { playerOne: bob, playerTwo: alice },
    });
    expect(await storedGameRow(lobby.id)).toMatchObject({
      playerOneId: bob.id,
      playerTwoId: alice.id,
      creatorId: alice.id,
      creatorSeat: PLAYER_TWO,
    });

    const readyCheckGeneration = readyGeneration(joined);
    const started = unwrap(
      await service.readyGame({ actorId: alice.id, gameId: lobby.id, readyCheckGeneration }),
    ).status;
    expect(started).toBe("ready_check");
    const active = unwrap(
      await service.readyGame({ actorId: bob.id, gameId: lobby.id, readyCheckGeneration }),
    );

    expect(active).toMatchObject({ status: "active", sideToMove: PLAYER_ONE });
  });

  it("returns the owner to the first seat when a second-seat check is declined", async () => {
    const lobby = await openLobby(alice, false, PLAYER_TWO);
    const joined = unwrap(await service.joinGame({ actorId: bob.id, gameId: lobby.id }));

    const abandoned = unwrap(
      await service.declineGame({
        actorId: bob.id,
        gameId: lobby.id,
        readyCheckGeneration: readyGeneration(joined),
      }),
    );

    expect(abandoned.releasedPlayerId).toBe(bob.id);
    expect(abandoned.game).toMatchObject({
      status: "waiting",
      players: { playerOne: alice, playerTwo: null },
    });
    expect(await storedGameRow(lobby.id)).toMatchObject({
      playerOneId: alice.id,
      playerTwoId: null,
    });
    expect((await service.listWaitingLobbies())[0]).toMatchObject({ owner: alice });
  });

  it("lets a player holding their own lobby take a second-seat lobby's first seat", async () => {
    const mine = await openLobby(bob);
    const theirs = await openLobby(alice, false, PLAYER_TWO);

    const joined = unwrap(await service.joinGame({ actorId: bob.id, gameId: theirs.id }));

    expect(joined).toMatchObject({ players: { playerOne: bob, playerTwo: alice } });
    expect((await service.listWaitingLobbies()).map((entry) => entry.id)).toEqual([mine.id]);
  });

  it("carries a game from the check into play, recording where it started", async () => {
    const lobby = await openLobby(alice);
    const joined = unwrap(await service.joinGame({ actorId: bob.id, gameId: lobby.id }));
    const readyCheckGeneration = readyGeneration(joined);

    const oneReady = unwrap(
      await service.readyGame({ actorId: alice.id, gameId: lobby.id, readyCheckGeneration }),
    );
    expect(oneReady).toMatchObject({ status: "ready_check", revision: 2 });
    expect(await storedGameRow(lobby.id)).toMatchObject({
      playerOneReady: true,
      playerTwoReady: false,
    });

    const started = unwrap(
      await service.readyGame({ actorId: bob.id, gameId: lobby.id, readyCheckGeneration }),
    );
    expect(started).toMatchObject({ status: "active", revision: 3, sideToMove: 1 });

    expect(await storedGameRow(lobby.id)).toMatchObject({
      status: "active",
      revision: 3,
      playerOneReady: false,
      playerTwoReady: false,
      readyDeadlineAt: null,
      activatedRevision: 3,
    });
  });

  it("keeps the running player right after a check is declined and rejoined", async () => {
    const lobby = await openLobby(alice, true);
    const firstCheck = unwrap(await service.joinGame({ actorId: bob.id, gameId: lobby.id }));
    const firstGeneration = readyGeneration(firstCheck);
    unwrap(
      await service.declineGame({
        actorId: bob.id,
        gameId: lobby.id,
        readyCheckGeneration: firstGeneration,
      }),
    );

    const secondCheck = unwrap(await service.joinGame({ actorId: carol.id, gameId: lobby.id }));
    const readyCheckGeneration = readyGeneration(secondCheck);
    await service.readyGame({ actorId: carol.id, gameId: lobby.id, readyCheckGeneration });
    await expect(
      service.readyGame({
        actorId: alice.id,
        gameId: lobby.id,
        readyCheckGeneration: firstGeneration,
      }),
    ).resolves.toEqual({ ok: false, code: "stale_game" });
    const started = unwrap(
      await service.readyGame({ actorId: alice.id, gameId: lobby.id, readyCheckGeneration }),
    );

    expect(started).toMatchObject({ status: "active", sideToMove: 1 });
    if (started.status !== "active" || started.clock === null) {
      throw new Error("expected a running clock");
    }
    expect(started.clock.runningPlayer).toBe(1);
  });

  it("gives the seat back when a check is declined, and reopens the lobby", async () => {
    const lobby = await openLobby(alice);
    const joined = unwrap(await service.joinGame({ actorId: bob.id, gameId: lobby.id }));

    const abandoned = unwrap(
      await service.declineGame({
        actorId: bob.id,
        gameId: lobby.id,
        readyCheckGeneration: readyGeneration(joined),
      }),
    );

    expect(abandoned.releasedPlayerId).toBe(bob.id);
    expect(abandoned.game).toMatchObject({ status: "waiting", revision: 2 });
    expect((await service.listWaitingLobbies()).map((entry) => entry.id)).toEqual([lobby.id]);
  });

  it("refuses a second lobby while the owner is in a ready check", async () => {
    const lobby = await openLobby(alice);
    const joined = unwrap(await service.joinGame({ actorId: bob.id, gameId: lobby.id }));

    await expect(service.createGame({ actorId: alice.id, rated: false })).resolves.toEqual({
      ok: false,
      code: "lobby_already_open",
    });

    unwrap(
      await service.declineGame({
        actorId: bob.id,
        gameId: lobby.id,
        readyCheckGeneration: readyGeneration(joined),
      }),
    );
    expect((await service.listWaitingLobbies()).map((entry) => entry.id)).toEqual([lobby.id]);
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

    expect(await storedGameRow(lobby.id)).toMatchObject({ status: "ready_check", revision: 1 });
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
    expect(await storedGameRow(game.id)).toMatchObject({
      status: "active",
      revision: game.revision + 1,
    });
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
      service.playMove({
        actorId: carol.id,
        gameId: game.id,
        expectedRevision: game.revision,
        square,
      }),
    ).resolves.toEqual({ ok: false, code: "not_a_player" });

    await expect(
      service.playMove({
        actorId: bob.id,
        gameId: game.id,
        expectedRevision: game.revision,
        square,
      }),
    ).resolves.toEqual({ ok: false, code: "not_your_turn" });

    await expect(
      service.playMove({ actorId: alice.id, gameId: game.id, expectedRevision: 0, square }),
    ).resolves.toEqual({ ok: false, code: "stale_game" });

    expect(await storedMoves(game.id)).toEqual([]);
    expect(await storedGameRow(game.id)).toMatchObject({ revision: game.revision });
  });

  it("refuses an occupied square", async () => {
    const game = await startGame(alice, bob);
    const played = unwrap(
      await service.playMove({
        actorId: alice.id,
        gameId: game.id,
        expectedRevision: game.revision,
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
        expectedRevision: game.revision,
        square: { row: 0, col: 0 },
      }),
      service.playMove({
        actorId: alice.id,
        gameId: game.id,
        expectedRevision: game.revision,
        square: { row: 6, col: 6 },
      }),
    ]);

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect((first.ok ? second : first).ok).toBe(false);

    expect(await storedMoves(game.id)).toHaveLength(1);
    expect(await storedGameRow(game.id)).toMatchObject({ revision: game.revision + 1 });
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
    expect(snapshot.outcome?.reason).toBe("board_full");
    expect(snapshot.outcome?.winner).toBe(gameResult(replayed.game)?.winner);
    expect(snapshot.scores).toEqual(scoreBoard(replayed.game.board));
    expect(snapshot.revision).toBe(game.revision + CELL_COUNT);
    expect(GameSnapshotSchema.safeParse(snapshot).success).toBe(true);

    expect(await storedGameRow(game.id)).toMatchObject({
      status: "finished",
      revision: game.revision + CELL_COUNT,
      outcomeReason: "board_full",
      winner: gameResult(replayed.game)?.winner,
    });
    expect((await storedGameRow(game.id))?.finishedAt).toBeInstanceOf(Date);
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

  it("returns a user's waiting, ready-check, and active games and nobody else's", async () => {
    const lobby = await openLobby(alice);
    const active = await startGame(bob, alice);
    const dave = await seedUser("Dave");
    const readyCheck = await openLobby(carol);
    unwrap(await service.joinGame({ actorId: dave.id, gameId: readyCheck.id }));

    const forAlice = await service.listOpenGames(alice.id);

    expect(forAlice.map((game) => game.id).sort()).toEqual([lobby.id, active.id].sort());
    expect((await service.listOpenGames(carol.id)).map((game) => game.status)).toEqual([
      "ready_check",
    ]);
    expect((await service.listOpenGames(dave.id)).map((game) => game.status)).toEqual([
      "ready_check",
    ]);
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

describe("resigning", () => {
  it("ends a game far from full and records who won and why", async () => {
    const game = await startGame(alice, bob);
    const revision = unwrap(
      await service.playMove({
        actorId: alice.id,
        gameId: game.id,
        expectedRevision: game.revision,
        square: { row: 3, col: 3 },
      }),
    ).revision;

    const resigned = unwrap(
      await service.resignGame({ actorId: bob.id, gameId: game.id, expectedRevision: revision }),
    );

    expect(resigned.status).toBe("finished");
    expect(resigned.outcome).toMatchObject({ reason: "resignation", winner: 1 });
    expect(resigned.revision).toBe(revision + 1);
    expect(resigned.moves).toHaveLength(1);
    expect(GameSnapshotSchema.safeParse(resigned).success).toBe(true);

    expect(await storedGameRow(game.id)).toMatchObject({
      status: "finished",
      outcomeReason: "resignation",
      winner: 1,
    });
    expect((await storedGameRow(game.id))?.finishedAt).toBeInstanceOf(Date);
  });

  it("keeps the resigned game out of both players' open games", async () => {
    const game = await startGame(alice, bob);

    await service.resignGame({
      actorId: alice.id,
      gameId: game.id,
      expectedRevision: game.revision,
    });

    expect(await service.listOpenGames(alice.id)).toEqual([]);
    expect(await service.listOpenGames(bob.id)).toEqual([]);
    expect((await repository.findGame(game.id))?.outcome).toMatchObject({
      reason: "resignation",
      winner: 2,
    });
  });

  it("refuses a second resignation, a stranger, and a stale revision", async () => {
    const game = await startGame(alice, bob);

    await expect(
      service.resignGame({ actorId: carol.id, gameId: game.id, expectedRevision: game.revision }),
    ).resolves.toEqual({ ok: false, code: "not_a_player" });

    await expect(
      service.resignGame({ actorId: alice.id, gameId: game.id, expectedRevision: 99 }),
    ).resolves.toEqual({ ok: false, code: "stale_game" });

    const resigned = unwrap(
      await service.resignGame({
        actorId: alice.id,
        gameId: game.id,
        expectedRevision: game.revision,
      }),
    );

    await expect(
      service.resignGame({
        actorId: bob.id,
        gameId: game.id,
        expectedRevision: resigned.revision,
      }),
    ).resolves.toEqual({ ok: false, code: "game_over" });
  });

  it("refuses to resign a lobby nobody has joined", async () => {
    const lobby = await openLobby(alice);

    await expect(
      service.resignGame({ actorId: alice.id, gameId: lobby.id, expectedRevision: 0 }),
    ).resolves.toEqual({ ok: false, code: "not_your_turn" });
    expect(await storedGameRow(lobby.id)).toMatchObject({ status: "waiting" });
  });

  it("lets only one of two simultaneous resignations through", async () => {
    const game = await startGame(alice, bob);

    const [first, second] = await Promise.all([
      service.resignGame({ actorId: alice.id, gameId: game.id, expectedRevision: game.revision }),
      service.resignGame({ actorId: bob.id, gameId: game.id, expectedRevision: game.revision }),
    ]);

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect(await storedGameRow(game.id)).toMatchObject({
      status: "finished",
      revision: game.revision + 1,
    });
  });
});

describe("rating a finished game", () => {
  async function ratingRows(gameId: string) {
    return database.db
      .select({
        userId: ratingEvents.userId,
        opponentId: ratingEvents.opponentId,
        score: ratingEvents.score,
        ratingBefore: ratingEvents.ratingBefore,
        deviationBefore: ratingEvents.ratingDeviationBefore,
        ratingAfter: ratingEvents.ratingAfter,
        deviationAfter: ratingEvents.ratingDeviationAfter,
      })
      .from(ratingEvents)
      .where(eq(ratingEvents.gameId, gameId))
      .orderBy(asc(ratingEvents.userId));
  }

  async function storedRating(userId: string) {
    const [row] = await database.db
      .select({
        rating: users.rating,
        deviation: users.ratingDeviation,
        volatility: users.volatility,
        ratedGamesPlayed: users.ratedGamesPlayed,
      })
      .from(users)
      .where(eq(users.id, userId));

    return row;
  }

  it("writes one event per player and moves both ratings", async () => {
    const game = await startGame(alice, bob, true);

    await service.resignGame({
      actorId: alice.id,
      gameId: game.id,
      expectedRevision: game.revision,
    });

    const rows = await ratingRows(game.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.score).sort()).toEqual([0, 1]);
    expect(rows.every((row) => row.userId !== row.opponentId)).toBe(true);
    expect(rows.every((row) => row.ratingBefore === INITIAL_RATING.rating)).toBe(true);

    const [aliceAfter, bobAfter] = [await storedRating(alice.id), await storedRating(bob.id)];
    expect(bobAfter?.rating).toBeGreaterThan(INITIAL_RATING.rating);
    expect(aliceAfter?.rating).toBeLessThan(INITIAL_RATING.rating);
    expect(bobAfter?.deviation).toBeLessThan(INITIAL_RATING.deviation);
    expect(aliceAfter?.deviation).toBeLessThan(INITIAL_RATING.deviation);
  });

  it("applies due inactivity before recording the next result", async () => {
    const game = await startGame(alice, bob, true);
    await database.db
      .update(users)
      .set({
        ratingDeviation: 60,
        volatility: 0.06,
        ratedGamesPlayed: 10,
        ratingPeriodAt: sql`clock_timestamp() - interval '15 days'`,
      })
      .where(inArray(users.id, [alice.id, bob.id]));

    await service.resignGame({
      actorId: alice.id,
      gameId: game.id,
      expectedRevision: game.revision,
    });

    const rows = await ratingRows(game.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.deviationBefore > 60)).toBe(true);
  });

  it("keeps the cached rating on users equal to the ledger's latest row", async () => {
    const game = await startGame(alice, bob, true);
    await service.resignGame({
      actorId: bob.id,
      gameId: game.id,
      expectedRevision: game.revision,
    });

    const rows = await ratingRows(game.id);
    for (const row of rows) {
      const cached = await storedRating(row.userId);
      expect(cached?.rating).toBeCloseTo(row.ratingAfter, 9);
      expect(cached?.deviation).toBeCloseTo(row.deviationAfter, 9);
    }
  });

  it("counts the rated game against both players, once", async () => {
    const game = await startGame(alice, bob, true);
    await service.resignGame({
      actorId: alice.id,
      gameId: game.id,
      expectedRevision: game.revision,
    });

    expect((await storedRating(alice.id))?.ratedGamesPlayed).toBe(1);
    expect((await storedRating(bob.id))?.ratedGamesPlayed).toBe(1);
  });

  it("leaves a casual game entirely unrated", async () => {
    const game = await startGame(alice, bob, false);
    await service.resignGame({
      actorId: alice.id,
      gameId: game.id,
      expectedRevision: game.revision,
    });

    expect(await ratingRows(game.id)).toEqual([]);
    expect((await storedRating(alice.id))?.rating).toBe(INITIAL_RATING.rating);
    expect((await storedRating(bob.id))?.rating).toBe(INITIAL_RATING.rating);
    expect((await storedRating(alice.id))?.ratedGamesPlayed).toBe(0);
  });

  it("rates a game the board decided, with the winner the rules named", async () => {
    const game = await startGame(alice, bob, true);
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

    const row = await storedGameRow(game.id);
    const rows = await ratingRows(game.id);
    const winnerId = row?.winner === 1 ? alice.id : bob.id;

    expect(rows).toHaveLength(2);
    expect(rows.find((event) => event.userId === winnerId)?.score).toBe(1);
    expect((await storedRating(winnerId))?.rating).toBeGreaterThan(INITIAL_RATING.rating);
  });

  it("applies a game once even if the finish is attempted twice", async () => {
    const game = await startGame(alice, bob, true);

    const [first, second] = await Promise.all([
      service.resignGame({ actorId: alice.id, gameId: game.id, expectedRevision: game.revision }),
      service.resignGame({ actorId: bob.id, gameId: game.id, expectedRevision: game.revision }),
    ]);

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect(await ratingRows(game.id)).toHaveLength(2);
  });

  it("finishes two games sharing a player without deadlocking", async () => {
    const first = await startGame(alice, bob, true);
    const second = await startGame(carol, alice, true);

    const results = await Promise.all([
      service.resignGame({ actorId: alice.id, gameId: first.id, expectedRevision: first.revision }),
      service.resignGame({
        actorId: alice.id,
        gameId: second.id,
        expectedRevision: second.revision,
      }),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(await ratingRows(first.id)).toHaveLength(2);
    expect(await ratingRows(second.id)).toHaveLength(2);

    const aliceEvents = await database.db
      .select({ ratingBefore: ratingEvents.ratingBefore, ratingAfter: ratingEvents.ratingAfter })
      .from(ratingEvents)
      .where(eq(ratingEvents.userId, alice.id))
      .orderBy(asc(ratingEvents.createdAt));

    expect(aliceEvents).toHaveLength(2);
    expect(aliceEvents[1]?.ratingBefore).toBeCloseTo(aliceEvents[0]?.ratingAfter ?? 0, 9);
    expect((await storedRating(alice.id))?.rating).toBeLessThan(INITIAL_RATING.rating);
  });
});

describe("persisted server-authoritative clocks", () => {
  it.each([
    ["no clock", UNTIMED, null, null],
    [
      "a clock nobody preset",
      { kind: "timed", initialMs: 137_000, incrementMs: 7_000 },
      137_000,
      7_000,
    ],
    ["a clock with no increment", { kind: "timed", initialMs: 60_000, incrementMs: 0 }, 60_000, 0],
    [
      "the longest clock allowed",
      { kind: "timed", initialMs: 10_800_000, incrementMs: 180_000 },
      10_800_000,
      180_000,
    ],
  ] as const)(
    "persists %s exactly as asked while waiting",
    async (_label, timeControl: TimeControl, initialTimeMs, incrementMs) => {
      const lobby = unwrap(
        await service.createGame({ actorId: alice.id, rated: false, timeControl }),
      );

      expect(lobby.timeControl).toEqual(timeControl);
      expect(lobby.clock).toBeNull();
      expect(await storedGameRow(lobby.id)).toMatchObject({
        initialTimeMs,
        incrementMs,
        playerOneRemainingMs: null,
        playerTwoRemainingMs: null,
        runningPlayer: null,
        deadlineAt: null,
      });
    },
  );

  it("refuses a rated game with no clock, and the constraint refuses it too", async () => {
    await expect(
      service.createGame({ actorId: alice.id, rated: true, timeControl: UNTIMED }),
    ).resolves.toEqual({ ok: false, code: "rated_requires_clock" });

    await expect(
      database.db.insert(games).values({ playerOneId: alice.id, creatorId: alice.id, rated: true }),
    ).rejects.toThrow();
  });

  it.each([
    ["a clock below the floor", 9_000, 0],
    ["a clock above the ceiling", 10_801_000, 0],
    ["an increment above the ceiling", 60_000, 181_000],
    ["a fraction of a second", 60_500, 0],
  ])("refuses %s at the database as well", async (_label, initialTimeMs, incrementMs) => {
    await expect(
      database.db
        .insert(games)
        .values({ playerOneId: alice.id, creatorId: alice.id, initialTimeMs, incrementMs }),
    ).rejects.toThrow();
  });

  it("accepts one millisecond before the deadline, records increment, then times out at equality", async () => {
    const startedAt = new Date("2030-01-01T00:00:00.000Z");
    const harness = controlledHarness(startedAt);
    const lobby = unwrap(
      await harness.service.createGame({
        actorId: alice.id,
        rated: false,
        timeControl: { kind: "timed", initialMs: 180_000, incrementMs: 2_000 },
      }),
    );
    const started = await harness.start(lobby.id);
    if (started.status !== "active" || started.clock === null) {
      throw new Error("expected a running timed game");
    }

    expect(started.clock).toMatchObject({
      remainingMs: { playerOne: 180_000, playerTwo: 180_000 },
      runningPlayer: 1,
      turnStartedAt: startedAt.toISOString(),
      deadline: new Date(startedAt.getTime() + 180_000).toISOString(),
      serverNow: startedAt.toISOString(),
    });

    const acceptedAt = new Date(Date.parse(started.clock.deadline) - 1);
    harness.setDecisionAt(acceptedAt);
    const played = unwrap(
      await harness.service.playMove({
        actorId: alice.id,
        gameId: started.id,
        expectedRevision: started.revision,
        square: { row: 0, col: 0 },
      }),
    );
    if (played.status !== "active" || played.clock === null) {
      throw new Error("expected the timely move to continue the game");
    }

    expect(played.clock.remainingMs).toEqual({ playerOne: 2_001, playerTwo: 180_000 });
    expect(played.clock.runningPlayer).toBe(2);
    const [moveClock] = await database.db
      .select()
      .from(gameMoveClocks)
      .where(eq(gameMoveClocks.gameId, started.id));
    expect(moveClock).toMatchObject({
      ply: 0,
      acceptedAt,
      elapsedMs: 179_999,
      incrementAppliedMs: 2_000,
      playerOneRemainingMs: 2_001,
      playerTwoRemainingMs: 180_000,
    });

    const exactDeadline = new Date(played.clock.deadline);
    harness.setDecisionAt(exactDeadline);
    const lateResignation = await harness.service.resignGame({
      actorId: bob.id,
      gameId: played.id,
      expectedRevision: played.revision,
    });

    expect(lateResignation.ok).toBe(false);
    if (lateResignation.ok || lateResignation.committed?.status !== "finished") {
      throw new Error("expected timeout to commit before the late resignation");
    }
    expect(lateResignation.code).toBe("game_over");
    expect(lateResignation.committed.outcome).toMatchObject({ reason: "timeout", winner: 1 });
    expect(lateResignation.committed.clock).toEqual({
      remainingMs: { playerOne: 2_001, playerTwo: 0 },
      stoppedAt: exactDeadline.toISOString(),
    });
    expect(await storedGameRow(played.id)).toMatchObject({
      status: "finished",
      outcomeReason: "timeout",
      winner: 1,
      playerOneRemainingMs: 2_001,
      playerTwoRemainingMs: 0,
      runningPlayer: null,
      deadlineAt: null,
      clockStoppedAt: exactDeadline,
    });
  });

  it("charges a timely resignation to the running clock without increment", async () => {
    const startedAt = new Date("2030-02-01T00:00:00.000Z");
    const harness = controlledHarness(startedAt);
    const lobby = unwrap(
      await harness.service.createGame({
        actorId: alice.id,
        rated: false,
        timeControl: { kind: "timed", initialMs: 180_000, incrementMs: 2_000 },
      }),
    );
    const started = await harness.start(lobby.id);
    const resignedAt = new Date(startedAt.getTime() + 5_000);
    harness.setDecisionAt(resignedAt);
    const resigned = unwrap(
      await harness.service.resignGame({
        actorId: bob.id,
        gameId: started.id,
        expectedRevision: started.revision,
      }),
    );

    expect(resigned.status).toBe("finished");
    expect(resigned.clock).toEqual({
      remainingMs: { playerOne: 175_000, playerTwo: 180_000 },
      stoppedAt: resignedAt.toISOString(),
    });
    expect(await database.db.select().from(gameMoveClocks)).toEqual([]);
  });

  it("applies the final move's increment before persisting the stopped clock", async () => {
    const startedAt = new Date("2030-03-01T00:00:00.000Z");
    const harness = controlledHarness(startedAt);
    const lobby = unwrap(
      await harness.service.createGame({
        actorId: alice.id,
        rated: false,
        timeControl: { kind: "timed", initialMs: 180_000, incrementMs: 2_000 },
      }),
    );
    let snapshot = await harness.start(lobby.id);

    for (const [index, square] of allSquares().entries()) {
      snapshot = unwrap(
        await harness.service.playMove({
          actorId: index % 2 === 0 ? alice.id : bob.id,
          gameId: snapshot.id,
          expectedRevision: snapshot.revision,
          square,
        }),
      );
    }

    expect(snapshot.status).toBe("finished");
    expect(snapshot.clock).toEqual({
      remainingMs: {
        playerOne: 230_000,
        playerTwo: 228_000,
      },
      stoppedAt: startedAt.toISOString(),
    });
    const clockRows = await database.db
      .select()
      .from(gameMoveClocks)
      .where(eq(gameMoveClocks.gameId, snapshot.id))
      .orderBy(asc(gameMoveClocks.ply));
    expect(clockRows).toHaveLength(CELL_COUNT);
    expect(clockRows.at(-1)).toMatchObject({
      ply: CELL_COUNT - 1,
      elapsedMs: 0,
      incrementAppliedMs: 2_000,
      playerOneRemainingMs: 230_000,
      playerTwoRemainingMs: 228_000,
    });
  });

  it("serializes a move-versus-supervisor timeout race and rates it exactly once", async () => {
    const startedAt = new Date("2030-04-01T00:00:00.000Z");
    const harness = controlledHarness(startedAt);
    const lobby = unwrap(
      await harness.service.createGame({
        actorId: alice.id,
        rated: true,
        timeControl: { kind: "timed", initialMs: 180_000, incrementMs: 2_000 },
      }),
    );
    const started = await harness.start(lobby.id);
    if (started.status !== "active" || started.clock === null) {
      throw new Error("expected a running timed game");
    }
    const deadline = new Date(started.clock.deadline);
    harness.setDecisionAt(deadline);

    const [command, callback] = await Promise.all([
      harness.service.playMove({
        actorId: alice.id,
        gameId: started.id,
        expectedRevision: started.revision,
        square: { row: 0, col: 0 },
      }),
      harness.service.processDeadline(started.id, deadline),
    ]);

    expect(command.ok).toBe(false);
    expect(callback.kind === "finished" || callback.kind === "absent").toBe(true);
    expect(await storedGameRow(started.id)).toMatchObject({
      status: "finished",
      outcomeReason: "timeout",
      winner: 2,
      playerOneRemainingMs: 0,
      clockStoppedAt: deadline,
    });
    expect(
      await database.db
        .select({ userId: ratingEvents.userId })
        .from(ratingEvents)
        .where(eq(ratingEvents.gameId, started.id)),
    ).toHaveLength(2);

    await expect(harness.service.processDeadline(started.id, deadline)).resolves.toEqual({
      kind: "absent",
    });
    expect(
      await database.db
        .select({ userId: ratingEvents.userId })
        .from(ratingEvents)
        .where(eq(ratingEvents.gameId, started.id)),
    ).toHaveLength(2);
  });

  it("finds persisted active deadlines for restart recovery", async () => {
    const startedAt = new Date("2030-05-01T00:00:00.000Z");
    const harness = controlledHarness(startedAt);
    const lobby = unwrap(
      await harness.service.createGame({
        actorId: alice.id,
        rated: false,
        timeControl: { kind: "timed", initialMs: 600_000, incrementMs: 5_000 },
      }),
    );
    const started = await harness.start(lobby.id);

    const deadlines = await harness.repository.listPendingDeadlines(2);
    expect(deadlines).toHaveLength(1);
    expect(deadlines[0]).toMatchObject({
      gameId: started.id,
      deadline: new Date(startedAt.getTime() + 600_000),
      serverNow: expect.any(Date),
    });
  });
});
