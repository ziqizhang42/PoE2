import type { AuthUser } from "@poe2/protocol";
import { beforeAll, describe, expect, it } from "vitest";

import { hashPassword } from "./password.js";
import type {
  AuthRepository,
  CreateSessionInput,
  CreateUserWithSessionInput,
} from "./repository.js";
import { hashSessionToken } from "./session-token.js";
import { createAuthService } from "./service.js";

const NOW = new Date("2026-08-03T12:00:00Z");
const SESSION_DURATION_MS = 60_000;
const PASSWORD = "correct horse battery staple";
const USER: AuthUser = {
  id: "e4aa457e-7620-4f14-ae26-6c20f3995ee1",
  username: "Player_One",
};

let storedPasswordHash = "";

beforeAll(async () => {
  storedPasswordHash = await hashPassword(PASSWORD);
});

function buildRepository(overrides: Partial<AuthRepository> = {}): AuthRepository {
  return {
    async createUserWithSession() {
      return null;
    },
    async findUserByNormalizedUsername() {
      return null;
    },
    async createSession() {},
    async findUserBySessionTokenHash() {
      return null;
    },
    async deleteSessionByTokenHash() {},
    ...overrides,
  };
}

describe("auth service", () => {
  it("registers a user and creates their first session", async () => {
    const calls: CreateUserWithSessionInput[] = [];
    const repository = buildRepository({
      async createUserWithSession(input) {
        calls.push(input);
        return USER;
      },
    });
    const service = createAuthService(repository, {
      now: () => NOW,
      sessionDurationMs: SESSION_DURATION_MS,
    });

    const result = await service.register({
      username: "Player_One",
      password: PASSWORD,
    });

    if (!result.ok) {
      throw new Error("expected registration to succeed");
    }

    expect(result.session.user).toEqual(USER);
    expect(result.session.expiresAt).toEqual(new Date(NOW.getTime() + SESSION_DURATION_MS));

    const input = calls[0];
    expect(input?.username).toBe("Player_One");
    expect(input?.normalizedUsername).toBe("player_one");
    expect(input?.passwordHash).toMatch(/^\$argon2id\$/u);
    expect(input?.tokenHash).toBe(hashSessionToken(result.session.token));
    expect(input?.expiresAt).toEqual(result.session.expiresAt);
  });

  it("reports a duplicate username", async () => {
    const service = createAuthService(buildRepository(), {
      now: () => NOW,
      sessionDurationMs: SESSION_DURATION_MS,
    });

    await expect(service.register({ username: "Player_One", password: PASSWORD })).resolves.toEqual(
      {
        ok: false,
        code: "username_taken",
      },
    );
  });

  it("logs in with a case-insensitive username", async () => {
    const normalizedUsernames: string[] = [];
    const sessions: CreateSessionInput[] = [];
    const repository = buildRepository({
      async findUserByNormalizedUsername(normalizedUsername) {
        normalizedUsernames.push(normalizedUsername);
        return { ...USER, passwordHash: storedPasswordHash };
      },
      async createSession(input) {
        sessions.push(input);
      },
    });
    const service = createAuthService(repository, {
      now: () => NOW,
      sessionDurationMs: SESSION_DURATION_MS,
    });

    const result = await service.login({
      username: "PLAYER_ONE",
      password: PASSWORD,
    });

    if (!result.ok) {
      throw new Error("expected login to succeed");
    }

    expect(normalizedUsernames).toEqual(["player_one"]);
    expect(result.session.user).toEqual(USER);
    expect(sessions).toEqual([
      {
        userId: USER.id,
        tokenHash: hashSessionToken(result.session.token),
        expiresAt: result.session.expiresAt,
      },
    ]);
  });

  it("uses the same error for a wrong password and a missing user", async () => {
    const existingUserService = createAuthService(
      buildRepository({
        async findUserByNormalizedUsername() {
          return { ...USER, passwordHash: storedPasswordHash };
        },
      }),
    );
    const missingUserService = createAuthService(buildRepository());

    await expect(
      existingUserService.login({
        username: "Player_One",
        password: "incorrect password",
      }),
    ).resolves.toEqual({
      ok: false,
      code: "invalid_credentials",
    });

    await expect(
      missingUserService.login({
        username: "Missing_User",
        password: "incorrect password",
      }),
    ).resolves.toEqual({
      ok: false,
      code: "invalid_credentials",
    });
  });

  it("authenticates and logs out using only the token hash", async () => {
    const lookups: Array<{ tokenHash: string; now: Date }> = [];
    const deletions: string[] = [];
    const repository = buildRepository({
      async findUserBySessionTokenHash(tokenHash, currentTime) {
        lookups.push({ tokenHash, now: currentTime });
        return USER;
      },
      async deleteSessionByTokenHash(tokenHash) {
        deletions.push(tokenHash);
      },
    });
    const service = createAuthService(repository, { now: () => NOW });

    await expect(service.authenticateSession("session-token")).resolves.toEqual(USER);
    await service.logout("session-token");

    const expectedHash = hashSessionToken("session-token");
    expect(lookups).toEqual([{ tokenHash: expectedHash, now: NOW }]);
    expect(deletions).toEqual([expectedHash]);
  });
});
