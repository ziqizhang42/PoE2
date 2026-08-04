import type { AuthUser, LoginRequest, RegisterRequest } from "@poe2/protocol";

import { isKdfCapacityError } from "./kdf-executor.js";
import type { PasswordHasher } from "./password.js";
import type { AuthRepository } from "./repository.js";
import { generateSessionToken, hashSessionToken } from "./session-token.js";
import { normalizeUsername } from "./username.js";

const DEFAULT_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1_000;

export interface CreatedAuthSession {
  readonly user: AuthUser;
  readonly token: string;
  readonly expiresAt: Date;
}

/** Password work was shed to stay inside the KDF capacity bound. */
export interface TemporarilyUnavailableResult {
  readonly ok: false;
  readonly code: "temporarily_unavailable";
}

export type RegistrationResult =
  | { readonly ok: true; readonly session: CreatedAuthSession }
  | { readonly ok: false; readonly code: "username_taken" }
  | TemporarilyUnavailableResult;

export type LoginResult =
  | { readonly ok: true; readonly session: CreatedAuthSession }
  | { readonly ok: false; readonly code: "invalid_credentials" }
  | TemporarilyUnavailableResult;

export interface AuthService {
  register(request: RegisterRequest): Promise<RegistrationResult>;
  login(request: LoginRequest): Promise<LoginResult>;
  authenticateSession(token: string): Promise<AuthUser | null>;
  logout(token: string): Promise<void>;
}

export interface AuthServiceOptions {
  readonly now?: () => Date;
  readonly sessionDurationMs?: number;
  /**
   * Reports a problem that was deliberately not allowed to fail the request: a
   * password rehash that could not be persisted, or a stored hash that could
   * not be parsed at all.
   */
  readonly onRecoveredError?: (error: unknown) => void;
}

const TEMPORARILY_UNAVAILABLE: TemporarilyUnavailableResult = {
  ok: false,
  code: "temporarily_unavailable",
};

/** Either the KDF result, or a marker that capacity was exhausted. */
type KdfOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

/**
 * Turns capacity exhaustion into a value while letting every other crypto
 * failure propagate, so an unexpected fault is never reported as a bad
 * password.
 */
async function withKdfCapacity<T>(work: () => Promise<T>): Promise<KdfOutcome<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (isKdfCapacityError(error)) {
      return { ok: false };
    }

    throw error;
  }
}

export function createAuthService(
  repository: AuthRepository,
  hasher: PasswordHasher,
  options: AuthServiceOptions = {},
): AuthService {
  const now = options.now ?? (() => new Date());
  const sessionDurationMs = options.sessionDurationMs ?? DEFAULT_SESSION_DURATION_MS;
  const onRecoveredError = options.onRecoveredError ?? (() => {});

  function newSessionMaterial(): {
    readonly token: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
  } {
    const generated = generateSessionToken();

    return {
      token: generated.token,
      tokenHash: generated.tokenHash,
      expiresAt: new Date(now().getTime() + sessionDurationMs),
    };
  }

  /**
   * Replaces an accepted-but-outdated hash with a current-policy one. Every
   * failure here — including another request having already upgraded the same
   * row — leaves the caller logged in with a hash that still verifies.
   *
   * Awaited rather than detached: a floating promise would be an unhandled
   * rejection risk and would make the upgrade untestable. The cost is that a
   * login during a policy migration spends two KDF slots in sequence, verify
   * then rehash, which the capacity bound absorbs by shedding load.
   */
  async function upgradePasswordHash(
    userId: string,
    previousHash: string,
    password: string,
  ): Promise<void> {
    try {
      const passwordHash = await hasher.hash(password);

      await repository.updateUserPasswordHash({
        userId,
        previousHash,
        passwordHash,
        updatedAt: now(),
      });
    } catch (error) {
      onRecoveredError(error);
    }
  }

  /**
   * Refuses a login only after spending one current-policy derivation, so no
   * rejection path is measurably cheaper than any other and response time does
   * not say which usernames exist.
   *
   * This bounds the difference rather than erasing it. A wrong password against
   * a hash stored under an older, cheaper policy still costs that cheaper
   * verification on top, so it ends up slightly slower than the others - the
   * safe direction, and the gap closes as logins migrate hashes forward.
   */
  async function rejectAfterCurrentPolicyWork(password: string): Promise<LoginResult> {
    const work = await withKdfCapacity(() => hasher.hash(password));

    return work.ok ? { ok: false, code: "invalid_credentials" } : TEMPORARILY_UNAVAILABLE;
  }

  return {
    async register(request) {
      const hashed = await withKdfCapacity(() => hasher.hash(request.password));
      if (!hashed.ok) {
        return TEMPORARILY_UNAVAILABLE;
      }

      const material = newSessionMaterial();

      const user = await repository.createUserWithSession({
        username: request.username,
        normalizedUsername: normalizeUsername(request.username),
        passwordHash: hashed.value,
        tokenHash: material.tokenHash,
        expiresAt: material.expiresAt,
      });

      if (user === null) {
        return { ok: false, code: "username_taken" };
      }

      return {
        ok: true,
        session: { user, token: material.token, expiresAt: material.expiresAt },
      };
    },

    async login(request) {
      const storedUser = await repository.findUserByNormalizedUsername(
        normalizeUsername(request.username),
      );

      if (storedUser === null) {
        return rejectAfterCurrentPolicyWork(request.password);
      }

      const verification = await withKdfCapacity(() =>
        hasher.verify(request.password, storedUser.passwordHash),
      );

      if (!verification.ok) {
        return TEMPORARILY_UNAVAILABLE;
      }

      if (verification.value.outcome === "unusable_hash") {
        // The row is corrupt or tampered, so this account cannot log in at all
        // until someone notices.
        onRecoveredError(
          new Error(`stored password hash for user ${storedUser.id} could not be parsed`),
        );

        // Parsing bailed out before Argon2, so this path has spent nothing yet.
        return rejectAfterCurrentPolicyWork(request.password);
      }

      if (verification.value.outcome === "mismatch") {
        // A hash stored under an older, cheaper policy has just cost less than
        // a current-policy one would, which on its own would make "this account
        // exists but is not yet migrated" the fastest answer of all.
        return verification.value.storedPolicyIsCurrent
          ? { ok: false, code: "invalid_credentials" }
          : rejectAfterCurrentPolicyWork(request.password);
      }

      const user: AuthUser = {
        id: storedUser.id,
        username: storedUser.username,
      };
      const material = newSessionMaterial();

      await repository.createSession({
        userId: user.id,
        tokenHash: material.tokenHash,
        expiresAt: material.expiresAt,
      });

      if (verification.value.outcome === "verified" && verification.value.needsRehash) {
        await upgradePasswordHash(storedUser.id, storedUser.passwordHash, request.password);
      }

      return {
        ok: true,
        session: { user, token: material.token, expiresAt: material.expiresAt },
      };
    },

    authenticateSession(token) {
      return repository.findUserBySessionTokenHash(hashSessionToken(token), now());
    },

    async logout(token) {
      await repository.deleteSessionByTokenHash(hashSessionToken(token));
    },
  };
}
