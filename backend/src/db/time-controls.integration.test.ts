import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_INCREMENT_MS,
  MAX_INITIAL_MS,
  MIN_INITIAL_MS,
  TIME_CONTROL_STEP_MS,
  normalizeUsername,
} from "@poe2/protocol";

import { readDatabaseConfig } from "../config/database.js";
import { createDatabaseClient } from "./client.js";
import { games, users } from "./schema.js";

const database = createDatabaseClient(readDatabaseConfig(process.env));
const STARTED_AT = new Date("2026-08-04T12:00:00.000Z");

let playerOneId = "";
let playerTwoId = "";

beforeEach(async () => {
  await database.db.delete(users);
  const inserted = await database.db
    .insert(users)
    .values([
      {
        username: "Clock_One",
        normalizedUsername: normalizeUsername("Clock_One"),
        passwordHash: "not-used",
      },
      {
        username: "Clock_Two",
        normalizedUsername: normalizeUsername("Clock_Two"),
        passwordHash: "not-used",
      },
    ])
    .returning({ id: users.id, username: users.username });

  playerOneId = inserted.find((row) => row.username === "Clock_One")?.id ?? "";
  playerTwoId = inserted.find((row) => row.username === "Clock_Two")?.id ?? "";
  if (playerOneId.length === 0 || playerTwoId.length === 0) {
    throw new Error("expected clock-constraint users to be inserted");
  }
});

afterAll(() => database.close());

function activeTimedValues(overrides: Partial<typeof games.$inferInsert> = {}) {
  return {
    playerOneId,
    creatorId: playerOneId,
    playerTwoId,
    status: "active" as const,
    revision: 1,
    activatedRevision: 1,
    initialTimeMs: 181_000,
    incrementMs: 2_000,
    playerOneRemainingMs: 181_000,
    playerTwoRemainingMs: 181_000,
    runningPlayer: 1,
    turnStartedAt: STARTED_AT,
    deadlineAt: new Date(STARTED_AT.getTime() + 181_000),
    ...overrides,
  };
}

function finishedTimedValues(overrides: Partial<typeof games.$inferInsert> = {}) {
  return {
    playerOneId,
    creatorId: playerOneId,
    playerTwoId,
    status: "finished" as const,
    revision: 2,
    activatedRevision: 1,
    initialTimeMs: 300_000,
    incrementMs: 3_000,
    playerOneRemainingMs: 250_000,
    playerTwoRemainingMs: 275_000,
    clockStoppedAt: STARTED_AT,
    finishedAt: STARTED_AT,
    outcomeReason: "resignation" as const,
    winner: 1,
    ...overrides,
  };
}

describe("time-control migration constraints", () => {
  it("reads a bare insert as untimed with no clock state", async () => {
    const [row] = await database.db
      .insert(games)
      .values({ playerOneId, creatorId: playerOneId })
      .returning({
        initialMs: games.initialTimeMs,
        incrementMs: games.incrementMs,
        playerOneRemainingMs: games.playerOneRemainingMs,
        playerTwoRemainingMs: games.playerTwoRemainingMs,
        runningPlayer: games.runningPlayer,
        turnStartedAt: games.turnStartedAt,
        deadlineAt: games.deadlineAt,
        stoppedAt: games.clockStoppedAt,
      });

    expect(row).toEqual({
      initialMs: null,
      incrementMs: null,
      playerOneRemainingMs: null,
      playerTwoRemainingMs: null,
      runningPlayer: null,
      turnStartedAt: null,
      deadlineAt: null,
      stoppedAt: null,
    });
  });

  it("requires both durations to move together", async () => {
    await expect(
      database.db
        .insert(games)
        .values({ playerOneId, creatorId: playerOneId, initialTimeMs: 180_000 }),
    ).rejects.toThrow();

    await expect(
      database.db.insert(games).values({ playerOneId, creatorId: playerOneId, incrementMs: 2_000 }),
    ).rejects.toThrow();
  });

  it("accepts an increment of zero", async () => {
    await expect(
      database.db
        .insert(games)
        .values({ playerOneId, creatorId: playerOneId, initialTimeMs: 60_000, incrementMs: 0 }),
    ).resolves.toBeDefined();
  });

  it("accepts durations no preset ever named", async () => {
    await expect(database.db.insert(games).values(activeTimedValues())).resolves.toBeDefined();
  });

  // Share edge values with the protocol while testing frozen SQL constraints.
  it.each([
    ["below the floor", MIN_INITIAL_MS - TIME_CONTROL_STEP_MS, 0],
    ["above the ceiling", MAX_INITIAL_MS + TIME_CONTROL_STEP_MS, 0],
    ["an increment above the ceiling", 60_000, MAX_INCREMENT_MS + TIME_CONTROL_STEP_MS],
    ["a fraction of a second", 60_500, 0],
    ["a fraction of a second of increment", 60_000, 1_500],
  ])("refuses a clock %s", async (_label, initialTimeMs, incrementMs) => {
    await expect(
      database.db
        .insert(games)
        .values({ playerOneId, creatorId: playerOneId, initialTimeMs, incrementMs }),
    ).rejects.toThrow();
  });

  it.each([
    ["the shortest clock", MIN_INITIAL_MS, 0],
    ["the longest clock", MAX_INITIAL_MS, MAX_INCREMENT_MS],
  ])("accepts %s", async (_label, initialTimeMs, incrementMs) => {
    await expect(
      database.db
        .insert(games)
        .values({ playerOneId, creatorId: playerOneId, initialTimeMs, incrementMs }),
    ).resolves.toBeDefined();
  });

  it("refuses a rated game with no clock", async () => {
    await expect(
      database.db.insert(games).values({ playerOneId, creatorId: playerOneId, rated: true }),
    ).rejects.toThrow();

    await expect(
      database.db.insert(games).values({
        playerOneId,
        creatorId: playerOneId,
        rated: true,
        initialTimeMs: 60_000,
        incrementMs: 0,
      }),
    ).resolves.toBeDefined();
  });

  it.each([
    ["missing a balance", { playerOneRemainingMs: null }],
    ["a zero active balance", { playerOneRemainingMs: 0 }],
    ["a missing running player", { runningPlayer: null }],
    ["the wrong revision-derived running player", { runningPlayer: 2 }],
    ["a missing deadline", { deadlineAt: null }],
    ["a deadline inconsistent with the running balance", { deadlineAt: STARTED_AT }],
  ] as const)("rejects an active timed clock with %s", async (_label, overrides) => {
    await expect(database.db.insert(games).values(activeTimedValues(overrides))).rejects.toThrow();
  });

  it("requires final balances and a stop time for a finished timed game", async () => {
    await expect(
      database.db.insert(games).values(finishedTimedValues({ playerTwoRemainingMs: null })),
    ).rejects.toThrow();
    await expect(
      database.db.insert(games).values(finishedTimedValues({ clockStoppedAt: null })),
    ).rejects.toThrow();
  });

  it("allows timeout only for a timed game whose losing balance is zero", async () => {
    await expect(
      database.db.insert(games).values({
        playerOneId,
        creatorId: playerOneId,
        playerTwoId,
        status: "finished",
        revision: 1,
        activatedRevision: 1,
        finishedAt: STARTED_AT,
        outcomeReason: "timeout",
        winner: 2,
      }),
    ).rejects.toThrow();

    await expect(
      database.db
        .insert(games)
        .values(finishedTimedValues({ outcomeReason: "timeout", winner: 2 })),
    ).rejects.toThrow();

    await expect(
      database.db.insert(games).values(
        finishedTimedValues({
          outcomeReason: "timeout",
          winner: 2,
          playerOneRemainingMs: 0,
        }),
      ),
    ).resolves.toBeDefined();
  });
});
