/**
 * Decision rules only. The fake repository below applies changes in memory, so
 * these tests pin who may do what and which code a refusal carries; locking,
 * revision arithmetic, and reconstruction are covered against real PostgreSQL
 * in `service.integration.test.ts`.
 */

import {
  allSquares,
  CELL_COUNT,
  gameResult,
  PLAYER_ONE,
  PLAYER_TWO,
  replay,
  type Square,
} from "@poe2/rules";
import { READY_CHECK_MS, UNTIMED, type GameSnapshot } from "@poe2/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeClock, createFakeScheduler } from "../limits/test-doubles.js";
import { createDeadlineService } from "./deadline-service.js";
import type { GameRepository } from "./repository.js";
import { createGameService, type GameService } from "./service.js";
import type { StoredGame } from "./snapshot.js";

const PLAYER_ONE_USER = { id: "e4aa457e-7620-4f14-ae26-6c20f3995ee1", username: "Player_One" };
const PLAYER_TWO_USER = { id: "1b5d1bfe-2d8c-4a0e-9d34-9ff5f2f0c8d3", username: "Player_Two" };
const STRANGER = { id: "d0f0a2ba-1ec1-4c02-9d9f-2b1d0a0b6a55", username: "Stranger" };
const GAME_ID = "6f1f4a52-3d6a-4a37-8f0d-1f1a0bb6b6c1";
const MISSING_GAME_ID = "9a3c9f5e-1f2b-4c3d-8e7f-0a1b2c3d4e5f";
const READY_GAME_ID = "2c9f0e1d-4a3b-4c5d-8e6f-7a8b9c0d1e2f";
const DECISION_AT = new Date("2026-08-04T10:05:00.000Z");

interface FakeRepository extends GameRepository {
  seed(game: StoredGame): void;
  current(gameId: string): StoredGame | undefined;
  setDecisionAt(value: Date): void;
}

function createFakeRepository(): FakeRepository {
  const games = new Map<string, StoredGame>();
  let created = 0;
  let decisionAt = DECISION_AT;

  return {
    seed(game) {
      games.set(game.id, game);
    },

    current: (gameId) => games.get(gameId),
    setDecisionAt(value) {
      decisionAt = value;
    },

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

    listFinishedGamesForUser: (userId, page) =>
      Promise.resolve(
        [...games.values()]
          .filter(
            (game) =>
              game.status === "finished" &&
              (game.playerOne.id === userId || game.playerTwo?.id === userId),
          )
          .slice(0, page.limit),
      ),

    findGame: (gameId) => Promise.resolve(games.get(gameId) ?? null),
    listPendingDeadlines: () => Promise.resolve([]),

    createWaitingGame(playerOneId, rated, timeControl, creatorSeat) {
      // Mirror the database's partial unique owner constraint.
      const alreadyWaiting = [...games.values()].some(
        (game) => game.status === "waiting" && game.playerOne.id === playerOneId,
      );

      if (alreadyWaiting) {
        return Promise.resolve({ ok: false, reason: "lobby_already_open" } as const);
      }

      created += 1;
      const game: StoredGame = {
        id: `00000000-0000-4000-8000-00000000000${created}`,
        playerOne: { id: playerOneId, username: "Player_One" },
        playerTwo: null,
        creatorId: playerOneId,
        creatorSeat,
        status: "waiting",
        rated,
        timeControl,
        readyCheckGeneration: 0,
        readyCheck: null,
        activatedRevision: null,
        clock: null,
        moveClocks: [],
        serverNow: decisionAt,
        revision: 0,
        moves: [],
        outcome: null,
        createdAt: new Date("2026-08-04T10:00:00.000Z"),
        updatedAt: new Date("2026-08-04T10:00:00.000Z"),
      };

      games.set(game.id, game);
      return Promise.resolve({ ok: true, game } as const);
    },

    updateGame(gameId, decide) {
      const existing = games.get(gameId) ?? null;
      const decision = decide(existing, decisionAt);

      if (!decision.ok && decision.change === undefined) {
        return Promise.resolve({ ok: false, error: decision.error });
      }
      if (existing === null) {
        throw new Error("the fake accepted a change to a game that does not exist");
      }

      const change = decision.change;
      if (change === null || change === undefined) {
        return Promise.resolve({ ok: true, game: existing, changed: false });
      }
      const revision = existing.revision + 1;
      const transition =
        change.kind === "start" ||
        change.kind === "move" ||
        change.kind === "resign" ||
        change.kind === "timeout"
          ? change.clock
          : null;
      const clock =
        transition === null
          ? null
          : transition.runningPlayer === null
            ? {
                state: "stopped" as const,
                playerOneRemainingMs: transition.playerOneRemainingMs,
                playerTwoRemainingMs: transition.playerTwoRemainingMs,
                stoppedAt: transition.stoppedAt ?? decisionAt,
              }
            : {
                state: "running" as const,
                playerOneRemainingMs: transition.playerOneRemainingMs,
                playerTwoRemainingMs: transition.playerTwoRemainingMs,
                runningPlayer: transition.runningPlayer,
                turnStartedAt: transition.turnStartedAt ?? decisionAt,
                deadline: transition.deadline ?? decisionAt,
              };
      const moveClocks =
        change.kind === "move" && change.clock !== null
          ? [
              ...existing.moveClocks,
              {
                ply: change.ply,
                acceptedAt: change.clock.acceptedAt,
                elapsedMs: change.clock.elapsedMs,
                incrementAppliedMs: change.clock.incrementAppliedMs,
                playerOneRemainingMs: change.clock.playerOneRemainingMs,
                playerTwoRemainingMs: change.clock.playerTwoRemainingMs,
              },
            ]
          : existing.moveClocks;

      const finish =
        change.kind === "move" || change.kind === "resign" || change.kind === "timeout"
          ? change.finished
          : null;
      const ending =
        finish === null
          ? { status: existing.status, outcome: null }
          : {
              status: "finished" as const,
              outcome: { ...finish, finishedAt: new Date("2026-08-04T11:00:00.000Z") },
            };

      let updated: StoredGame;
      if (change.kind === "join") {
        updated = {
          ...existing,
          playerTwo: PLAYER_TWO_USER,
          status: "ready_check",
          revision,
          readyCheckGeneration: existing.readyCheckGeneration + 1,
          readyCheck: {
            generation: existing.readyCheckGeneration + 1,
            playerOneReady: false,
            playerTwoReady: false,
            deadline: change.readyDeadline,
          },
          serverNow: decisionAt,
        };
      } else if (change.kind === "ready") {
        const check = existing.readyCheck;
        if (check === null) {
          throw new Error("the fake accepted a confirmation outside a ready check");
        }
        updated = {
          ...existing,
          revision,
          readyCheck: {
            ...check,
            ...(change.seat === PLAYER_ONE ? { playerOneReady: true } : { playerTwoReady: true }),
          },
          serverNow: decisionAt,
        };
      } else if (change.kind === "start") {
        updated = {
          ...existing,
          status: "active",
          revision,
          readyCheck: null,
          activatedRevision: revision,
          clock,
          serverNow: decisionAt,
        };
      } else if (change.kind === "abandon_ready") {
        updated = {
          ...existing,
          playerTwo: null,
          status: "waiting",
          revision,
          readyCheck: null,
          serverNow: decisionAt,
        };
      } else if (change.kind === "move") {
        updated = {
          ...existing,
          moves: [...existing.moves, change.square],
          revision,
          status: finish === null ? "active" : "finished",
          outcome: ending.outcome,
          clock,
          moveClocks,
          serverNow: decisionAt,
        };
      } else {
        updated = {
          ...existing,
          revision,
          status: "finished",
          outcome: ending.outcome,
          clock,
          serverNow: decisionAt,
        };
      }

      games.set(gameId, updated);
      if (!decision.ok) {
        return Promise.resolve({ ok: false, error: decision.error, committedGame: updated });
      }
      return Promise.resolve({ ok: true, game: updated, changed: true });
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
    creatorId: PLAYER_ONE_USER.id,
    creatorSeat: PLAYER_ONE,
    status: "active",
    rated: false,
    timeControl: { kind: "untimed", initialMs: null, incrementMs: null },
    readyCheckGeneration: 1,
    readyCheck: null,
    activatedRevision: 1,
    clock: null,
    moveClocks: [],
    serverNow: DECISION_AT,
    revision: moves.length + 1,
    moves,
    outcome: null,
    createdAt: new Date("2026-08-04T10:00:00.000Z"),
    updatedAt: new Date("2026-08-04T10:00:00.000Z"),
  };
}

function waitingGame(): StoredGame {
  return {
    ...activeGame(),
    playerTwo: null,
    status: "waiting",
    revision: 0,
    readyCheckGeneration: 0,
    activatedRevision: null,
  };
}

function readyCheckGame(
  overrides: {
    readonly playerOneReady?: boolean;
    readonly playerTwoReady?: boolean;
    readonly generation?: number;
  } = {},
): StoredGame {
  const generation = overrides.generation ?? 1;
  return {
    ...activeGame(),
    status: "ready_check",
    revision: 1,
    readyCheckGeneration: generation,
    activatedRevision: null,
    readyCheck: {
      generation,
      playerOneReady: overrides.playerOneReady ?? false,
      playerTwoReady: overrides.playerTwoReady ?? false,
      deadline: new Date(DECISION_AT.getTime() + READY_CHECK_MS),
    },
  };
}

function timedActiveGame(
  moves: readonly Square[] = [],
  options: {
    readonly playerOneRemainingMs?: number;
    readonly playerTwoRemainingMs?: number;
    readonly turnStartedAt?: Date;
  } = {},
): StoredGame {
  const base = activeGame(moves);
  const turnStartedAt = options.turnStartedAt ?? new Date("2026-08-04T10:00:00.000Z");
  const playerOneRemainingMs = options.playerOneRemainingMs ?? 300_000;
  const playerTwoRemainingMs = options.playerTwoRemainingMs ?? 300_000;
  const runningPlayer = moves.length % 2 === 0 ? PLAYER_ONE : PLAYER_TWO;
  const runningBalance = runningPlayer === PLAYER_ONE ? playerOneRemainingMs : playerTwoRemainingMs;

  return {
    ...base,
    timeControl: { kind: "timed", initialMs: 300_000, incrementMs: 3_000 },
    clock: {
      state: "running",
      playerOneRemainingMs,
      playerTwoRemainingMs,
      runningPlayer,
      turnStartedAt,
      deadline: new Date(turnStartedAt.getTime() + runningBalance),
    },
    serverNow: turnStartedAt,
  };
}

function timedReadyCheckGame(bothButOne = true): StoredGame {
  return {
    ...timedActiveGame(),
    status: "ready_check",
    revision: 1,
    activatedRevision: null,
    clock: null,
    readyCheck: {
      generation: 1,
      playerOneReady: bothButOne,
      playerTwoReady: false,
      deadline: new Date(DECISION_AT.getTime() + READY_CHECK_MS),
    },
  };
}

let repository: FakeRepository;
let service: GameService;

beforeEach(() => {
  repository = createFakeRepository();
  service = createGameService(repository);
});

describe("createGame", () => {
  it("opens a waiting lobby with the creator in the first seat", async () => {
    const result = await service.createGame({ actorId: PLAYER_ONE_USER.id, rated: false });

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

  it("refuses a second lobby while the first is still waiting", async () => {
    expect((await service.createGame({ actorId: PLAYER_ONE_USER.id, rated: false })).ok).toBe(true);

    const second = await service.createGame({ actorId: PLAYER_ONE_USER.id, rated: false });

    expect(second).toStrictEqual({ ok: false, code: "lobby_already_open" });
    expect(await service.listWaitingLobbies()).toHaveLength(1);
  });

  it("lets a different player open their own lobby", async () => {
    await service.createGame({ actorId: PLAYER_ONE_USER.id, rated: false });

    expect((await service.createGame({ actorId: PLAYER_TWO_USER.id, rated: false })).ok).toBe(true);
    expect(await service.listWaitingLobbies()).toHaveLength(2);
  });

  it("lets a player open a lobby again once the first is no longer waiting", async () => {
    const first = await service.createGame({ actorId: PLAYER_ONE_USER.id, rated: false });
    if (!first.ok) {
      throw new Error("expected the first lobby to open");
    }

    await service.joinGame({ actorId: PLAYER_TWO_USER.id, gameId: first.value.id });

    expect((await service.createGame({ actorId: PLAYER_ONE_USER.id, rated: false })).ok).toBe(true);
  });
});

describe("joinGame", () => {
  it("seats the joiner as Player 2 and opens a ready check", async () => {
    repository.seed(waitingGame());

    const result = await service.joinGame({ actorId: PLAYER_TWO_USER.id, gameId: GAME_ID });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.status).toBe("ready_check");
    expect(result.value.players.playerTwo?.id).toBe(PLAYER_TWO_USER.id);
    expect(result.value.sideToMove).toBeNull();
    expect(result.value.clock).toBeNull();
    expect(result.value.revision).toBe(1);
    expect(result.value.status === "ready_check" && result.value.readyCheck).toEqual({
      generation: 1,
      playerOneReady: false,
      playerTwoReady: false,
      deadline: new Date(DECISION_AT.getTime() + READY_CHECK_MS).toISOString(),
      serverNow: DECISION_AT.toISOString(),
    });

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

describe("the ready check", () => {
  it("records one confirmation without starting anything", async () => {
    repository.seed(readyCheckGame());

    const result = await service.readyGame({
      actorId: PLAYER_ONE_USER.id,
      gameId: GAME_ID,
      readyCheckGeneration: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "ready_check") {
      return;
    }

    expect(result.value.readyCheck).toMatchObject({
      playerOneReady: true,
      playerTwoReady: false,
    });
    expect(result.value.revision).toBe(2);
  });

  it("starts the game on the second confirmation, from either seat", async () => {
    repository.seed(readyCheckGame({ playerOneReady: true }));

    const result = await service.readyGame({
      actorId: PLAYER_TWO_USER.id,
      gameId: GAME_ID,
      readyCheckGeneration: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.status).toBe("active");
    expect(result.value.sideToMove).toBe(PLAYER_ONE);
    expect(result.value.readyCheck).toBeNull();
  });

  it("treats a repeated confirmation as the same confirmation", async () => {
    repository.seed(readyCheckGame({ playerOneReady: true }));

    const result = await service.readyGame({
      actorId: PLAYER_ONE_USER.id,
      gameId: GAME_ID,
      readyCheckGeneration: 1,
    });

    expect(result.ok && result.value.revision).toBe(1);
    expect(repository.current(GAME_ID)?.status).toBe("ready_check");
  });

  it.each([
    ["the player who joined", PLAYER_TWO_USER.id],
    ["the player who opened it", PLAYER_ONE_USER.id],
  ])("gives the seat back when %s leaves", async (_label, actorId) => {
    repository.seed(readyCheckGame());

    const result = await service.declineGame({ actorId, gameId: GAME_ID, readyCheckGeneration: 1 });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.game.status).toBe("waiting");
    expect(result.value.game.players.playerTwo).toBeNull();
    expect(result.value.game.outcome).toBeNull();
    expect(result.value.releasedPlayerId).toBe(PLAYER_TWO_USER.id);
    expect(await service.listWaitingLobbies()).toHaveLength(1);
  });

  it("refuses a confirmation from someone holding no seat", async () => {
    repository.seed(readyCheckGame());

    await expect(
      service.readyGame({
        actorId: STRANGER.id,
        gameId: GAME_ID,
        readyCheckGeneration: 1,
      }),
    ).resolves.toEqual({ ok: false, code: "not_a_player" });
  });

  it.each([
    ["a game nobody has joined", waitingGame, PLAYER_ONE_USER.id],
    ["a game already being played", activeGame, PLAYER_TWO_USER.id],
  ])("refuses a confirmation on %s", async (_label, fixture, actorId) => {
    repository.seed(fixture());

    await expect(
      service.readyGame({ actorId, gameId: GAME_ID, readyCheckGeneration: 1 }),
    ).resolves.toEqual({
      ok: false,
      code: "game_not_ready_check",
    });
  });

  it("refuses a confirmation that arrives after the check ran out", async () => {
    repository.seed(readyCheckGame());
    repository.setDecisionAt(new Date(DECISION_AT.getTime() + READY_CHECK_MS));

    await expect(
      service.readyGame({
        actorId: PLAYER_ONE_USER.id,
        gameId: GAME_ID,
        readyCheckGeneration: 1,
      }),
    ).resolves.toEqual({ ok: false, code: "game_not_ready_check" });
  });

  it("refuses a confirmation from an earlier ready-check generation", async () => {
    repository.seed(readyCheckGame({ generation: 2, playerTwoReady: true }));

    await expect(
      service.readyGame({
        actorId: PLAYER_ONE_USER.id,
        gameId: GAME_ID,
        readyCheckGeneration: 1,
      }),
    ).resolves.toEqual({ ok: false, code: "stale_game" });
    expect(repository.current(GAME_ID)?.status).toBe("ready_check");
  });

  it("refuses a move while both players are still confirming", async () => {
    repository.seed(readyCheckGame());

    await expect(
      service.playMove({
        actorId: PLAYER_ONE_USER.id,
        gameId: GAME_ID,
        expectedRevision: 1,
        square: { row: 3, col: 3 },
      }),
    ).resolves.toEqual({ ok: false, code: "not_your_turn" });
  });

  it("returns the reopened lobby through the deadline layer when the check runs out", async () => {
    repository.seed(readyCheckGame({ playerOneReady: true }));
    const deadline = new Date(DECISION_AT.getTime() + READY_CHECK_MS);
    repository.setDecisionAt(deadline);

    const processed = await service.processDeadline(GAME_ID, deadline);

    expect(processed.kind).toBe("abandoned");
    if (processed.kind !== "abandoned") {
      return;
    }
    expect(processed.game.status).toBe("waiting");
    expect(processed.releasedPlayerId).toBe(PLAYER_TWO_USER.id);
  });

  it("reschedules rather than reverting when the check has not run out yet", async () => {
    repository.seed(readyCheckGame());
    const deadline = new Date(DECISION_AT.getTime() + READY_CHECK_MS);

    const processed = await service.processDeadline(GAME_ID, deadline);

    expect(processed).toEqual({
      kind: "reschedule",
      gameId: GAME_ID,
      deadline,
      serverNow: DECISION_AT,
    });
  });

  it("starts both clocks at the confirmation, not at the join", async () => {
    repository.seed(timedReadyCheckGame());
    const startedAt = new Date(DECISION_AT.getTime() + 30_000);
    repository.setDecisionAt(startedAt);

    const result = await service.readyGame({
      actorId: PLAYER_TWO_USER.id,
      gameId: GAME_ID,
      readyCheckGeneration: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "active" || result.value.clock === null) {
      return;
    }

    expect(result.value.clock.remainingMs).toEqual({ playerOne: 300_000, playerTwo: 300_000 });
    expect(result.value.clock.runningPlayer).toBe(PLAYER_ONE);
    expect(result.value.clock.turnStartedAt).toBe(startedAt.toISOString());
    expect(result.value.clock.deadline).toBe(new Date(startedAt.getTime() + 300_000).toISOString());
  });

  it("leaves a timed game's clock alone while the check is still open", async () => {
    repository.seed(timedReadyCheckGame(false));

    const result = await service.readyGame({
      actorId: PLAYER_ONE_USER.id,
      gameId: GAME_ID,
      readyCheckGeneration: 1,
    });

    expect(result.ok && result.value.clock).toBeNull();
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
    expect(result.value.outcome?.reason).toBe("board_full");
    expect(result.value.outcome?.winner).toBe(
      replayed.ok ? gameResult(replayed.game)?.winner : null,
    );
    expect(result.value.moves).toHaveLength(CELL_COUNT);
  });
});

describe("resignGame", () => {
  it("ends the game with the opponent as the winner", async () => {
    const moves = allSquares().slice(0, 5);
    repository.seed(activeGame(moves));

    const result = await service.resignGame({
      actorId: PLAYER_TWO_USER.id,
      gameId: GAME_ID,
      expectedRevision: moves.length + 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.status).toBe("finished");
    expect(result.value.sideToMove).toBeNull();
    expect(result.value.outcome?.reason).toBe("resignation");
    expect(result.value.outcome?.winner).toBe(PLAYER_ONE);
    expect(result.value.moves).toHaveLength(moves.length);
  });

  it("lets the player to move resign as well as the one waiting", async () => {
    const moves = allSquares().slice(0, 5);
    repository.seed(activeGame(moves));

    const result = await service.resignGame({
      actorId: PLAYER_ONE_USER.id,
      gameId: GAME_ID,
      expectedRevision: moves.length + 1,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.outcome?.winner).toBe(PLAYER_TWO);
  });

  it("refuses a stranger, without telling them the revision", async () => {
    repository.seed(activeGame(allSquares().slice(0, 2)));

    const result = await service.resignGame({
      actorId: STRANGER.id,
      gameId: GAME_ID,
      expectedRevision: 999,
    });

    expect(result).toStrictEqual({ ok: false, code: "not_a_player" });
  });

  it("refuses a revision the game has moved past", async () => {
    const moves = allSquares().slice(0, 4);
    repository.seed(activeGame(moves));

    const result = await service.resignGame({
      actorId: PLAYER_ONE_USER.id,
      gameId: GAME_ID,
      expectedRevision: 1,
    });

    expect(result).toStrictEqual({ ok: false, code: "stale_game" });
  });

  it("refuses a waiting lobby, which is cancelled rather than resigned", async () => {
    repository.seed(waitingGame());

    const result = await service.resignGame({
      actorId: PLAYER_ONE_USER.id,
      gameId: GAME_ID,
      expectedRevision: 0,
    });

    expect(result).toStrictEqual({ ok: false, code: "not_your_turn" });
  });

  it("refuses a game that has already finished", async () => {
    const moves = allSquares().slice(0, 3);
    repository.seed({
      ...activeGame(moves),
      status: "finished",
      outcome: {
        reason: "resignation",
        winner: PLAYER_ONE,
        finishedAt: new Date("2026-08-04T11:00:00.000Z"),
      },
    });

    const result = await service.resignGame({
      actorId: PLAYER_TWO_USER.id,
      gameId: GAME_ID,
      expectedRevision: moves.length + 1,
    });

    expect(result).toStrictEqual({ ok: false, code: "game_over" });
  });

  it("refuses a game that does not exist", async () => {
    const result = await service.resignGame({
      actorId: PLAYER_ONE_USER.id,
      gameId: MISSING_GAME_ID,
      expectedRevision: 0,
    });

    expect(result).toStrictEqual({ ok: false, code: "game_not_found" });
  });
});

describe("listOpenGames", () => {
  it("returns every unfinished game the user holds a seat in", async () => {
    repository.seed(waitingGame());
    repository.seed({ ...activeGame(), id: MISSING_GAME_ID });
    repository.seed({ ...readyCheckGame(), id: READY_GAME_ID });

    const mine = await service.listOpenGames(PLAYER_ONE_USER.id);

    expect(mine.map((game) => game.status)).toEqual(["waiting", "active", "ready_check"]);
    expect(await service.listOpenGames(STRANGER.id)).toEqual([]);
  });
});

describe("timed games", () => {
  it.each([
    ["no clock", UNTIMED],
    ["a clock nobody preset", { kind: "timed", initialMs: 137_000, incrementMs: 7_000 } as const],
    ["a clock with no increment", { kind: "timed", initialMs: 60_000, incrementMs: 0 } as const],
  ] as const)("persists %s exactly as asked when a lobby opens", async (_label, timeControl) => {
    const result = await service.createGame({
      actorId: PLAYER_ONE_USER.id,
      rated: false,
      timeControl,
    });

    expect(result.ok && result.value.timeControl).toEqual(timeControl);
    expect(result.ok && result.value.clock).toBeNull();
  });

  it("refuses a rated game with no clock", async () => {
    await expect(
      service.createGame({ actorId: PLAYER_ONE_USER.id, rated: true, timeControl: UNTIMED }),
    ).resolves.toEqual({ ok: false, code: "rated_requires_clock" });

    expect(await service.listWaitingLobbies()).toEqual([]);
  });

  it("opens a rated game that has a clock", async () => {
    const result = await service.createGame({
      actorId: PLAYER_ONE_USER.id,
      rated: true,
      timeControl: { kind: "timed", initialMs: 300_000, incrementMs: 3_000 },
    });

    expect(result.ok && result.value.rated).toBe(true);
  });

  it("returns an autonomous timeout through the deadline layer for transport fan-out", async () => {
    const game = timedActiveGame();
    repository.seed(game);
    if (game.clock?.state !== "running") {
      throw new Error("expected a running clock");
    }
    repository.setDecisionAt(game.clock.deadline);

    const monotonicClock = createFakeClock();
    const scheduler = createFakeScheduler();
    const onFinished = vi.fn<(snapshot: GameSnapshot) => void>();
    let supervisedService: GameService;
    const deadlines = createDeadlineService({
      capacity: 1,
      clock: monotonicClock,
      scheduler,
      process: (gameId, expectedDeadline) =>
        supervisedService.processDeadline(gameId, expectedDeadline),
      onFinished,
      onAbandoned: vi.fn(),
    });
    supervisedService = createGameService(repository, deadlines);
    deadlines.restore([
      {
        gameId: game.id,
        deadline: game.clock.deadline,
        serverNow: game.clock.turnStartedAt,
      },
    ]);

    monotonicClock.advance(game.clock.deadline.getTime() - game.clock.turnStartedAt.getTime());
    scheduler.fireAll();

    await vi.waitFor(() => {
      expect(onFinished).toHaveBeenCalledTimes(1);
    });
    expect(onFinished.mock.calls[0]?.[0]).toMatchObject({
      id: game.id,
      status: "finished",
      outcome: { reason: "timeout", winner: PLAYER_TWO },
      clock: { remainingMs: { playerOne: 0, playerTwo: 300_000 } },
    });
    expect(deadlines.activeCount()).toBe(0);
    expect(scheduler.pending()).toEqual([]);
  });

  it("accepts one millisecond before the deadline and applies Fischer increment", async () => {
    const game = timedActiveGame([], {
      playerOneRemainingMs: 10_000,
      playerTwoRemainingMs: 300_000,
    });
    repository.seed(game);
    repository.setDecisionAt(
      new Date(game.clock?.state === "running" ? game.clock.deadline.getTime() - 1 : 0),
    );

    const result = await service.playMove({
      actorId: PLAYER_ONE_USER.id,
      gameId: GAME_ID,
      expectedRevision: 1,
      square: { row: 0, col: 0 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "active" || result.value.clock === null) {
      return;
    }
    expect(result.value.clock.remainingMs).toEqual({ playerOne: 3_001, playerTwo: 300_000 });
    expect(result.value.clock.runningPlayer).toBe(PLAYER_TWO);
    expect(repository.current(GAME_ID)?.moveClocks[0]).toMatchObject({
      elapsedMs: 9_999,
      incrementAppliedMs: 3_000,
      playerOneRemainingMs: 3_001,
    });
  });

  it("treats exact deadline equality as timeout before the attempted move", async () => {
    const game = timedActiveGame([], { playerOneRemainingMs: 10_000 });
    repository.seed(game);
    if (game.clock?.state !== "running") {
      throw new Error("expected a running clock");
    }
    repository.setDecisionAt(game.clock.deadline);

    const result = await service.playMove({
      actorId: PLAYER_ONE_USER.id,
      gameId: GAME_ID,
      expectedRevision: 1,
      square: { row: 0, col: 0 },
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe("game_over");
    expect(!result.ok && result.committed?.status).toBe("finished");
    expect(!result.ok && result.committed?.outcome?.reason).toBe("timeout");
    expect(!result.ok && result.committed?.outcome?.winner).toBe(PLAYER_TWO);
    expect(!result.ok && result.committed?.moves).toEqual([]);
    expect(!result.ok && result.committed?.clock?.remainingMs.playerOne).toBe(0);
    const committed = !result.ok ? result.committed : undefined;
    expect(committed?.status === "finished" ? committed.clock?.stoppedAt : undefined).toBe(
      game.clock.deadline.toISOString(),
    );
  });

  it("applies the final move's increment before stopping a full-board clock", async () => {
    const moves = allSquares();
    const played = moves.slice(0, CELL_COUNT - 1);
    const last = moves.at(-1);
    if (last === undefined) {
      throw new Error("expected a last square");
    }
    const game = timedActiveGame(played, { playerOneRemainingMs: 20_000 });
    repository.seed(game);
    if (game.clock?.state !== "running") {
      throw new Error("expected a running clock");
    }
    repository.setDecisionAt(new Date(game.clock.turnStartedAt.getTime() + 5_000));

    const result = await service.playMove({
      actorId: PLAYER_ONE_USER.id,
      gameId: GAME_ID,
      expectedRevision: CELL_COUNT,
      square: last,
    });

    expect(result.ok && result.value.status).toBe("finished");
    expect(result.ok && result.value.clock?.remainingMs.playerOne).toBe(18_000);
    expect(repository.current(GAME_ID)?.moveClocks.at(-1)).toMatchObject({
      elapsedMs: 5_000,
      incrementAppliedMs: 3_000,
      playerOneRemainingMs: 18_000,
    });
  });

  it("charges the running clock on resignation without applying increment", async () => {
    const game = timedActiveGame();
    repository.seed(game);
    if (game.clock?.state !== "running") {
      throw new Error("expected a running clock");
    }
    const resignedAt = new Date(game.clock.turnStartedAt.getTime() + 5_000);
    repository.setDecisionAt(resignedAt);

    const result = await service.resignGame({
      actorId: PLAYER_TWO_USER.id,
      gameId: GAME_ID,
      expectedRevision: 1,
    });

    expect(result.ok && result.value.clock?.remainingMs).toEqual({
      playerOne: 295_000,
      playerTwo: 300_000,
    });
    expect(
      result.ok && result.value.status === "finished" ? result.value.clock?.stoppedAt : null,
    ).toBe(resignedAt.toISOString());
    expect(repository.current(GAME_ID)?.moveClocks).toEqual([]);
  });
});
