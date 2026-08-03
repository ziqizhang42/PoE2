import { AuthErrorResponseSchema, AuthSessionResponseSchema } from "@poe2/protocol";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createAuthRepository } from "../auth/repository.js";
import { createAuthService } from "../auth/service.js";
import { buildApp } from "../app.js";
import { readAuthConfig } from "../config/auth.js";
import { readDatabaseConfig } from "../config/database.js";
import { createDatabaseClient } from "../db/client.js";
import { users } from "../db/schema.js";
import { authPlugin } from "./auth.js";

const PASSWORD = "correct horse battery staple";

const database = createDatabaseClient(readDatabaseConfig(process.env));
const app = buildApp();
const authConfig = readAuthConfig({ NODE_ENV: "test" });

app.register(authPlugin, {
  ...authConfig,
  service: createAuthService(createAuthRepository(database.db)),
});

beforeEach(() => database.db.delete(users));

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

describe("auth HTTP integration", () => {
  it("registers, authenticates, rejects a duplicate, and logs out", async () => {
    const registration = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        username: "Player_One",
        password: PASSWORD,
      },
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
      payload: {
        username: "PLAYER_ONE",
        password: PASSWORD,
      },
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
      payload: {
        username: "Player_One",
        password: PASSWORD,
      },
    });

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "PLAYER_ONE",
        password: PASSWORD,
      },
    });

    expect(login.statusCode).toBe(200);
    expect(AuthSessionResponseSchema.parse(login.json()).user.username).toBe("Player_One");
    expect(extractCookie(login.headers["set-cookie"])).toMatch(/^poe2_session=/u);

    const wrongPassword = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "Player_One",
        password: "incorrect password",
      },
    });

    const missingUser = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "Missing_User",
        password: "incorrect password",
      },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(missingUser.statusCode).toBe(401);
    expect(AuthErrorResponseSchema.parse(wrongPassword.json())).toEqual(
      AuthErrorResponseSchema.parse(missingUser.json()),
    );
  });
});
