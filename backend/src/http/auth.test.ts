import {
  AuthErrorResponseSchema,
  AuthSessionResponseSchema,
  type AuthUser,
  type LoginRequest,
  type RegisterRequest,
} from "@poe2/protocol";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterEach, describe, expect, it } from "vitest";

import type { AuthService, CreatedAuthSession } from "../auth/service.js";
import { authPlugin } from "./auth.js";

const USER: AuthUser = {
  id: "e4aa457e-7620-4f14-ae26-6c20f3995ee1",
  username: "Player_One",
};

const SESSION: CreatedAuthSession = {
  user: USER,
  token: "session-token",
  expiresAt: new Date("2026-09-02T12:00:00Z"),
};

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function buildService(overrides: Partial<AuthService> = {}): AuthService {
  return {
    async register() {
      return { ok: false, code: "username_taken" };
    },
    async login() {
      return { ok: false, code: "invalid_credentials" };
    },
    async authenticateSession() {
      return null;
    },
    async logout() {},
    ...overrides,
  };
}

function buildTestApp(
  service: AuthService,
  options: {
    readonly sessionCookieName?: string;
    readonly secureCookies?: boolean;
  } = {},
): FastifyInstance {
  const instance = Fastify();

  instance.setValidatorCompiler(validatorCompiler);
  instance.setSerializerCompiler(serializerCompiler);
  instance.register(authPlugin, {
    service,
    sessionCookieName: options.sessionCookieName ?? "poe2_session",
    secureCookies: options.secureCookies ?? false,
  });

  return instance;
}

describe("auth HTTP routes", () => {
  it("registers a user and sets an HTTP-only session cookie", async () => {
    const registrations: RegisterRequest[] = [];
    app = buildTestApp(
      buildService({
        async register(request) {
          registrations.push(request);
          return { ok: true, session: SESSION };
        },
      }),
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        username: "Player_One",
        password: "correct horse battery staple",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(AuthSessionResponseSchema.parse(response.json())).toEqual({ user: USER });
    expect(registrations).toEqual([
      {
        username: "Player_One",
        password: "correct horse battery staple",
      },
    ]);

    const setCookie = String(response.headers["set-cookie"]);
    expect(setCookie).toContain("poe2_session=session-token");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Expires=");
    expect(setCookie).not.toContain("Secure");
  });

  it("rejects invalid registration input before calling the service", async () => {
    let calls = 0;
    app = buildTestApp(
      buildService({
        async register() {
          calls += 1;
          return { ok: true, session: SESSION };
        },
      }),
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        username: "not valid",
        password: "short",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(calls).toBe(0);
  });

  it("returns a conflict for a duplicate username", async () => {
    app = buildTestApp(buildService());

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        username: "Player_One",
        password: "correct horse battery staple",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(AuthErrorResponseSchema.parse(response.json())).toEqual({
      code: "username_taken",
      message: "Username is already in use",
    });
  });

  it("logs in and sets a secure production cookie", async () => {
    const logins: LoginRequest[] = [];
    app = buildTestApp(
      buildService({
        async login(request) {
          logins.push(request);
          return { ok: true, session: SESSION };
        },
      }),
      {
        sessionCookieName: "__Host-poe2_session",
        secureCookies: true,
      },
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "PLAYER_ONE",
        password: "correct horse battery staple",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(AuthSessionResponseSchema.parse(response.json())).toEqual({ user: USER });
    expect(logins).toHaveLength(1);

    const setCookie = String(response.headers["set-cookie"]);
    expect(setCookie).toContain("__Host-poe2_session=session-token");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("HttpOnly");
  });

  it("returns one generic error for invalid credentials", async () => {
    app = buildTestApp(buildService());

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "Player_One",
        password: "incorrect password",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(AuthErrorResponseSchema.parse(response.json())).toEqual({
      code: "invalid_credentials",
      message: "Invalid username or password",
    });
  });

  it("returns the authenticated session from its cookie", async () => {
    const tokens: string[] = [];
    app = buildTestApp(
      buildService({
        async authenticateSession(token) {
          tokens.push(token);
          return USER;
        },
      }),
    );

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: {
        cookie: "poe2_session=session-token",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(AuthSessionResponseSchema.parse(response.json())).toEqual({ user: USER });
    expect(tokens).toEqual(["session-token"]);
  });

  it("rejects and clears an invalid session cookie", async () => {
    app = buildTestApp(buildService());

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: {
        cookie: "poe2_session=expired-token",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(AuthErrorResponseSchema.parse(response.json())).toEqual({
      code: "unauthenticated",
      message: "Authentication required",
    });
    expect(String(response.headers["set-cookie"])).toContain("poe2_session=");
  });

  it("logs out idempotently and clears the cookie", async () => {
    const tokens: string[] = [];
    app = buildTestApp(
      buildService({
        async logout(token) {
          tokens.push(token);
        },
      }),
    );

    const response = await app.inject({
      method: "DELETE",
      url: "/api/auth/session",
      headers: {
        cookie: "poe2_session=session-token",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect(tokens).toEqual(["session-token"]);
    expect(String(response.headers["set-cookie"])).toContain("poe2_session=");
  });

  it("rate limits combined register/login attempts from the same client", async () => {
    let calls = 0;
    app = buildTestApp(
      buildService({
        async register() {
          calls += 1;
          return { ok: false, code: "username_taken" };
        },
        async login() {
          calls += 1;
          return { ok: false, code: "invalid_credentials" };
        },
      }),
    );

    const requests = [
      ...Array.from({ length: 5 }, () => ({
        method: "POST" as const,
        url: "/api/auth/register",
      })),
      ...Array.from({ length: 5 }, () => ({
        method: "POST" as const,
        url: "/api/auth/login",
      })),
    ];

    for (const { method, url } of requests) {
      const response = await app.inject({
        method,
        url,
        payload: {
          username: "Player_One",
          password: "correct horse battery staple",
        },
      });
      expect(response.statusCode).not.toBe(429);
    }

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "Player_One",
        password: "correct horse battery staple",
      },
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBeDefined();
    expect(AuthErrorResponseSchema.parse(response.json())).toEqual({
      code: "rate_limited",
      message: "Too many authentication attempts; try again later",
    });
    expect(calls).toBe(10);
  });
});
