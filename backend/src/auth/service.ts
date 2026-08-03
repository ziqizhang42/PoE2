import type { AuthUser, LoginRequest, RegisterRequest } from "@poe2/protocol";

import { hashPassword, verifyPassword } from "./password.js";
import type { AuthRepository } from "./repository.js";
import { generateSessionToken, hashSessionToken } from "./session-token.js";
import { normalizeUsername } from "./username.js";

const DEFAULT_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1_000;

export interface CreatedAuthSession {
  readonly user: AuthUser;
  readonly token: string;
  readonly expiresAt: Date;
}

export type RegistrationResult =
  | { readonly ok: true; readonly session: CreatedAuthSession }
  | { readonly ok: false; readonly code: "username_taken" };

export type LoginResult =
  | { readonly ok: true; readonly session: CreatedAuthSession }
  | { readonly ok: false; readonly code: "invalid_credentials" };

export interface AuthService {
  register(request: RegisterRequest): Promise<RegistrationResult>;
  login(request: LoginRequest): Promise<LoginResult>;
  authenticateSession(token: string): Promise<AuthUser | null>;
  logout(token: string): Promise<void>;
}

export interface AuthServiceOptions {
  readonly now?: () => Date;
  readonly sessionDurationMs?: number;
}

export function createAuthService(
  repository: AuthRepository,
  options: AuthServiceOptions = {},
): AuthService {
  const now = options.now ?? (() => new Date());
  const sessionDurationMs = options.sessionDurationMs ?? DEFAULT_SESSION_DURATION_MS;

  return {
    async register(request) {
      const passwordHash = await hashPassword(request.password);
      const generated = generateSessionToken();
      const expiresAt = new Date(now().getTime() + sessionDurationMs);

      const user = await repository.createUserWithSession({
        username: request.username,
        normalizedUsername: normalizeUsername(request.username),
        passwordHash,
        tokenHash: generated.tokenHash,
        expiresAt,
      });

      if (user === null) {
        return { ok: false, code: "username_taken" };
      }

      return {
        ok: true,
        session: {
          user,
          token: generated.token,
          expiresAt,
        },
      };
    },

    async login(request) {
      const storedUser = await repository.findUserByNormalizedUsername(
        normalizeUsername(request.username),
      );

      if (storedUser === null) {
        // Keep missing-user and wrong-password attempts computationally similar.
        await hashPassword(request.password);
        return { ok: false, code: "invalid_credentials" };
      }

      if (!(await verifyPassword(request.password, storedUser.passwordHash))) {
        return { ok: false, code: "invalid_credentials" };
      }

      const generated = generateSessionToken();
      const expiresAt = new Date(now().getTime() + sessionDurationMs);
      const user: AuthUser = {
        id: storedUser.id,
        username: storedUser.username,
      };

      await repository.createSession({
        userId: user.id,
        tokenHash: generated.tokenHash,
        expiresAt,
      });

      return {
        ok: true,
        session: {
          user,
          token: generated.token,
          expiresAt,
        },
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
