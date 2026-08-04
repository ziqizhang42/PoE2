import { randomBytes } from "node:crypto";

import { AuthErrorResponseSchema, AuthSessionResponseSchema } from "@poe2/protocol";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createKdfExecutor } from "../auth/kdf-executor.js";
import {
  createPasswordHasher,
  CURRENT_PASSWORD_POLICY,
  derivePassword,
  encodePasswordHash,
  parsePasswordHash,
  type PasswordPolicy,
} from "../auth/password.js";
import { createAuthRepository } from "../auth/repository.js";
import { createAuthService } from "../auth/service.js";
import { normalizeUsername } from "../auth/username.js";
import { buildApp } from "../app.js";
import { readAuthConfig } from "../config/auth.js";
import { readDatabaseConfig } from "../config/database.js";
import { createDatabaseClient } from "../db/client.js";
import { users } from "../db/schema.js";
import { authPlugin } from "./auth.js";

const PASSWORD = "correct horse battery staple";

/** A cheaper parameter set standing in for hashes written before a policy change. */
const LEGACY_POLICY: PasswordPolicy = {
  memoryKiB: 19_456,
  passes: 2,
  parallelism: 1,
  saltBytes: 16,
  tagBytes: 32,
};

const database = createDatabaseClient(readDatabaseConfig(process.env));
const app = buildApp();
const authConfig = readAuthConfig({ NODE_ENV: "test" });
const recoveredErrors: unknown[] = [];

app.register(authPlugin, {
  ...authConfig,
  service: createAuthService(
    createAuthRepository(database.db),
    createPasswordHasher(createKdfExecutor({ maxConcurrent: 2, maxQueued: 16 })),
    {
      onRecoveredError: (error) => {
        recoveredErrors.push(error);
      },
    },
  ),
});

beforeEach(async () => {
  recoveredErrors.length = 0;
  await database.db.delete(users);
});

afterAll(async () => {
  await app.close();
  await database.close();
});

function extractCookie(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (header === undefined) {
    throw new Error("expected a Set-Cookie header");
  }

  const cookie = header.split(";")[0];
  if (cookie === undefined || cookie.length === 0) {
    throw new Error("expected a session cookie");
  }

  return cookie;
}

async function hashUnder(policy: PasswordPolicy, password: string): Promise<string> {
  const salt = randomBytes(policy.saltBytes);
  const tag = await derivePassword(password, salt, policy);

  return encodePasswordHash(policy, salt, tag);
}

async function readStoredUser(username: string): Promise<{
  readonly passwordHash: string;
  readonly updatedAt: Date;
}> {
  const [stored] = await database.db
    .select({ passwordHash: users.passwordHash, updatedAt: users.updatedAt })
    .from(users)
    .where(eq(users.normalizedUsername, normalizeUsername(username)));

  if (stored === undefined) {
    throw new Error(`expected ${username} to exist`);
  }

  return stored;
}

/** Writes a user directly, bypassing registration, with a chosen password hash. */
async function seedUser(username: string, passwordHash: string): Promise<void> {
  await database.db.insert(users).values({
    username,
    normalizedUsername: normalizeUsername(username),
    passwordHash,
  });
}

function login(username: string, password: string, remoteAddress: string) {
  return app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username, password },
    remoteAddress,
  });
}

describe("auth HTTP integration", () => {
  it("registers, authenticates, rejects a duplicate, and logs out", async () => {
    const registration = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "Player_One", password: PASSWORD },
      remoteAddress: "203.0.113.1",
    });

    expect(registration.statusCode).toBe(201);
    const registered = AuthSessionResponseSchema.parse(registration.json());
    expect(registered.user.username).toBe("Player_One");

    const cookie = extractCookie(registration.headers["set-cookie"]);

    const session = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie },
    });

    expect(session.statusCode).toBe(200);
    expect(AuthSessionResponseSchema.parse(session.json())).toEqual(registered);

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "PLAYER_ONE", password: PASSWORD },
      remoteAddress: "203.0.113.1",
    });

    expect(duplicate.statusCode).toBe(409);
    expect(AuthErrorResponseSchema.parse(duplicate.json()).code).toBe("username_taken");

    const logout = await app.inject({
      method: "DELETE",
      url: "/api/auth/session",
      headers: { cookie },
    });

    expect(logout.statusCode).toBe(204);

    const loggedOutSession = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie },
    });

    expect(loggedOutSession.statusCode).toBe(401);
    expect(AuthErrorResponseSchema.parse(loggedOutSession.json()).code).toBe("unauthenticated");
  });

  it("logs in case-insensitively without revealing whether a user exists", async () => {
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "Player_One", password: PASSWORD },
      remoteAddress: "203.0.113.2",
    });

    const success = await login("PLAYER_ONE", PASSWORD, "203.0.113.2");

    expect(success.statusCode).toBe(200);
    expect(AuthSessionResponseSchema.parse(success.json()).user.username).toBe("Player_One");
    expect(extractCookie(success.headers["set-cookie"])).toMatch(/^poe2_session=/u);

    const wrongPassword = await login("Player_One", "incorrect password", "203.0.113.2");
    const missingUser = await login("Missing_User", "incorrect password", "203.0.113.3");

    expect(wrongPassword.statusCode).toBe(401);
    expect(missingUser.statusCode).toBe(401);
    expect(AuthErrorResponseSchema.parse(wrongPassword.json())).toEqual(
      AuthErrorResponseSchema.parse(missingUser.json()),
    );
  });

  it("stores a current-policy hash on registration", async () => {
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "Player_One", password: PASSWORD },
      remoteAddress: "203.0.113.4",
    });

    const stored = await readStoredUser("Player_One");
    expect(parsePasswordHash(stored.passwordHash)?.policy).toEqual(CURRENT_PASSWORD_POLICY);
  });

  it("accepts a hash written under an older policy and upgrades it after login", async () => {
    const legacyHash = await hashUnder(LEGACY_POLICY, PASSWORD);
    await seedUser("Player_One", legacyHash);

    const before = await readStoredUser("Player_One");
    expect(parsePasswordHash(before.passwordHash)?.policy).toEqual(LEGACY_POLICY);

    const response = await login("Player_One", PASSWORD, "203.0.113.5");
    expect(response.statusCode).toBe(200);

    const after = await readStoredUser("Player_One");
    expect(after.passwordHash).not.toBe(legacyHash);
    expect(parsePasswordHash(after.passwordHash)?.policy).toEqual(CURRENT_PASSWORD_POLICY);
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect(recoveredErrors).toEqual([]);

    // The upgraded hash still authenticates, and the old one is gone.
    const again = await login("Player_One", PASSWORD, "203.0.113.6");
    expect(again.statusCode).toBe(200);
  });

  it("does not rewrite a hash that already matches the current policy", async () => {
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "Player_One", password: PASSWORD },
      remoteAddress: "203.0.113.7",
    });

    const before = await readStoredUser("Player_One");
    expect((await login("Player_One", PASSWORD, "203.0.113.8")).statusCode).toBe(200);

    const after = await readStoredUser("Player_One");
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it("rejects a wrong password against an older-policy hash without upgrading it", async () => {
    const legacyHash = await hashUnder(LEGACY_POLICY, PASSWORD);
    await seedUser("Player_One", legacyHash);

    const response = await login("Player_One", "incorrect password", "203.0.113.9");
    expect(response.statusCode).toBe(401);

    const stored = await readStoredUser("Player_One");
    expect(stored.passwordHash).toBe(legacyHash);
  });

  it("rejects a stored hash whose parameters are outside the safe bounds", async () => {
    const salt = "A".repeat(24);
    const tag = "B".repeat(44);
    await seedUser("Player_One", `$argon2id$v=19$m=262145,t=3,p=4$${salt}$${tag}`);

    const response = await login("Player_One", PASSWORD, "203.0.113.10");

    expect(response.statusCode).toBe(401);
    expect(AuthErrorResponseSchema.parse(response.json()).code).toBe("invalid_credentials");

    // An unparseable row cannot log anyone in, so it has to be visible rather
    // than a silent permanent lockout.
    expect(recoveredErrors).toHaveLength(1);
    expect(String(recoveredErrors[0])).toContain("could not be parsed");

    // Rejected, never rewritten.
    const stored = await readStoredUser("Player_One");
    expect(stored.passwordHash).toContain("m=262145");
  });

  it("keeps both overlapping logins valid and ends with a current-policy hash", async () => {
    const legacyHash = await hashUnder(LEGACY_POLICY, PASSWORD);
    await seedUser("Player_One", legacyHash);

    const responses = await Promise.all([
      login("Player_One", PASSWORD, "203.0.113.11"),
      login("Player_One", PASSWORD, "203.0.113.12"),
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(200);
    }

    const stored = await readStoredUser("Player_One");
    expect(parsePasswordHash(stored.passwordHash)?.policy).toEqual(CURRENT_PASSWORD_POLICY);
    expect(recoveredErrors).toEqual([]);
  });
});
