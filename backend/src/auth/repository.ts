import type { AuthUser } from "@poe2/protocol";
import { and, eq, gt } from "drizzle-orm";

import type { Database } from "../db/client.js";
import { sessions, users } from "../db/schema.js";

export interface StoredUser extends AuthUser {
  readonly passwordHash: string;
}

export interface CreateUserWithSessionInput {
  readonly username: string;
  readonly normalizedUsername: string;
  readonly passwordHash: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export interface CreateSessionInput {
  readonly userId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export interface UpdateUserPasswordHashInput {
  readonly userId: string;
  /** The hash the caller verified against, so a concurrent upgrade wins once. */
  readonly previousHash: string;
  readonly passwordHash: string;
  readonly updatedAt: Date;
}

export interface AuthRepository {
  createUserWithSession(input: CreateUserWithSessionInput): Promise<AuthUser | null>;
  findUserByNormalizedUsername(normalizedUsername: string): Promise<StoredUser | null>;
  /**
   * Rewrites a stored password hash in place. Returns whether a row changed:
   * `false` means another request already replaced the same hash, which is a
   * harmless race, not a failure.
   */
  updateUserPasswordHash(input: UpdateUserPasswordHashInput): Promise<boolean>;
  createSession(input: CreateSessionInput): Promise<void>;
  findUserBySessionTokenHash(tokenHash: string, now: Date): Promise<AuthUser | null>;
  deleteSessionByTokenHash(tokenHash: string): Promise<void>;
}

export function createAuthRepository(db: Database): AuthRepository {
  return {
    createUserWithSession: (input) =>
      db.transaction(async (transaction) => {
        const [user] = await transaction
          .insert(users)
          .values({
            username: input.username,
            normalizedUsername: input.normalizedUsername,
            passwordHash: input.passwordHash,
          })
          .onConflictDoNothing({ target: users.normalizedUsername })
          .returning({
            id: users.id,
            username: users.username,
          });

        if (user === undefined) {
          return null;
        }

        await transaction.insert(sessions).values({
          userId: user.id,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
        });

        return user;
      }),

    async findUserByNormalizedUsername(normalizedUsername) {
      const [user] = await db
        .select({
          id: users.id,
          username: users.username,
          passwordHash: users.passwordHash,
        })
        .from(users)
        .where(eq(users.normalizedUsername, normalizedUsername))
        .limit(1);

      return user ?? null;
    },

    async updateUserPasswordHash(input) {
      const updated = await db
        .update(users)
        .set({ passwordHash: input.passwordHash, updatedAt: input.updatedAt })
        .where(and(eq(users.id, input.userId), eq(users.passwordHash, input.previousHash)))
        .returning({ id: users.id });

      return updated.length > 0;
    },

    async createSession(input) {
      await db.insert(sessions).values(input);
    },

    async findUserBySessionTokenHash(tokenHash, now) {
      const [user] = await db
        .select({
          id: users.id,
          username: users.username,
        })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
        .limit(1);

      return user ?? null;
    },

    async deleteSessionByTokenHash(tokenHash) {
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    },
  };
}
