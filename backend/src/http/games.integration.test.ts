import {
  AuthSessionResponseSchema,
  GameReplaySchema,
  UNTIMED,
  type AuthUser,
  type TimeControl,
} from "@poe2/protocol";
import { allSquares } from "@poe2/rules";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createKdfExecutor } from "../auth/kdf-executor.js";
import { createPasswordHasher } from "../auth/password.js";
import { createAuthRepository } from "../auth/repository.js";
import { createAuthService } from "../auth/service.js";
import { buildApp } from "../app.js";
import { readAuthConfig } from "../config/auth.js";
import { readDatabaseConfig } from "../config/database.js";
import { createDatabaseClient } from "../db/client.js";
import { users } from "../db/schema.js";
import { createHistoryService } from "../game/history-service.js";
import { createGameRepository } from "../game/repository.js";
import { createGameService } from "../game/service.js";
import { unlimited } from "../limits/rate-limiter.js";
import { createRatingLedger } from "../rating/ledger.js";
import { createRatingReader } from "../rating/reader.js";
import { authPlugin } from "./auth.js";
import { gamesPlugin } from "./games.js";

const PASSWORD = "correct horse battery staple";
const MISSING_GAME_ID = "9a3c9f5e-1f2b-4c3d-8e7f-0a1b2c3d4e5f";

const database = createDatabaseClient(readDatabaseConfig(process.env));
const authConfig = readAuthConfig({ NODE_ENV: "test" });
const authService = createAuthService(
  createAuthRepository(database.db),
  createPasswordHasher(createKdfExecutor({ maxConcurrent: 2, maxQueued: 16 })),
);

const ratingLedger = createRatingLedger();
const repository = createGameRepository(database.db, {
  onGameFinished: async (executor, game, finish) => {
    if (!game.rated || game.playerTwo === null) {
      return;
    }

    await ratingLedger.applyFinishedGame(executor, {
      gameId: game.id,
      playerOneId: game.playerOne.id,
      playerTwoId: game.playerTwo.id,
      winner: finish.winner,
    });
  },
});
const gameService = createGameService(repository);

const app = buildApp();
app.register(authPlugin, { ...authConfig, service: authService });
app.register(gamesPlugin, {
  historyService: createHistoryService(repository, createRatingReader(database.db)),
  readLimiter: unlimited,
});

await app.ready();

let addressCounter = 0;

function nextAddress(): string {
  addressCounter += 1;
  return `10.1.${Math.floor(addressCounter / 250)}.${addressCounter % 250}`;
}

interface Account {
  readonly user: AuthUser;
  readonly cookie: string;
}

let alice: Account;
let bob: Account;
let carol: Account;

beforeEach(async () => {
  await database.db.delete(users);
  alice = await register("Alice");
  bob = await register("Bob");
  carol = await register("Carol");
});

afterAll(async () => {
  await app.close();
  await database.close();
});

async function register(username: string): Promise<Account> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { username, password: PASSWORD },
    remoteAddress: nextAddress(),
  });

  expect(response.statusCode).toBe(201);

  const header = response.headers["set-cookie"];
  const cookie = (Array.isArray(header) ? header[0] : header)?.split(";")[0];
  if (cookie === undefined) {
    throw new Error("expected a session cookie");
  }

  return { user: AuthSessionResponseSchema.parse(response.json()).user, cookie };
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; code: string }): T {
  if (!result.ok) {
    throw new Error(`expected the operation to succeed, got ${result.code}`);
  }

  return result.value;
}

const RATED_CONTROL: TimeControl = { kind: "timed", initialMs: 600_000, incrementMs: 5_000 };

function controlFor(rated: boolean): TimeControl {
  return rated ? RATED_CONTROL : UNTIMED;
}

async function confirmBoth(gameId: string, owner: Account, opponent: Account) {
  const joined = unwrap(await gameService.joinGame({ actorId: opponent.user.id, gameId }));
  if (joined.status !== "ready_check") {
    throw new Error(`expected a ready check, got ${joined.status}`);
  }
  const readyCheckGeneration = joined.readyCheck.generation;
  unwrap(await gameService.readyGame({ actorId: owner.user.id, gameId, readyCheckGeneration }));
  return unwrap(
    await gameService.readyGame({ actorId: opponent.user.id, gameId, readyCheckGeneration }),
  );
}

async function playAndResign(owner: Account, opponent: Account, rated = false): Promise<string> {
  const lobby = unwrap(
    await gameService.createGame({ actorId: owner.user.id, rated, timeControl: controlFor(rated) }),
  );
  const active = await confirmBoth(lobby.id, owner, opponent);

  unwrap(
    await gameService.resignGame({
      actorId: owner.user.id,
      gameId: active.id,
      expectedRevision: active.revision,
    }),
  );

  return active.id;
}

async function playToTheEnd(owner: Account, opponent: Account, rated = false): Promise<string> {
  const lobby = unwrap(
    await gameService.createGame({ actorId: owner.user.id, rated, timeControl: controlFor(rated) }),
  );
  const active = await confirmBoth(lobby.id, owner, opponent);

  let revision = active.revision;
  for (const [index, square] of allSquares().entries()) {
    const actor = index % 2 === 0 ? owner : opponent;
    revision = unwrap(
      await gameService.playMove({
        actorId: actor.user.id,
        gameId: active.id,
        expectedRevision: revision,
        square,
      }),
    ).revision;
  }

  return active.id;
}

function get(url: string, cookie?: string) {
  return app.inject({
    method: "GET",
    url,
    ...(cookie === undefined ? {} : { headers: { cookie } }),
  });
}

describe("GET /api/games/:gameId", () => {
  it("returns the full canonical move record", async () => {
    const gameId = await playToTheEnd(alice, bob, true);

    const response = await get(`/api/games/${gameId}`, alice.cookie);

    expect(response.statusCode).toBe(200);
    const game = GameReplaySchema.parse(response.json());
    expect(game.id).toBe(gameId);
    expect(game.moves).toHaveLength(49);
    expect(game.players).toEqual({ playerOne: alice.user, playerTwo: bob.user });
    expect(game.rated).toBe(true);
    expect(game.outcome.reason).toBe("board_full");
  });

  it("reads the same for a stranger, a participant and a signed-out visitor", async () => {
    const gameId = await playAndResign(alice, bob);

    const participant = await get(`/api/games/${gameId}`, alice.cookie);
    const stranger = await get(`/api/games/${gameId}`, carol.cookie);
    const anonymous = await get(`/api/games/${gameId}`);

    expect(participant.statusCode).toBe(200);
    expect(stranger.statusCode).toBe(200);
    expect(anonymous.statusCode).toBe(200);
    expect(stranger.json()).toEqual(participant.json());
    expect(anonymous.json()).toEqual(participant.json());
  });

  it("does not serve a game that is still being played, even to its players", async () => {
    const lobby = unwrap(await gameService.createGame({ actorId: alice.user.id, rated: false }));
    const active = unwrap(await gameService.joinGame({ actorId: bob.user.id, gameId: lobby.id }));

    expect((await get(`/api/games/${active.id}`, alice.cookie)).statusCode).toBe(404);
    expect((await get(`/api/games/${active.id}`)).statusCode).toBe(404);
  });

  it("answers a game in play exactly as it answers a missing one", async () => {
    const lobby = unwrap(await gameService.createGame({ actorId: alice.user.id, rated: false }));
    const active = unwrap(await gameService.joinGame({ actorId: bob.user.id, gameId: lobby.id }));

    const playing = await get(`/api/games/${active.id}`);
    const missing = await get(`/api/games/${MISSING_GAME_ID}`);

    expect(playing.statusCode).toBe(404);
    expect(playing.json()).toEqual(missing.json());
  });

  it("refuses an id that is not a game id", async () => {
    expect((await get("/api/games/not-a-uuid")).statusCode).toBe(400);
  });
});
