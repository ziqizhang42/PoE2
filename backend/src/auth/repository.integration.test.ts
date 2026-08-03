import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "../config/database.js";
import { createDatabaseClient } from "../db/client.js";
import { users } from "../db/schema.js";
import { createAuthRepository } from "./repository.js";
import { hashSessionToken } from "./session-token.js";

const NOW = new Date("2026-08-03T12:00:00Z");
const PAST = new Date("2026-08-02T12:00:00Z");
const FUTURE = new Date("2026-08-04T12:00:00Z");
const PASSWORD_HASH = "$argon2id$test";

const database = createDatabaseClient(readDatabaseConfig(process.env));
const repository = createAuthRepository(database.db);

beforeEach(() => database.db.delete(users));
afterAll(() => database.close());

describe("auth repository", () => {
  it("creates and finds a user with an active session", async () => {
    const tokenHash = hashSessionToken("registration-token");

    const created = await repository.createUserWithSession({
      username: "Player_One",
      normalizedUsername: "player_one",
      passwordHash: PASSWORD_HASH,
      tokenHash,
      expiresAt: FUTURE,
    });

    expect(created).not.toBeNull();

    const stored = await repository.findUserByNormalizedUsername("player_one");
    expect(stored).toEqual({
      ...created,
      passwordHash: PASSWORD_HASH,
    });

    await expect(repository.findUserBySessionTokenHash(tokenHash, NOW)).resolves.toEqual(created);
  });

  it("rejects a duplicate normalized username without creating its session", async () => {
    await repository.createUserWithSession({
      username: "Player_One",
      normalizedUsername: "player_one",
      passwordHash: PASSWORD_HASH,
      tokenHash: hashSessionToken("first-token"),
      expiresAt: FUTURE,
    });

    const duplicateTokenHash = hashSessionToken("duplicate-token");
    const duplicate = await repository.createUserWithSession({
      username: "PLAYER_ONE",
      normalizedUsername: "player_one",
      passwordHash: PASSWORD_HASH,
      tokenHash: duplicateTokenHash,
      expiresAt: FUTURE,
    });

    expect(duplicate).toBeNull();
    await expect(
      repository.findUserBySessionTokenHash(duplicateTokenHash, NOW),
    ).resolves.toBeNull();
  });

  it("ignores expired sessions and supports creating and deleting an active session", async () => {
    const expiredTokenHash = hashSessionToken("expired-token");
    const created = await repository.createUserWithSession({
      username: "Player_One",
      normalizedUsername: "player_one",
      passwordHash: PASSWORD_HASH,
      tokenHash: expiredTokenHash,
      expiresAt: PAST,
    });

    if (created === null) {
      throw new Error("expected the user to be created");
    }

    await expect(repository.findUserBySessionTokenHash(expiredTokenHash, NOW)).resolves.toBeNull();

    const activeTokenHash = hashSessionToken("active-token");
    await repository.createSession({
      userId: created.id,
      tokenHash: activeTokenHash,
      expiresAt: FUTURE,
    });

    await expect(repository.findUserBySessionTokenHash(activeTokenHash, NOW)).resolves.toEqual(
      created,
    );

    await repository.deleteSessionByTokenHash(activeTokenHash);
    await expect(repository.findUserBySessionTokenHash(activeTokenHash, NOW)).resolves.toBeNull();
  });
});
