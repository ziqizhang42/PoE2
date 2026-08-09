import { normalizeUsername } from "@poe2/protocol";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "../config/database.js";
import { createDatabaseClient } from "../db/client.js";
import { users } from "../db/schema.js";
import { MAX_DEVIATION } from "./bounds.js";
import { createRatingDecay } from "./decay.js";

const database = createDatabaseClient(readDatabaseConfig(process.env));

const PERIOD_MS = 7 * 86_400_000;
const decay = createRatingDecay(database.db, { periodMs: PERIOD_MS, batchSize: 100 });

interface Seed {
  readonly username: string;
  readonly deviation: number;
  readonly ratedGamesPlayed: number;
  readonly agoDays: number;
}

async function seed(rows: readonly Seed[]): Promise<Map<string, string>> {
  const inserted = await database.db
    .insert(users)
    .values(
      rows.map((row) => ({
        username: row.username,
        normalizedUsername: normalizeUsername(row.username),
        passwordHash: "not-used-by-decay",
        rating: 1600,
        ratingDeviation: row.deviation,
        volatility: 0.06,
        ratedGamesPlayed: row.ratedGamesPlayed,
        ratingPeriodAt: sql`now() - make_interval(days => ${row.agoDays})`,
      })),
    )
    .returning({ id: users.id, username: users.username });

  return new Map(inserted.map((row) => [row.username, row.id]));
}

async function read(id: string) {
  const [row] = await database.db
    .select({
      rating: users.rating,
      deviation: users.ratingDeviation,
      ratedGamesPlayed: users.ratedGamesPlayed,
      periodAt: users.ratingPeriodAt,
    })
    .from(users)
    .where(eq(users.id, id));

  return row;
}

beforeEach(async () => {
  await database.db.delete(users);
});

afterAll(async () => {
  await database.close();
});

describe("rating decay", () => {
  it("widens a rated player who has sat out a whole period, without moving the rating", async () => {
    const ids = await seed([
      { username: "Absent_One", deviation: 60, ratedGamesPlayed: 12, agoDays: 8 },
    ]);
    const id = ids.get("Absent_One") ?? "";

    const pass = await decay.runOnce();
    const after = await read(id);

    expect(pass.decayed).toBe(1);
    expect(after?.deviation).toBeGreaterThan(60);
    expect(after?.rating).toBe(1600);
  });

  it("leaves a player alone inside their current period", async () => {
    const ids = await seed([
      { username: "Recent_One", deviation: 60, ratedGamesPlayed: 12, agoDays: 3 },
    ]);
    const id = ids.get("Recent_One") ?? "";

    const pass = await decay.runOnce();

    expect(pass.decayed).toBe(0);
    expect((await read(id))?.deviation).toBe(60);
  });

  it("never touches a player who has no rated games", async () => {
    const ids = await seed([
      { username: "Never_Rated", deviation: 350, ratedGamesPlayed: 0, agoDays: 400 },
    ]);
    const id = ids.get("Never_Rated") ?? "";

    const pass = await decay.runOnce();

    expect(pass.decayed).toBe(0);
    expect((await read(id))?.deviation).toBe(350);
  });

  it("applies every elapsed period at once, so a missed sweep is not lost", async () => {
    const ids = await seed([
      { username: "Gone_Four", deviation: 60, ratedGamesPlayed: 12, agoDays: 28 },
      { username: "Gone_One", deviation: 60, ratedGamesPlayed: 12, agoDays: 7 },
    ]);

    await decay.runOnce();

    const four = await read(ids.get("Gone_Four") ?? "");
    const one = await read(ids.get("Gone_One") ?? "");

    expect(four?.deviation).toBeGreaterThan(one?.deviation ?? 0);
  });

  it("is idempotent: a second pass with no time elapsed changes nothing", async () => {
    const ids = await seed([
      { username: "Twice_Run", deviation: 60, ratedGamesPlayed: 12, agoDays: 9 },
    ]);
    const id = ids.get("Twice_Run") ?? "";

    await decay.runOnce();
    const afterFirst = await read(id);
    const second = await decay.runOnce();
    const afterSecond = await read(id);

    expect(second.decayed).toBe(0);
    expect(afterSecond?.deviation).toBe(afterFirst?.deviation);
  });

  it("keeps the part-period already served rather than restarting the clock", async () => {
    const ids = await seed([
      { username: "Part_Served", deviation: 60, ratedGamesPlayed: 12, agoDays: 9 },
    ]);
    const id = ids.get("Part_Served") ?? "";

    await decay.runOnce();
    const after = await read(id);
    const servedMs = Date.now() - (after?.periodAt?.getTime() ?? 0);

    expect(servedMs).toBeGreaterThan(1.5 * 86_400_000);
    expect(servedMs).toBeLessThan(PERIOD_MS);
  });

  it("widens gradually rather than all at once, over a year away", async () => {
    const ids = await seed([
      { username: "Gone_Year", deviation: 60, ratedGamesPlayed: 200, agoDays: 365 },
    ]);
    const id = ids.get("Gone_Year") ?? "";

    await decay.runOnce();
    const after = await read(id);

    expect(after?.deviation).toBeGreaterThan(80);
    expect(after?.deviation).toBeLessThan(150);
  });

  it("caps an unbounded absence at the ceiling, keeping a veteran below a newcomer", async () => {
    const ids = await seed([
      { username: "Gone_Forever", deviation: 60, ratedGamesPlayed: 200, agoDays: 20_000 },
    ]);
    const id = ids.get("Gone_Forever") ?? "";

    await decay.runOnce();
    const after = await read(id);

    expect(after?.deviation).toBe(MAX_DEVIATION);
    expect(after?.deviation).toBeLessThan(350);
  });

  it("keeps a decayed player on the ladder", async () => {
    const ids = await seed([
      { username: "Still_Ranked", deviation: 60, ratedGamesPlayed: 200, agoDays: 3_650 },
    ]);
    const id = ids.get("Still_Ranked") ?? "";

    await decay.runOnce();

    expect((await read(id))?.ratedGamesPlayed).toBe(200);
  });

  it("reports that more work remains when the batch fills", async () => {
    const small = createRatingDecay(database.db, { periodMs: PERIOD_MS, batchSize: 2 });
    await seed([
      { username: "Batch_One", deviation: 60, ratedGamesPlayed: 3, agoDays: 30 },
      { username: "Batch_Two", deviation: 60, ratedGamesPlayed: 3, agoDays: 30 },
      { username: "Batch_Three", deviation: 60, ratedGamesPlayed: 3, agoDays: 30 },
    ]);

    const first = await small.runOnce();
    expect(first.decayed).toBe(2);
    expect(first.more).toBe(true);

    const second = await small.runOnce();
    expect(second.decayed).toBe(1);
    expect(second.more).toBe(false);
  });
});
