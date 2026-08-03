import { describe, expect, it } from "vitest";

import { readDatabaseConfig } from "./database.js";

describe("readDatabaseConfig", () => {
  it.each(["postgres://user:password@db:5432/poe2", "postgresql://user:password@db:5432/poe2"])(
    "accepts %s",
    (databaseUrl) => {
      expect(readDatabaseConfig({ DATABASE_URL: databaseUrl })).toEqual({
        databaseUrl,
      });
    },
  );

  it("trims the database URL", () => {
    expect(readDatabaseConfig({ DATABASE_URL: "  postgresql://user:password@db/poe2  " })).toEqual({
      databaseUrl: "postgresql://user:password@db/poe2",
    });
  });

  it.each([undefined, "", "not-a-url", "https://db.example/poe2"])("rejects %s", (databaseUrl) => {
    expect(() => readDatabaseConfig({ DATABASE_URL: databaseUrl })).toThrow();
  });
});
