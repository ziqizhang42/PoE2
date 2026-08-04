import type { AuthUser } from "@poe2/protocol";
import { describe, expect, it } from "vitest";

import { KdfCapacityError } from "./kdf-executor.js";
import type { PasswordHasher } from "./password.js";
import type {
  AuthRepository,
  CreateSessionInput,
  CreateUserWithSessionInput,
  UpdateUserPasswordHashInput,
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

const CURRENT_HASH = `current:${PASSWORD}`;
const OUTDATED_HASH = `outdated:${PASSWORD}`;
const UNUSABLE_HASH = "$argon2id$corrupt";

function buildRepository(overrides: Partial<AuthRepository> = {}): AuthRepository {
  return {
    async createUserWithSession() {
      return null;
    },
    async findUserByNormalizedUsername() {
      return null;
    },
    async updateUserPasswordHash() {
      return true;
    },
    async createSession() {},
    async findUserBySessionTokenHash() {
      return null;
    },
    async deleteSessionByTokenHash() {},
    ...overrides,
  };
}

/**
 * A deterministic stand-in for Argon2. `current:<password>` is an up-to-date
 * hash and `outdated:<password>` verifies but asks to be rehashed; a stored
 * value carrying the `outdated:` prefix is treated as an older, cheaper policy
 * whether or not the password matches.
 */
function buildHasher(overrides: Partial<PasswordHasher> = {}): PasswordHasher {
  return {
    async hash(password) {
      return `current:${password}`;
    },
    async verify(password, encodedHash) {
      if (encodedHash === `current:${password}`) {
        return { outcome: "verified", needsRehash: false };
      }

      if (encodedHash === `outdated:${password}`) {
        return { outcome: "verified", needsRehash: true };
      }

      if (encodedHash === UNUSABLE_HASH) {
        return { outcome: "unusable_hash" };
      }

      return {
        outcome: "mismatch",
        storedPolicyIsCurrent: !encodedHash.startsWith("outdated:"),
      };
    },
    ...overrides,
  };
}

function buildService(
  repository: AuthRepository,
  hasher: PasswordHasher = buildHasher(),
  onRecoveredError: (error: unknown) => void = () => {},
) {
  return createAuthService(repository, hasher, {
    now: () => NOW,
    sessionDurationMs: SESSION_DURATION_MS,
    onRecoveredError,
  });
}

describe("auth service registration", () => {
  it("registers a user and creates their first session", async () => {
    const calls: CreateUserWithSessionInput[] = [];
    const service = buildService(
      buildRepository({
        async createUserWithSession(input) {
          calls.push(input);
          return USER;
        },
      }),
    );

    const result = await service.register({ username: "Player_One", password: PASSWORD });

    if (!result.ok) {
      throw new Error("expected registration to succeed");
    }

    expect(result.session.user).toEqual(USER);
    expect(result.session.expiresAt).toEqual(new Date(NOW.getTime() + SESSION_DURATION_MS));

    const input = calls[0];
    expect(input?.username).toBe("Player_One");
    expect(input?.normalizedUsername).toBe("player_one");
    expect(input?.passwordHash).toBe(CURRENT_HASH);
    expect(input?.tokenHash).toBe(hashSessionToken(result.session.token));
    expect(input?.expiresAt).toEqual(result.session.expiresAt);
  });

  it("reports a duplicate username", async () => {
    const service = buildService(buildRepository());

    await expect(service.register({ username: "Player_One", password: PASSWORD })).resolves.toEqual(
      { ok: false, code: "username_taken" },
    );
  });

  it("reports temporary unavailability when password capacity is exhausted", async () => {
    let created = 0;
    const service = buildService(
      buildRepository({
        async createUserWithSession() {
          created += 1;
          return USER;
        },
      }),
      buildHasher({
        hash() {
          return Promise.reject(new KdfCapacityError());
        },
      }),
    );

    await expect(service.register({ username: "Player_One", password: PASSWORD })).resolves.toEqual(
      { ok: false, code: "temporarily_unavailable" },
    );
    expect(created).toBe(0);
  });

  it("propagates an unexpected hashing failure", async () => {
    const service = buildService(
      buildRepository(),
      buildHasher({
        hash() {
          return Promise.reject(new Error("argon2 exploded"));
        },
      }),
    );

    await expect(service.register({ username: "Player_One", password: PASSWORD })).rejects.toThrow(
      "argon2 exploded",
    );
  });
});

describe("auth service login", () => {
  it("logs in with a case-insensitive username", async () => {
    const normalizedUsernames: string[] = [];
    const sessions: CreateSessionInput[] = [];
    const service = buildService(
      buildRepository({
        async findUserByNormalizedUsername(normalizedUsername) {
          normalizedUsernames.push(normalizedUsername);
          return { ...USER, passwordHash: CURRENT_HASH };
        },
        async createSession(input) {
          sessions.push(input);
        },
      }),
    );

    const result = await service.login({ username: "PLAYER_ONE", password: PASSWORD });

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
    const existingUserService = buildService(
      buildRepository({
        async findUserByNormalizedUsername() {
          return { ...USER, passwordHash: CURRENT_HASH };
        },
      }),
    );
    const missingUserService = buildService(buildRepository());

    await expect(
      existingUserService.login({ username: "Player_One", password: "incorrect password" }),
    ).resolves.toEqual({ ok: false, code: "invalid_credentials" });

    await expect(
      missingUserService.login({ username: "Missing_User", password: "incorrect password" }),
    ).resolves.toEqual({ ok: false, code: "invalid_credentials" });
  });

  it("still spends password work when the user does not exist", async () => {
    const hashed: string[] = [];
    const service = buildService(
      buildRepository(),
      buildHasher({
        async hash(password) {
          hashed.push(password);
          return `current:${password}`;
        },
      }),
    );

    await service.login({ username: "Missing_User", password: PASSWORD });

    expect(hashed).toEqual([PASSWORD]);
  });

  it.each([
    { name: "an existing user", passwordHash: CURRENT_HASH },
    { name: "a missing user", passwordHash: null },
  ])(
    "reports the same temporary unavailability for $name when capacity is exhausted",
    async ({ passwordHash }) => {
      const service = buildService(
        buildRepository({
          async findUserByNormalizedUsername() {
            return passwordHash === null ? null : { ...USER, passwordHash };
          },
        }),
        buildHasher({
          hash() {
            return Promise.reject(new KdfCapacityError());
          },
          verify() {
            return Promise.reject(new KdfCapacityError());
          },
        }),
      );

      await expect(service.login({ username: "Player_One", password: PASSWORD })).resolves.toEqual({
        ok: false,
        code: "temporarily_unavailable",
      });
    },
  );

  it("propagates an unexpected verification failure instead of reporting bad credentials", async () => {
    const service = buildService(
      buildRepository({
        async findUserByNormalizedUsername() {
          return { ...USER, passwordHash: CURRENT_HASH };
        },
      }),
      buildHasher({
        verify() {
          return Promise.reject(new Error("argon2 exploded"));
        },
      }),
    );

    await expect(service.login({ username: "Player_One", password: PASSWORD })).rejects.toThrow(
      "argon2 exploded",
    );
  });
});

describe("auth service rejection cost", () => {
  /** Counts the current-policy derivations one rejected login spends. */
  async function costOfRejection(passwordHash: string | null, password: string): Promise<number> {
    let hashes = 0;
    const service = buildService(
      buildRepository({
        async findUserByNormalizedUsername() {
          return passwordHash === null ? null : { ...USER, passwordHash };
        },
      }),
      buildHasher({
        async hash(candidate) {
          hashes += 1;
          return `current:${candidate}`;
        },
      }),
    );

    await expect(service.login({ username: "Player_One", password })).resolves.toEqual({
      ok: false,
      code: "invalid_credentials",
    });

    return hashes;
  }

  it("spends one current-policy derivation on every rejection path", async () => {
    // A missing user, a wrong password against a current hash, a wrong password
    // against an older cheaper hash, and a corrupt row must not be separable by
    // how much work they cost.
    const missingUser = await costOfRejection(null, "incorrect password");
    const currentPolicy = await costOfRejection(CURRENT_HASH, "incorrect password");
    const olderPolicy = await costOfRejection(OUTDATED_HASH, "incorrect password");
    const unusable = await costOfRejection(UNUSABLE_HASH, "incorrect password");

    expect(missingUser).toBe(1);
    expect(unusable).toBe(1);
    // A current-policy verification already is that derivation, so it needs no
    // top-up; an older, cheaper one does.
    expect(currentPolicy).toBe(0);
    expect(olderPolicy).toBe(1);
  });

  it("does not spend extra work when the password is correct", async () => {
    let hashes = 0;
    const service = buildService(
      buildRepository({
        async findUserByNormalizedUsername() {
          return { ...USER, passwordHash: CURRENT_HASH };
        },
      }),
      buildHasher({
        async hash(candidate) {
          hashes += 1;
          return `current:${candidate}`;
        },
      }),
    );

    await expect(
      service.login({ username: "Player_One", password: PASSWORD }),
    ).resolves.toMatchObject({ ok: true });
    expect(hashes).toBe(0);
  });

  it("sheds load rather than rejecting when the evening-out work has no capacity", async () => {
    const service = buildService(
      buildRepository({
        async findUserByNormalizedUsername() {
          return { ...USER, passwordHash: OUTDATED_HASH };
        },
      }),
      buildHasher({
        hash() {
          return Promise.reject(new KdfCapacityError());
        },
      }),
    );

    await expect(
      service.login({ username: "Player_One", password: "incorrect password" }),
    ).resolves.toEqual({ ok: false, code: "temporarily_unavailable" });
  });
});

describe("auth service unusable stored hash", () => {
  function buildUnusableHashService(reported: unknown[], hashed: string[]) {
    return buildService(
      buildRepository({
        async findUserByNormalizedUsername() {
          return { ...USER, passwordHash: UNUSABLE_HASH };
        },
      }),
      buildHasher({
        async hash(password) {
          hashed.push(password);
          return `current:${password}`;
        },
      }),
      (error) => {
        reported.push(error);
      },
    );
  }

  it("rejects the login, reports the row, and still spends the skipped work", async () => {
    const reported: unknown[] = [];
    const hashed: string[] = [];
    const service = buildUnusableHashService(reported, hashed);

    await expect(service.login({ username: "Player_One", password: PASSWORD })).resolves.toEqual({
      ok: false,
      code: "invalid_credentials",
    });

    // Parsing bailed out before Argon2, so the compensating hash is what keeps
    // this path from answering measurably faster than every other rejection.
    expect(hashed).toEqual([PASSWORD]);
    expect(reported).toHaveLength(1);
    expect(String(reported[0])).toContain(USER.id);
  });

  it("is indistinguishable from a wrong password to the caller", async () => {
    const unusable = buildUnusableHashService([], []);
    const wrongPassword = buildService(
      buildRepository({
        async findUserByNormalizedUsername() {
          return { ...USER, passwordHash: CURRENT_HASH };
        },
      }),
    );

    await expect(unusable.login({ username: "Player_One", password: PASSWORD })).resolves.toEqual(
      await wrongPassword.login({ username: "Player_One", password: "incorrect password" }),
    );
  });

  it("sheds load rather than rejecting when the compensating work has no capacity", async () => {
    const service = buildService(
      buildRepository({
        async findUserByNormalizedUsername() {
          return { ...USER, passwordHash: UNUSABLE_HASH };
        },
      }),
      buildHasher({
        hash() {
          return Promise.reject(new KdfCapacityError());
        },
      }),
    );

    await expect(service.login({ username: "Player_One", password: PASSWORD })).resolves.toEqual({
      ok: false,
      code: "temporarily_unavailable",
    });
  });

  it("never upgrades an unusable hash", async () => {
    let updates = 0;
    const service = buildService(
      buildRepository({
        async findUserByNormalizedUsername() {
          return { ...USER, passwordHash: UNUSABLE_HASH };
        },
        async updateUserPasswordHash() {
          updates += 1;
          return true;
        },
      }),
    );

    await service.login({ username: "Player_One", password: PASSWORD });

    expect(updates).toBe(0);
  });
});

describe("auth service password rehashing", () => {
  it("upgrades an accepted but outdated hash after a successful login", async () => {
    const updates: UpdateUserPasswordHashInput[] = [];
    const service = buildService(
      buildRepository({
        async findUserByNormalizedUsername() {
          return { ...USER, passwordHash: OUTDATED_HASH };
        },
        async updateUserPasswordHash(input) {
          updates.push(input);
          return true;
        },
      }),
    );

    const result = await service.login({ username: "Player_One", password: PASSWORD });

    expect(result.ok).toBe(true);
    expect(updates).toEqual([
      {
        userId: USER.id,
        previousHash: OUTDATED_HASH,
        passwordHash: CURRENT_HASH,
        updatedAt: NOW,
      },
    ]);
  });

  it("does not touch a current hash", async () => {
    let updates = 0;
    const service = buildService(
      buildRepository({
        async findUserByNormalizedUsername() {
          return { ...USER, passwordHash: CURRENT_HASH };
        },
        async updateUserPasswordHash() {
          updates += 1;
          return true;
        },
      }),
    );

    await service.login({ username: "Player_One", password: PASSWORD });

    expect(updates).toBe(0);
  });

  it("keeps the login valid when a concurrent rehash already replaced the hash", async () => {
    const service = buildService(
      buildRepository({
        async findUserByNormalizedUsername() {
          return { ...USER, passwordHash: OUTDATED_HASH };
        },
        async updateUserPasswordHash() {
          return false;
        },
      }),
    );

    await expect(
      service.login({ username: "Player_One", password: PASSWORD }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("lets two genuinely overlapping logins both succeed, with one upgrade winning", async () => {
    const reported: unknown[] = [];
    const results: boolean[] = [];
    let updateCalls = 0;

    // Both logins read the pre-upgrade row, so both attempt the same
    // compare-and-set. The row itself is modelled, not the outcomes, so the
    // assertions below cannot pass by construction.
    let rowPasswordHash = OUTDATED_HASH;

    let announceFirstReached = (): void => {};
    const firstReachedUpdate = new Promise<void>((resolve) => {
      announceFirstReached = resolve;
    });
    let announceSecondReached = (): void => {};
    const secondReachedUpdate = new Promise<void>((resolve) => {
      announceSecondReached = resolve;
    });

    const service = buildService(
      buildRepository({
        async findUserByNormalizedUsername() {
          return { ...USER, passwordHash: rowPasswordHash };
        },
        async updateUserPasswordHash(input) {
          updateCalls += 1;

          if (updateCalls === 1) {
            // The first writer parks here until the second has also reached its
            // update. Serialized logins would deadlock and time the test out,
            // so overlap is enforced by construction.
            announceFirstReached();
            await secondReachedUpdate;
          } else {
            announceSecondReached();
          }

          const won = input.previousHash === rowPasswordHash;
          if (won) {
            rowPasswordHash = input.passwordHash;
          }

          results.push(won);
          return won;
        },
      }),
      buildHasher(),
      (error) => {
        reported.push(error);
      },
    );

    const [first, second] = await Promise.all([
      service.login({ username: "Player_One", password: PASSWORD }),
      firstReachedUpdate.then(() => service.login({ username: "Player_One", password: PASSWORD })),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(updateCalls).toBe(2);
    // Exactly one write lands; the other finds the hash already replaced.
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(rowPasswordHash).toBe(CURRENT_HASH);
    // Losing the compare-and-set is a normal outcome, not something to report.
    expect(reported).toEqual([]);
  });

  it.each([
    {
      name: "the update fails",
      repository: {
        updateUserPasswordHash() {
          return Promise.reject(new Error("write failed"));
        },
      },
      hasher: {},
    },
    {
      name: "the replacement hash cannot be computed",
      repository: {},
      hasher: {
        hash() {
          return Promise.reject(new KdfCapacityError());
        },
      },
    },
  ])("keeps the login valid and reports the problem when $name", async ({ repository, hasher }) => {
    const reported: unknown[] = [];
    const service = buildService(
      buildRepository({
        async findUserByNormalizedUsername() {
          return { ...USER, passwordHash: OUTDATED_HASH };
        },
        ...repository,
      }),
      buildHasher(hasher),
      (error) => {
        reported.push(error);
      },
    );

    await expect(
      service.login({ username: "Player_One", password: PASSWORD }),
    ).resolves.toMatchObject({ ok: true });
    expect(reported).toHaveLength(1);
  });
});

describe("auth service sessions", () => {
  it("authenticates and logs out using only the token hash", async () => {
    const lookups: Array<{ tokenHash: string; now: Date }> = [];
    const deletions: string[] = [];
    const service = buildService(
      buildRepository({
        async findUserBySessionTokenHash(tokenHash, currentTime) {
          lookups.push({ tokenHash, now: currentTime });
          return USER;
        },
        async deleteSessionByTokenHash(tokenHash) {
          deletions.push(tokenHash);
        },
      }),
    );

    await expect(service.authenticateSession("session-token")).resolves.toEqual(USER);
    await service.logout("session-token");

    const expectedHash = hashSessionToken("session-token");
    expect(lookups).toEqual([{ tokenHash: expectedHash, now: NOW }]);
    expect(deletions).toEqual([expectedHash]);
  });
});
