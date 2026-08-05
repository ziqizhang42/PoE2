/**
 * Decision rules only. The fake repository below applies changes in memory, so
 * these tests pin who may do what and which code a refusal carries; locking,
 * revision arithmetic, and reconstruction are covered against real PostgreSQL
 * in `service.integration.test.ts`.
 */

import { allSquares, CELL_COUNT, gameResult, replay, type Square } from "@poe2/rules";
import { beforeEach, describe, expect, it } from "vitest";

import type { GameRepository } from "./repository.js";
import { createGameService, type GameService } from "./service.js";
import type { StoredGame } from "./snapshot.js";

const PLAYER_ONE_USER = { id: "e4aa457e-7620-4f14-ae26-6c20f3995ee1", username: "Player_One" };
const PLAYER_TWO_USER = { id: "1b5d1bfe-2d8c-4a0e-9d34-9ff5f2f0c8d3", username: "Player_Two" };
const STRANGER = { id: "d0f0a2ba-1ec1-4c02-9d9f-2b1d0a0b6a55", username: "Stranger" };
const GAME_ID = "6f1f4a52-3d6a-4a37-8f0d-1f1a0bb6b6c1";
const MISSING_GAME_ID = "9a3c9f5e-1f2b-4c3d-8e7f-0a1b2c3d4e5f";

interface FakeRepository extends GameRepository {
  seed(game: StoredGame): void;
  current(gameId: string): StoredGame | undefined;
}

function createFakeRepository(): FakeRepository {
  const games = new Map<string, StoredGame>();
  let created = 0;

  return {
    seed(game) {
      games.set(game.id, game);
    },

    current: (gameId) => games.get(gameId),

    listWaitingGames: () =>
      Promise.resolve([...games.values()].filter((game) => game.status === "waiting")),

    listOpenGamesForUser: (userId) =>
      Promise.resolve(
        [...games.values()].filter(
          (game) =>
            game.status !== "finished" &&
            (game.playerOne.id === userId || game.playerTwo?.id === userId),
        ),
      ),

    findGame: (gameId) => Promise.resolve(games.get(gameId) ?? null),

    createWaitingGame(playerOneId) {
      created += 1;
      const game: StoredGame = {
        id: `00000000-0000-4000-8000-00000000000${created}`,
        playerOne: { id: playerOneId, username: "Player_One" },
        playerTwo: null,
        status: "waiting",
        revision: 0,
        moves: [],
        createdAt: new Date("2026-08-04T10:00:00.000Z"),
        updatedAt: new Date("2026-08-04T10:00:00.000Z"),
      };

      games.set(game.id, game);
      return Promise.resolve(game);
    },

    updateGame(gameId, decide) {
      const existing = games.get(gameId) ?? null;
      const decision = decide(existing);

      if (!decision.ok) {
        return Promise.resolve({ ok: false, error: decision.error });
      }
      if (existing === null) {
        throw new Error("the fake accepted a change to a game that does not exist");
      }

      const change = decision.change;
      const updated: StoredGame =
        change.kind === "join"
          ? {
              ...existing,
              playerTwo: PLAYER_TWO_USER,
              status: "active",
              revision: existing.revision + 1,
            }
          : {
              ...existing,
              moves: [...existing.moves, change.square],
              status: change.finished ? "finished" : "active",
              revision: existing.revision + 1,
            };

      games.set(gameId, updated);
      return Promise.resolve({ ok: true, game: updated });
    },

    removeGame(gameId, decide) {
      const decision = decide(games.get(gameId) ?? null);

      if (decision.ok) {
        games.delete(gameId);
      }

      return Promise.resolve(decision);
    },
  };
}

function activeGame(moves: readonly Square[] = []): StoredGame {
  return {
    id: GAME_ID,
    playerOne: PLAYER_ONE_USER,
    playerTwo: PLAYER_TWO_USER,
    status: "active",
    revision: moves.length + 1,
    moves,
    createdAt: new Date("2026-08-04T10:00:00.000Z"),
    updatedAt: new Date("2026-08-04T10:00:00.000Z"),
  };
}

function waitingGame(): StoredGame {
  return { ...activeGame(), playerTwo: null, status: "waiting", revision: 0 };
}

let repository: FakeRepository;
let service: GameService;

beforeEach(() => {
  repository = createFakeRepository();
  service = createGameService(repository);
});

describe("createGame", () => {
  it("opens a waiting lobby with the creator in the first seat", async () => {
    const result = await service.createGame(PLAYER_ONE_USER.id);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.status).toBe("waiting");
    expect(result.value.revision).toBe(0);
    expect(result.value.players.playerOne.id).toBe(PLAYER_ONE_USER.id);
    expect(result.value.players.playerTwo).toBeNull();
    expect(result.value.sideToMove).toBeNull();
    expect(await service.listWaitingLobbies()).toHaveLength(1);
  });
});

describe("joinGame", () => {
  it("seats the joiner as Player 2 and activates the game", async () => {
    repository.seed(waitingGame());

    const result = await service.joinGame({ actorId: PLAYER_TWO_USER.id, gameId: GAME_ID });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.status).toBe("active");
    expect(result.value.players.playerTwo?.id).toBe(PLAYER_TWO_USER.id);
    expect(result.value.sideToMove).toBe(1);
    expect(result.value.revision).toBe(1);
    expect(await service.listWaitingLobbies()).toEqual([]);
  });

  it("refuses to let the creator join their own lobby", async () => {
    repository.seed(waitingGame());

    await expect(
      service.joinGame({ actorId: PLAYER_ONE_USER.id, gameId: GAME_ID }),
    ).resolves.toEqual({ ok: false, code: "cannot_join_own_game" });
    expect(repository.current(GAME_ID)?.status).toBe("waiting");
  });

  it("refuses a game that already has two players", async () => {
    repository.seed(activeGame());

    await expect(service.joinGame({ actorId: STRANGER.id, gameId: GAME_ID })).resolves.toEqual({
      ok: false,
      code: "game_not_waiting",
    });
  });

  it("refuses an unknown game", async () => {
    await expect(
      service.joinGame({ actorId: PLAYER_TWO_USER.id, gameId: MISSING_GAME_ID }),
    ).resolves.toEqual({ ok: false, code: "game_not_found" });
  });
});

describe("cancelGame", () => {
  it("withdraws the owner's waiting lobby", async () => {
    repository.seed(waitingGame());

    await expect(
      service.cancelGame({ actorId: PLAYER_ONE_USER.id, gameId: GAME_ID }),
    ).resolves.toEqual({ ok: true, value: { gameId: GAME_ID } });
    expect(repository.current(GAME_ID)).toBeUndefined();
  });

  it("refuses anyone who did not open the lobby", async () => {
    repository.seed(waitingGame());

    await expect(service.cancelGame({ actorId: STRANGER.id, gameId: GAME_ID })).resolves.toEqual({
      ok: false,
      code: "not_lobby_owner",
    });
    expect(repository.current(GAME_ID)).toBeDefined();
  });

  it("refuses to withdraw a game that is already being played", async () => {
    repository.seed(activeGame());

    await expect(
      service.cancelGame({ actorId: PLAYER_ONE_USER.id, gameId: GAME_ID }),
    ).resolves.toEqual({ ok: false, code: "game_not_waiting" });
    expect(repository.current(GAME_ID)).toBeDefined();
  });

  it("refuses an unknown game", async () => {
    await expect(
      service.cancelGame({ actorId: PLAYER_ONE_USER.id, gameId: MISSING_GAME_ID }),
    ).resolves.toEqual({ ok: false, code: "game_not_found" });
  });
});

describe("playMove", () => {
  const square = { row: 3, col: 3 };

  it("accepts the side to move and bumps the revision once", async () => {
    repository.seed(activeGame());

    const result = await service.playMove({
      actorId: PLAYER_ONE_USER.id,
      gameId: GAME_ID,
      expectedRevision: 1,
      square,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.revision).toBe(2);
    expect(result.value.moves).toEqual([square]);
    expect(result.value.sideToMove).toBe(2);
    expect(result.value.board[3 * 7 + 3]).toBe(1);
  });

  it("refuses a player who holds no seat", async () => {
    repository.seed(activeGame());

    await expect(
      service.playMove({ actorId: STRANGER.id, gameId: GAME_ID, expectedRevision: 1, square }),
    ).resolves.toEqual({ ok: false, code: "not_a_player" });
    expect(repository.current(GAME_ID)?.moves).toEqual([]);
  });

  it("refuses the player whose turn it is not", async () => {
    repository.seed(activeGame());

    await expect(
      service.playMove({
        actorId: PLAYER_TWO_USER.id,
        gameId: GAME_ID,
        expectedRevision: 1,
        square,
      }),
    ).resolves.toEqual({ ok: false, code: "not_your_turn" });
  });

  it("refuses to play a lobby that nobody has joined", async () => {
    repository.seed(waitingGame());

    await expect(
      service.playMove({
        actorId: PLAYER_ONE_USER.id,
        gameId: GAME_ID,
        expectedRevision: 0,
        square,
      }),
    ).resolves.toEqual({ ok: false, code: "not_your_turn" });
    expect(repository.current(GAME_ID)?.status).toBe("waiting");
  });

  it("refuses a revision the game has already moved past", async () => {
    repository.seed(activeGame());

    await expect(
      service.playMove({
        actorId: PLAYER_ONE_USER.id,
        gameId: GAME_ID,
        expectedRevision: 0,
        square,
      }),
    ).resolves.toEqual({ ok: false, code: "stale_game" });
    expect(repository.current(GAME_ID)?.revision).toBe(1);
  });

  it("checks the seat before the revision, so a stranger learns nothing", async () => {
    repository.seed(activeGame());

    await expect(
      service.playMove({ actorId: STRANGER.id, gameId: GAME_ID, expectedRevision: 999, square }),
    ).resolves.toEqual({ ok: false, code: "not_a_player" });
  });

  it("refuses an occupied square", async () => {
    repository.seed(activeGame([square]));

    await expect(
      service.playMove({
        actorId: PLAYER_TWO_USER.id,
        gameId: GAME_ID,
        expectedRevision: 2,
        square,
      }),
    ).resolves.toEqual({ ok: false, code: "occupied" });
  });

  it("refuses to move in a finished game", async () => {
    const moves = allSquares().slice(0, CELL_COUNT);
    repository.seed({ ...activeGame(moves), status: "finished" });

    await expect(
      service.playMove({
        actorId: PLAYER_ONE_USER.id,
        gameId: GAME_ID,
        expectedRevision: CELL_COUNT + 1,
        square: { row: 0, col: 0 },
      }),
    ).resolves.toEqual({ ok: false, code: "game_over" });
  });

  it("refuses an unknown game", async () => {
    await expect(
      service.playMove({
        actorId: PLAYER_ONE_USER.id,
        gameId: MISSING_GAME_ID,
        expectedRevision: 0,
        square,
      }),
    ).resolves.toEqual({ ok: false, code: "game_not_found" });
  });

  it("finishes the game on the 49th move with the result the rules produce", async () => {
    const moves = allSquares();
    const played = moves.slice(0, CELL_COUNT - 1);
    const last = moves[CELL_COUNT - 1];

    if (last === undefined) {
      throw new Error("expected a final square");
    }

    repository.seed(activeGame(played));

    // 48 moves played, so Player 1 takes the 49th.
    const result = await service.playMove({
      actorId: PLAYER_ONE_USER.id,
      gameId: GAME_ID,
      expectedRevision: CELL_COUNT,
      square: last,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const replayed = replay(moves);
    expect(replayed.ok).toBe(true);

    expect(result.value.status).toBe("finished");
    expect(result.value.sideToMove).toBeNull();
    expect(result.value.result).toEqual(replayed.ok ? gameResult(replayed.game) : null);
    expect(result.value.moves).toHaveLength(CELL_COUNT);
  });
});

describe("listOpenGames", () => {
  it("returns waiting and active games the user holds a seat in", async () => {
    repository.seed(waitingGame());
    repository.seed({ ...activeGame(), id: MISSING_GAME_ID });

    const mine = await service.listOpenGames(PLAYER_TWO_USER.id);

    expect(mine.map((game) => game.id)).toEqual([MISSING_GAME_ID]);
    expect(await service.listOpenGames(STRANGER.id)).toEqual([]);
  });
});
