import { sql } from "drizzle-orm";
import { z } from "zod";
import { afterAll, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "../config/database.js";
import { createDatabaseClient } from "./client.js";

const databaseIdentitySchema = z.object({
  databaseName: z.string(),
  userName: z.string(),
  serverVersion: z.number().int(),
});

const migrationStateSchema = z.object({
  hasUsersTable: z.boolean(),
  hasSessionsTable: z.boolean(),
  hasGamesTable: z.boolean(),
  hasGameMovesTable: z.boolean(),
  hasGameStatusType: z.boolean(),
  hasAppliedMigration: z.boolean(),
});

const database = createDatabaseClient(readDatabaseConfig(process.env));

afterAll(() => database.close());

describe("database client", () => {
  it("passes its readiness check while PostgreSQL accepts queries", async () => {
    await expect(database.checkReady()).resolves.toBeUndefined();
  });

  it("connects to the isolated PostgreSQL 18 database", async () => {
    const rows = await database.db.execute(sql`
      select
        current_database() as "databaseName",
        current_user as "userName",
        current_setting('server_version_num')::integer as "serverVersion"
    `);

    const identity = databaseIdentitySchema.parse(rows[0]);

    expect(identity.databaseName).toBe("poe2_test");
    expect(identity.userName).toBe("poe2_test");
    expect(identity.serverVersion).toBeGreaterThanOrEqual(180_000);
  });

  it("has applied the committed database migrations", async () => {
    const rows = await database.db.execute(sql`
      select
        to_regclass('public.users') is not null as "hasUsersTable",
        to_regclass('public.sessions') is not null as "hasSessionsTable",
        to_regclass('public.games') is not null as "hasGamesTable",
        to_regclass('public.game_moves') is not null as "hasGameMovesTable",
        to_regtype('public.game_status') is not null as "hasGameStatusType",
        (
          select count(*) > 0
          from drizzle.__drizzle_migrations
        ) as "hasAppliedMigration"
    `);

    expect(migrationStateSchema.parse(rows[0])).toEqual({
      hasUsersTable: true,
      hasSessionsTable: true,
      hasGamesTable: true,
      hasGameMovesTable: true,
      hasGameStatusType: true,
      hasAppliedMigration: true,
    });
  });
});
