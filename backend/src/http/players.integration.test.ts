import {
  GameHistoryPageSchema,
  HISTORY_PAGE_LIMIT,
  normalizeUsername,
  PlayerDirectorySchema,
  PublicPlayerProfileSchema,
} from "@poe2/protocol";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import type { AuthService } from "../auth/service.js";
import { readDatabaseConfig } from "../config/database.js";
import { createDatabaseClient } from "../db/client.js";
import { games, ratingEvents, users } from "../db/schema.js";
import { createHistoryService } from "../game/history-service.js";
import { createGameRepository } from "../game/repository.js";
import { unlimited, type RateLimiter } from "../limits/rate-limiter.js";
import { createPlayerRepository } from "../player/repository.js";
import { createRatingReader } from "../rating/reader.js";
import { playersPlugin } from "./players.js";

const database = createDatabaseClient(readDatabaseConfig(process.env));
let aliceId = "";
let bobId = "";
const consumedKeys: string[] = [];
let refuse = false;
const limiter: RateLimiter = {
  consume(key) {
    consumedKeys.push(key);
    return Promise.resolve(
      refuse ? { allowed: false, retryAfterMs: 1_500 } : { allowed: true, retryAfterMs: 0 },
    );
  },
};
const directoryConsumedKeys: string[] = [];
let refuseDirectory = false;
const directoryLimiter: RateLimiter = {
  consume(key) {
    directoryConsumedKeys.push(key);
    return Promise.resolve(
      refuseDirectory
        ? { allowed: false, retryAfterMs: 1_500 }
        : { allowed: true, retryAfterMs: 0 },
    );
  },
};

const sessionService: AuthService = {
  register: async () => ({ ok: false, code: "username_taken" }),
  login: async () => ({ ok: false, code: "invalid_credentials" }),
  authenticateSession: async (token) =>
    token === "valid-session" && aliceId.length > 0 ? { id: aliceId, username: "Alice_One" } : null,
  logout: async () => {},
};

const app = buildApp({ trustProxy: 1 });
const playerRepository = createPlayerRepository(database.db);
app.register(playersPlugin, {
  repository: playerRepository,
  historyService: createHistoryService(
    createGameRepository(database.db),
    createRatingReader(database.db),
  ),
  session: { sessionCookieName: "test_session", authService: sessionService },
  directoryLimiter,
  readLimiter: limiter,
  historyLimiter: unlimited,
});
await app.ready();

beforeEach(async () => {
  refuse = false;
  refuseDirectory = false;
  consumedKeys.length = 0;
  directoryConsumedKeys.length = 0;
  await database.db.delete(users);

  const inserted = await database.db
    .insert(users)
    .values([
      {
        username: "Alice_One",
        normalizedUsername: normalizeUsername("Alice_One"),
        passwordHash: "not-used-by-this-public-route",
        rating: 1512.6,
        ratingDeviation: 87.4,
        volatility: 0.07,
        // Ladder membership is based on rated games, not deviation.
        ratedGamesPlayed: 4,
      },
      {
        username: "Bob_Two",
        normalizedUsername: normalizeUsername("Bob_Two"),
        passwordHash: "also-private",
      },
    ])
    .returning({ id: users.id, username: users.username });

  aliceId = inserted.find((row) => row.username === "Alice_One")?.id ?? "";
  bobId = inserted.find((row) => row.username === "Bob_Two")?.id ?? "";
  if (aliceId.length === 0 || bobId.length === 0) {
    throw new Error("expected both profile fixtures to be inserted");
  }

  const finishedAt = new Date("2026-08-04T11:00:00.000Z");
  await database.db.insert(games).values([
    {
      playerOneId: aliceId,
      creatorId: aliceId,
      playerTwoId: bobId,
      status: "finished",
      revision: 1,
      activatedRevision: 1,
      rated: true,
      initialTimeMs: 300_000,
      incrementMs: 3_000,
      playerOneRemainingMs: 210_000,
      playerTwoRemainingMs: 180_000,
      clockStoppedAt: finishedAt,
      finishedAt,
      outcomeReason: "board_full",
      winner: 1,
    },
    {
      playerOneId: bobId,
      creatorId: bobId,
      playerTwoId: aliceId,
      status: "finished",
      revision: 1,
      activatedRevision: 1,
      rated: false,
      finishedAt,
      outcomeReason: "resignation",
      winner: 1,
    },
    {
      playerOneId: aliceId,
      creatorId: aliceId,
      playerTwoId: bobId,
      status: "finished",
      revision: 1,
      activatedRevision: 1,
      rated: true,
      initialTimeMs: 180_000,
      incrementMs: 2_000,
      playerOneRemainingMs: 0,
      playerTwoRemainingMs: 75_000,
      clockStoppedAt: finishedAt,
      finishedAt,
      outcomeReason: "timeout",
      winner: 2,
    },
  ]);
});

afterAll(async () => {
  await app.close();
  await database.close();
});

describe("GET /api/players", () => {
  const requestDirectory = (cookie = "test_session=valid-session") =>
    app.inject({ method: "GET", url: "/api/players", headers: { cookie } });

  it("requires a valid session before it reads or spends directory capacity", async () => {
    const missing = await app.inject({ method: "GET", url: "/api/players" });
    const invalid = await requestDirectory("test_session=invalid");

    expect(missing.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(401);
    expect(missing.json()).toEqual({ code: "unauthenticated", message: "Authentication required" });
    expect(directoryConsumedKeys).toEqual([]);

    const valid = await requestDirectory();
    expect(valid.statusCode).toBe(200);
    expect(PlayerDirectorySchema.safeParse(valid.json()).success).toBe(true);
  });

  it("sorts by rounded rating and then username, while fixing unrated display at 1500", async () => {
    await database.db
      .update(users)
      .set({ rating: 1_900, ratedGamesPlayed: 0 })
      .where(eq(users.id, bobId));
    await database.db.insert(users).values([
      {
        username: "Zoe_Rated",
        normalizedUsername: "zoe_rated",
        passwordHash: "private-zoe",
        rating: 1_600.1,
        ratedGamesPlayed: 1,
      },
      {
        username: "Amy_Rated",
        normalizedUsername: "amy_rated",
        passwordHash: "private-amy",
        rating: 1_599.6,
        ratedGamesPlayed: 1,
      },
    ]);

    const directory = PlayerDirectorySchema.parse((await requestDirectory()).json());

    expect(directory.map((player) => [player.username, player.rating])).toEqual([
      ["Amy_Rated", 1600],
      ["Zoe_Rated", 1600],
      ["Alice_One", 1513],
      ["Bob_Two", 1500],
    ]);
  });

  it("estimates an unrated color at 1500 among rated players", async () => {
    await database.db
      .update(users)
      .set({ rating: 1_400, ratedGamesPlayed: 1 })
      .where(eq(users.id, aliceId));
    await database.db.insert(users).values({
      username: "High_Rated",
      normalizedUsername: "high_rated",
      passwordHash: "private-high",
      rating: 1_600,
      ratedGamesPlayed: 1,
    });

    const directory = PlayerDirectorySchema.parse((await requestDirectory()).json());
    const bob = directory.find((player) => player.id === bobId);

    expect(bob).toMatchObject({ username: "Bob_Two", rating: 1500, colorPercentile: 50 });
  });

  it("uses the midpoint color when nobody has a rated result", async () => {
    await database.db.update(users).set({ ratedGamesPlayed: 0 });

    const directory = PlayerDirectorySchema.parse((await requestDirectory()).json());

    expect(directory.map((player) => player.colorPercentile)).toEqual([50, 50]);
  });

  it("serializes no credential or internal rating fields", async () => {
    const response = await requestDirectory();
    const entries = response.json() as readonly Record<string, unknown>[];

    expect(entries.map((entry) => Object.keys(entry).sort())).toEqual([
      ["colorPercentile", "id", "rating", "username"],
      ["colorPercentile", "id", "rating", "username"],
    ]);
    for (const privateValue of ["not-used-by-this-public-route", "also-private", "0.07"]) {
      expect(response.body).not.toContain(privateValue);
    }
    for (const privateField of ["password", "deviation", "volatility", "ratedGamesPlayed"]) {
      expect(response.body).not.toContain(privateField);
    }
  });

  it("uses an independent proxy-aware read limiter", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/players",
      remoteAddress: "127.0.0.1",
      headers: {
        cookie: "test_session=valid-session",
        "x-forwarded-for": "203.0.113.77",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(directoryConsumedKeys).toEqual(["203.0.113.77"]);
    expect(consumedKeys).toEqual([]);

    refuseDirectory = true;
    const limited = await requestDirectory();
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("2");
  });

  it("keeps authoritative activity offline and gives in-game precedence", async () => {
    const inserted = await database.db
      .insert(games)
      .values([
        { playerOneId: aliceId, creatorId: aliceId, status: "waiting" },
        {
          playerOneId: aliceId,
          playerTwoId: bobId,
          creatorId: aliceId,
          status: "active",
          revision: 1,
          activatedRevision: 1,
        },
      ])
      .returning({ id: games.id, status: games.status });

    await expect(playerRepository.listPlayerActivities()).resolves.toEqual(
      [
        { id: aliceId, activity: "in_game" },
        { id: bobId, activity: "in_game" },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );

    const activeId = inserted.find((game) => game.status === "active")?.id;
    if (activeId === undefined) {
      throw new Error("expected an active activity fixture");
    }
    await database.db.delete(games).where(eq(games.id, activeId));

    await expect(playerRepository.listPlayerActivities()).resolves.toEqual([
      { id: aliceId, activity: "open_room" },
    ]);
  });
});

describe("GET /api/players/:username", () => {
  it("is public, case-insensitive, canonical, rounded, and aggregated from both seats", async () => {
    const response = await app.inject({ method: "GET", url: "/api/players/aLiCe_OnE" });

    expect(response.statusCode).toBe(200);
    expect(PublicPlayerProfileSchema.parse(response.json())).toEqual({
      username: "Alice_One",
      createdAt: expect.any(String),
      rating: { value: 1513, deviation: 87, percentile: 0 },
      ratingHistory: [],
      statistics: {
        totalFinishedGames: 3,
        wins: 1,
        losses: 2,
        ratedWins: 1,
        ratedLosses: 1,
        ratedGames: 2,
        casualGames: 1,
        boardFullGames: 1,
        resignationGames: 1,
        timeoutGames: 1,
      },
    });
  });

  it("returns an empty public record for a player with no finished games", async () => {
    const response = await app.inject({ method: "GET", url: "/api/players/Bob_Two" });
    expect(response.statusCode).toBe(200);
    expect(PublicPlayerProfileSchema.parse(response.json()).statistics.totalFinishedGames).toBe(3);

    const [carol] = await database.db
      .insert(users)
      .values({
        username: "Carol_Three",
        normalizedUsername: "carol_three",
        passwordHash: "private",
      })
      .returning({ id: users.id });
    expect(carol).toBeDefined();

    const empty = await app.inject({ method: "GET", url: "/api/players/Carol_Three" });
    expect(PublicPlayerProfileSchema.parse(empty.json()).statistics).toEqual({
      totalFinishedGames: 0,
      wins: 0,
      losses: 0,
      ratedWins: 0,
      ratedLosses: 0,
      ratedGames: 0,
      casualGames: 0,
      boardFullGames: 0,
      resignationGames: 0,
      timeoutGames: 0,
    });
  });

  it("uses one generic 404 and a strict 400 for malformed usernames", async () => {
    const missing = await app.inject({ method: "GET", url: "/api/players/Unknown_Player" });
    const invalid = await app.inject({ method: "GET", url: "/api/players/no%20spaces" });

    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ code: "player_not_found", message: "No such player" });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: "invalid_request" });
  });

  it("serializes only the public fields", async () => {
    const response = await app.inject({ method: "GET", url: "/api/players/Alice_One" });
    const body = response.json() as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual([
      "createdAt",
      "rating",
      "ratingHistory",
      "statistics",
      "username",
    ]);
    const wire = response.body;
    for (const privateValue of [aliceId, bobId, "not-used-by-this-public-route", "0.07"]) {
      expect(wire).not.toContain(privateValue);
    }
    for (const privateField of ["volatility", "password", "sessions", "moves", "opponent"]) {
      expect(wire).not.toContain(privateField);
    }
  });

  it("limits by the proxy-aware client address before lookup", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/players/Alice_One",
      remoteAddress: "127.0.0.1",
      headers: { "x-forwarded-for": "203.0.113.42" },
    });
    expect(response.statusCode).toBe(200);
    expect(consumedKeys).toEqual(["203.0.113.42"]);

    refuse = true;
    const limited = await app.inject({
      method: "GET",
      url: "/api/players/Alice_One",
      remoteAddress: "127.0.0.1",
      headers: { "x-forwarded-for": "203.0.113.42" },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("2");
    expect(limited.json()).toMatchObject({ code: "rate_limited" });
  });

  it("ranks a player against everyone who has finished a rated game", async () => {
    await database.db
      .update(users)
      .set({ rating: 1600, ratingDeviation: 80, ratedGamesPlayed: 4 })
      .where(eq(users.id, aliceId));
    await database.db
      .update(users)
      .set({ rating: 1400, ratingDeviation: 90, ratedGamesPlayed: 2 })
      .where(eq(users.id, bobId));

    const alice = PublicPlayerProfileSchema.parse(
      (await app.inject({ method: "GET", url: "/api/players/Alice_One" })).json(),
    );
    const bob = PublicPlayerProfileSchema.parse(
      (await app.inject({ method: "GET", url: "/api/players/Bob_Two" })).json(),
    );

    expect(alice.rating.percentile).toBe(50);
    expect(bob.rating.percentile).toBe(0);
  });

  it("gives no percentile to a player who has never finished a rated game", async () => {
    await database.db
      .update(users)
      .set({ rating: 1600, ratingDeviation: 80 })
      .where(eq(users.id, aliceId));

    const [carol] = await database.db
      .insert(users)
      .values({
        username: "Dave_Four",
        normalizedUsername: normalizeUsername("Dave_Four"),
        passwordHash: "not-used",
      })
      .returning({ id: users.id });
    expect(carol).toBeDefined();

    const profile = PublicPlayerProfileSchema.parse(
      (await app.inject({ method: "GET", url: "/api/players/Dave_Four" })).json(),
    );
    expect(profile.rating.percentile).toBeNull();

    const alice = PublicPlayerProfileSchema.parse(
      (await app.inject({ method: "GET", url: "/api/players/Alice_One" })).json(),
    );
    expect(alice.rating.percentile).not.toBeNull();
  });

  it("draws the rating line straight off the ledger, oldest first", async () => {
    const [game] = await database.db
      .insert(games)
      .values({
        playerOneId: aliceId,
        creatorId: aliceId,
        playerTwoId: bobId,
        status: "finished",
        revision: 1,
        activatedRevision: 1,
        rated: true,
        initialTimeMs: 60_000,
        incrementMs: 0,
        playerOneRemainingMs: 30_000,
        playerTwoRemainingMs: 20_000,
        clockStoppedAt: new Date("2026-08-04T11:00:00.000Z"),
        finishedAt: new Date("2026-08-04T11:00:00.000Z"),
        outcomeReason: "resignation",
        winner: 1,
      })
      .returning({ id: games.id });
    const gameId = game?.id ?? "";
    expect(gameId).not.toBe("");

    await database.db.insert(ratingEvents).values({
      gameId,
      userId: aliceId,
      opponentId: bobId,
      score: 1,
      ratingBefore: 1500,
      ratingDeviationBefore: 350,
      volatilityBefore: 0.06,
      ratingAfter: 1616,
      ratingDeviationAfter: 290,
      volatilityAfter: 0.06,
    });

    const profile = PublicPlayerProfileSchema.parse(
      (await app.inject({ method: "GET", url: "/api/players/Alice_One" })).json(),
    );

    expect(profile.ratingHistory.map((point) => point.rating)).toEqual([1500, 1616]);
    expect(Object.keys(profile.ratingHistory[0] ?? {})).toEqual(["at", "rating"]);
  });

  it("carries no line for a player with no rated results", async () => {
    const profile = PublicPlayerProfileSchema.parse(
      (await app.inject({ method: "GET", url: "/api/players/Bob_Two" })).json(),
    );

    expect(profile.ratingHistory).toEqual([]);
  });
});

describe("GET /api/players/:username/games", () => {
  const games_ = (username: string, query = "") =>
    app.inject({ method: "GET", url: `/api/players/${username}/games${query}` });

  it("serves a signed-out reader the whole public record of a player's games", async () => {
    const page = GameHistoryPageSchema.parse((await games_("Alice_One")).json());

    expect(page.games).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
    for (const game of page.games) {
      expect(game.opponent.username).toBe("Bob_Two");
    }
    expect(JSON.stringify(page)).not.toContain('"moves"');
  });

  it("summarises the same game from both sides", async () => {
    const alice = GameHistoryPageSchema.parse((await games_("Alice_One")).json());
    const bob = GameHistoryPageSchema.parse((await games_("Bob_Two")).json());

    const shared = alice.games.find((game) => game.seat === 1);
    expect(shared).toBeDefined();
    const mirrored = bob.games.find((game) => game.id === shared?.id);

    expect(mirrored?.seat).toBe(2);
    expect(mirrored?.opponent.username).toBe("Alice_One");
    expect(mirrored?.outcome).toEqual(shared?.outcome);
  });

  it("is case-insensitive and 404s an account that does not exist", async () => {
    expect((await games_("aLiCe_OnE")).statusCode).toBe(200);

    const missing = await games_("Unknown_Player");
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ code: "player_not_found", message: "No such player" });
  });

  it("pages through every game exactly once, newest first", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;

    for (let request = 0; request < 10; request += 1) {
      const query = cursor === null ? "?limit=2" : `?limit=2&cursor=${encodeURIComponent(cursor)}`;
      const page: { games: readonly { id: string }[]; nextCursor: string | null } =
        GameHistoryPageSchema.parse((await games_("Alice_One", query)).json());

      seen.push(...page.games.map((game) => game.id));
      cursor = page.nextCursor;
      if (cursor === null) {
        break;
      }
    }

    expect(cursor).toBeNull();
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
  });

  it("does not skip games whose raw finish clocks land within one millisecond", async () => {
    const candidates = await database.db
      .select({ id: games.id })
      .from(games)
      .where(eq(games.playerOneId, aliceId))
      .limit(2);
    const first = candidates[0];
    const second = candidates[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) {
      return;
    }

    await database.db
      .update(games)
      .set({ finishedAt: sql`'2026-08-04T11:00:00.000100Z'::timestamptz` })
      .where(eq(games.id, first.id));
    await database.db
      .update(games)
      .set({ finishedAt: sql`'2026-08-04T11:00:00.000400Z'::timestamptz` })
      .where(eq(games.id, second.id));

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let request = 0; request < 5; request += 1) {
      const query = cursor === null ? "?limit=1" : `?limit=1&cursor=${encodeURIComponent(cursor)}`;
      const page = GameHistoryPageSchema.parse((await games_("Alice_One", query)).json());
      seen.push(...page.games.map((game) => game.id));
      cursor = page.nextCursor;
      if (cursor === null) {
        break;
      }
    }

    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
  });

  it("defaults to a bounded page and refuses an unbounded one", async () => {
    const page = GameHistoryPageSchema.parse((await games_("Alice_One")).json());
    expect(page.games.length).toBeLessThanOrEqual(HISTORY_PAGE_LIMIT);

    expect((await games_("Alice_One", "?limit=1000")).statusCode).toBe(400);
    expect((await games_("Alice_One", "?limit=0")).statusCode).toBe(400);
  });

  it("refuses a cursor it did not issue rather than silently restarting", async () => {
    const response = await games_("Alice_One", "?cursor=not-a-cursor");

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "invalid_cursor" });
  });

  it("refuses an unknown query parameter", async () => {
    expect((await games_("Alice_One", "?opponent=Bob_Two")).statusCode).toBe(400);
  });

  it("answers an account with no finished games with an empty page", async () => {
    await database.db.insert(users).values({
      username: "Erin_Five",
      normalizedUsername: normalizeUsername("Erin_Five"),
      passwordHash: "private",
    });

    const page = GameHistoryPageSchema.parse((await games_("Erin_Five")).json());
    expect(page.games).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });
});
