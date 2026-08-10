import {
  AuthErrorResponseSchema,
  AuthSessionResponseSchema,
  LoginRequestSchema,
  type AuthUser,
  type LoginRequest,
  type RegisterRequest,
} from "@poe2/protocol";
import Fastify, { type FastifyInstance, type InjectOptions } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
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

const PASSWORD = "correct horse battery staple";

/** The Compose topology: Vite in front of Fastify, one trusted hop. */
const PROXY_ADDRESS = "172.18.0.4";

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
    readonly onRegistered?: (user: AuthUser) => void;
    readonly sessionCookieName?: string;
    readonly secureCookies?: boolean;
    readonly trustProxy?: false | number;
  } = {},
): FastifyInstance {
  const instance = Fastify({ trustProxy: options.trustProxy ?? false });

  instance.setValidatorCompiler(validatorCompiler);
  instance.setSerializerCompiler(serializerCompiler);
  instance.register(authPlugin, {
    service,
    sessionCookieName: options.sessionCookieName ?? "poe2_session",
    secureCookies: options.secureCookies ?? false,
    ...(options.onRegistered === undefined ? {} : { onRegistered: options.onRegistered }),
  });

  return instance;
}

function credentials(username = "Player_One"): RegisterRequest {
  return { username, password: PASSWORD };
}

/** Sends one authentication request and returns its status code. */
async function attempt(
  instance: FastifyInstance,
  options: {
    readonly url?: string;
    readonly username?: string;
    readonly remoteAddress?: string;
    readonly forwardedFor?: string;
  } = {},
): Promise<number> {
  const inject: InjectOptions = {
    method: "POST",
    url: options.url ?? "/api/auth/login",
    payload: credentials(options.username),
    remoteAddress: options.remoteAddress ?? "203.0.113.9",
  };

  if (options.forwardedFor !== undefined) {
    inject.headers = { "x-forwarded-for": options.forwardedFor };
  }

  const response = await instance.inject(inject);
  return response.statusCode;
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
      payload: credentials(),
    });

    expect(response.statusCode).toBe(201);
    expect(AuthSessionResponseSchema.parse(response.json())).toEqual({ user: USER });
    expect(registrations).toEqual([credentials()]);

    const setCookie = String(response.headers["set-cookie"]);
    expect(setCookie).toContain("poe2_session=session-token");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Expires=");
    expect(setCookie).not.toContain("Secure");
  });

  it("announces only a successfully committed registration", async () => {
    const announced: AuthUser[] = [];
    app = buildTestApp(buildService({ register: async () => ({ ok: true, session: SESSION }) }), {
      onRegistered: (user) => announced.push(user),
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: credentials(),
    });

    expect(created.statusCode).toBe(201);
    expect(announced).toEqual([USER]);
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
      payload: { username: "not valid", password: "short" },
    });

    expect(response.statusCode).toBe(400);
    expect(calls).toBe(0);
  });

  it("returns a conflict for a duplicate username", async () => {
    app = buildTestApp(buildService());

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: credentials(),
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
      { sessionCookieName: "__Host-poe2_session", secureCookies: true },
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: credentials("PLAYER_ONE"),
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
      payload: { username: "Player_One", password: "incorrect password" },
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
      headers: { cookie: "poe2_session=session-token" },
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
      headers: { cookie: "poe2_session=expired-token" },
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
      headers: { cookie: "poe2_session=session-token" },
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect(tokens).toEqual(["session-token"]);
    expect(String(response.headers["set-cookie"])).toContain("poe2_session=");
  });
});

describe("auth per-IP rate limiting", () => {
  it("rate limits combined register/login attempts from the same client", async () => {
    let calls = 0;
    const instance = buildTestApp(
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
    app = instance;

    for (let index = 0; index < 5; index += 1) {
      expect(await attempt(instance, { url: "/api/auth/register" })).not.toBe(429);
    }

    for (let index = 0; index < 5; index += 1) {
      expect(await attempt(instance, { url: "/api/auth/login" })).not.toBe(429);
    }

    const response = await instance.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: credentials(),
      remoteAddress: "203.0.113.9",
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBeDefined();
    expect(AuthErrorResponseSchema.parse(response.json())).toEqual({
      code: "rate_limited",
      message: "Too many authentication attempts; try again later",
    });
    expect(calls).toBe(10);
  });

  it("limits one address spraying many usernames", async () => {
    const instance = buildTestApp(buildService());
    app = instance;

    // Distinct usernames, so only the per-IP limiter can be the one that fires.
    for (let index = 0; index < 10; index += 1) {
      expect(await attempt(instance, { username: `Player_${index}` })).toBe(401);
    }

    expect(await attempt(instance, { username: "Player_10" })).toBe(429);
  });

  it("keeps separate addresses in separate buckets", async () => {
    const instance = buildTestApp(buildService());
    app = instance;

    for (let index = 0; index < 10; index += 1) {
      expect(await attempt(instance, { username: `Player_${index}` })).toBe(401);
    }

    expect(await attempt(instance, { username: "Player_10" })).toBe(429);
    expect(await attempt(instance, { username: "Player_11", remoteAddress: "203.0.113.10" })).toBe(
      401,
    );
  });
});

describe("auth per-username rate limiting", () => {
  /** Each attempt comes from its own address, so only the username limit applies. */
  function attemptFromNewAddress(
    instance: FastifyInstance,
    index: number,
    username: string,
  ): Promise<number> {
    return attempt(instance, { username, remoteAddress: `198.51.100.${index}` });
  }

  it("limits one username attacked from many addresses", async () => {
    const instance = buildTestApp(buildService());
    app = instance;

    for (let index = 0; index < 10; index += 1) {
      expect(await attemptFromNewAddress(instance, index, "Player_One")).toBe(401);
    }

    expect(await attemptFromNewAddress(instance, 10, "Player_One")).toBe(429);
  });

  it("shares one budget across username case variants", async () => {
    const instance = buildTestApp(buildService());
    app = instance;

    const variants = ["Player_One", "PLAYER_ONE", "player_one", "pLaYeR_oNe"];

    for (let index = 0; index < 10; index += 1) {
      const username = variants[index % variants.length] ?? "Player_One";
      expect(await attemptFromNewAddress(instance, index, username)).toBe(401);
    }

    expect(await attemptFromNewAddress(instance, 10, "PLAYER_ONE")).toBe(429);
  });

  it("keeps different usernames in different buckets", async () => {
    const instance = buildTestApp(buildService());
    app = instance;

    for (let index = 0; index < 10; index += 1) {
      expect(await attemptFromNewAddress(instance, index, "Player_One")).toBe(401);
    }

    expect(await attemptFromNewAddress(instance, 10, "Player_One")).toBe(429);
    expect(await attemptFromNewAddress(instance, 11, "Player_Two")).toBe(401);
  });

  it("does not count a successful login as a failure", async () => {
    let succeed = false;
    const instance = buildTestApp(
      buildService({
        async login() {
          return succeed
            ? { ok: true, session: SESSION }
            : { ok: false, code: "invalid_credentials" };
        },
      }),
    );
    app = instance;

    for (let index = 0; index < 9; index += 1) {
      expect(await attemptFromNewAddress(instance, index, "Player_One")).toBe(401);
    }

    succeed = true;
    for (let index = 10; index < 20; index += 1) {
      expect(await attemptFromNewAddress(instance, index, "Player_One")).toBe(200);
    }

    // The tenth failure is still allowed through, so the successes above spent
    // nothing; the eleventh attempt is the one that is refused.
    succeed = false;
    expect(await attemptFromNewAddress(instance, 20, "Player_One")).toBe(401);
    expect(await attemptFromNewAddress(instance, 21, "Player_One")).toBe(429);
  });

  it("returns the same generic body and retry hint whichever limiter fired", async () => {
    const ipLimited = buildTestApp(buildService());
    app = ipLimited;

    for (let index = 0; index < 10; index += 1) {
      await attempt(ipLimited, { username: `Player_${index}` });
    }

    const ipResponse = await ipLimited.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: credentials("Player_10"),
      remoteAddress: "203.0.113.9",
    });

    await ipLimited.close();

    const usernameLimited = buildTestApp(buildService());
    app = usernameLimited;

    for (let index = 0; index < 10; index += 1) {
      await attemptFromNewAddress(usernameLimited, index, "Player_One");
    }

    const usernameResponse = await usernameLimited.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: credentials("Player_One"),
      remoteAddress: "198.51.100.99",
    });

    expect(ipResponse.statusCode).toBe(429);
    expect(usernameResponse.statusCode).toBe(429);
    expect(usernameResponse.json()).toEqual(ipResponse.json());
    // The windows differ by minutes, so a per-limiter TTL here would say which
    // one fired even with identical bodies.
    expect(usernameResponse.headers["retry-after"]).toBe(ipResponse.headers["retry-after"]);
    // The longer of the two windows, so the hint is never earlier than the
    // limit that actually fired.
    expect(ipResponse.headers["retry-after"]).toBe("300");
    expect(AuthErrorResponseSchema.parse(usernameResponse.json())).toEqual({
      code: "rate_limited",
      message: "Too many authentication attempts; try again later",
    });
  });

  it("does not apply the username limit to registration", async () => {
    const instance = buildTestApp(buildService());
    app = instance;

    // Registration only ever answers 409 here; it must never become a 429 from
    // the username limiter, only from the per-IP limiter.
    for (let index = 0; index < 10; index += 1) {
      expect(
        await attempt(instance, {
          url: "/api/auth/register",
          username: "Player_One",
          remoteAddress: `198.51.100.${index}`,
        }),
      ).toBe(409);
    }

    expect(
      await attempt(instance, {
        url: "/api/auth/register",
        username: "Player_One",
        remoteAddress: "198.51.100.200",
      }),
    ).toBe(409);
  });
});

describe("auth rate limiting behind a trusted proxy", () => {
  it("gives two forwarded clients independent buckets", async () => {
    const instance = buildTestApp(buildService(), { trustProxy: 1 });
    app = instance;

    for (let index = 0; index < 10; index += 1) {
      expect(
        await attempt(instance, {
          username: `Player_${index}`,
          remoteAddress: PROXY_ADDRESS,
          forwardedFor: "203.0.113.1",
        }),
      ).toBe(401);
    }

    expect(
      await attempt(instance, {
        username: "Player_10",
        remoteAddress: PROXY_ADDRESS,
        forwardedFor: "203.0.113.1",
      }),
    ).toBe(429);

    expect(
      await attempt(instance, {
        username: "Player_11",
        remoteAddress: PROXY_ADDRESS,
        forwardedFor: "203.0.113.2",
      }),
    ).toBe(401);
  });

  it("keeps one forwarded client in a single bucket across register and login", async () => {
    const instance = buildTestApp(buildService(), { trustProxy: 1 });
    app = instance;

    for (let index = 0; index < 5; index += 1) {
      expect(
        await attempt(instance, {
          url: "/api/auth/register",
          username: `Player_${index}`,
          remoteAddress: PROXY_ADDRESS,
          forwardedFor: "203.0.113.1",
        }),
      ).toBe(409);
    }

    for (let index = 0; index < 5; index += 1) {
      expect(
        await attempt(instance, {
          username: `Player_${index}`,
          remoteAddress: PROXY_ADDRESS,
          forwardedFor: "203.0.113.1",
        }),
      ).toBe(401);
    }

    expect(
      await attempt(instance, {
        username: "Player_10",
        remoteAddress: PROXY_ADDRESS,
        forwardedFor: "203.0.113.1",
      }),
    ).toBe(429);
  });

  it("ignores an address the client injected ahead of the trusted hop", async () => {
    const instance = buildTestApp(buildService(), { trustProxy: 1 });
    app = instance;

    // The proxy appends the real peer, so a client-supplied entry always sits
    // to its left and is never the address the limiter keys on.
    for (let index = 0; index < 10; index += 1) {
      expect(
        await attempt(instance, {
          username: `Player_${index}`,
          remoteAddress: PROXY_ADDRESS,
          forwardedFor: `10.0.0.${index}, 203.0.113.7`,
        }),
      ).toBe(401);
    }

    expect(
      await attempt(instance, {
        username: "Player_10",
        remoteAddress: PROXY_ADDRESS,
        forwardedFor: "10.0.0.99, 203.0.113.7",
      }),
    ).toBe(429);
  });

  it("ignores forwarding headers entirely when no proxy is trusted", async () => {
    const instance = buildTestApp(buildService());
    app = instance;

    for (let index = 0; index < 10; index += 1) {
      expect(
        await attempt(instance, {
          username: `Player_${index}`,
          remoteAddress: PROXY_ADDRESS,
          forwardedFor: `203.0.113.${index}`,
        }),
      ).toBe(401);
    }

    expect(
      await attempt(instance, {
        username: "Player_10",
        remoteAddress: PROXY_ADDRESS,
        forwardedFor: "203.0.113.99",
      }),
    ).toBe(429);
  });
});

describe("auth KDF capacity shedding", () => {
  const shedding = (): AuthService =>
    buildService({
      async register() {
        return { ok: false, code: "temporarily_unavailable" };
      },
      async login() {
        return { ok: false, code: "temporarily_unavailable" };
      },
    });

  it.each(["/api/auth/register", "/api/auth/login"])(
    "answers %s with a generic 503 and a retry hint",
    async (url) => {
      app = buildTestApp(shedding());

      const response = await app.inject({
        method: "POST",
        url,
        payload: credentials(),
      });

      expect(response.statusCode).toBe(503);
      expect(response.headers["retry-after"]).toBe("1");
      expect(AuthErrorResponseSchema.parse(response.json())).toEqual({
        code: "temporarily_unavailable",
        message: "Authentication is temporarily unavailable; try again shortly",
      });
    },
  );

  it("gives the same answer whether or not the username exists", async () => {
    const instance = buildTestApp(shedding());
    app = instance;

    const known = await instance.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: credentials("Player_One"),
      remoteAddress: "198.51.100.1",
    });
    const unknown = await instance.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: credentials("Missing_User"),
      remoteAddress: "198.51.100.2",
    });

    expect(unknown.statusCode).toBe(known.statusCode);
    expect(unknown.json()).toEqual(known.json());
  });

  it("does not spend the username failure budget", async () => {
    let shed = true;
    const instance = buildTestApp(
      buildService({
        async login() {
          return shed
            ? { ok: false, code: "temporarily_unavailable" }
            : { ok: false, code: "invalid_credentials" };
        },
      }),
    );
    app = instance;

    for (let index = 0; index < 20; index += 1) {
      expect(
        await attempt(instance, { username: "Player_One", remoteAddress: `198.51.100.${index}` }),
      ).toBe(503);
    }

    shed = false;
    for (let index = 20; index < 30; index += 1) {
      expect(
        await attempt(instance, { username: "Player_One", remoteAddress: `198.51.100.${index}` }),
      ).toBe(401);
    }

    expect(
      await attempt(instance, { username: "Player_One", remoteAddress: "198.51.100.200" }),
    ).toBe(429);
  });
});

describe("auth unexpected failures", () => {
  const exploding = (): AuthService =>
    buildService({
      register() {
        return Promise.reject(new Error("argon2 exploded"));
      },
      login() {
        return Promise.reject(new Error("argon2 exploded"));
      },
    });

  it.each(["/api/auth/register", "/api/auth/login"])(
    "answers %s with a generic typed 500 that does not echo the internal message",
    async (url) => {
      app = buildTestApp(exploding());

      const response = await app.inject({ method: "POST", url, payload: credentials() });

      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain("argon2 exploded");
      expect(AuthErrorResponseSchema.parse(response.json())).toEqual({
        code: "internal_error",
        message: "Authentication failed unexpectedly",
      });
    },
  );

  it("does not report a crypto failure as invalid credentials", async () => {
    app = buildTestApp(exploding());

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: credentials(),
    });

    expect(response.statusCode).not.toBe(401);
    expect(response.body).not.toContain("invalid_credentials");
  });

  it("leaves schema validation errors byte-for-byte alone", async () => {
    const invalid = { username: "not valid", password: "short" };

    const instance = buildTestApp(exploding());
    app = instance;

    const delegated = await instance.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: invalid,
    });

    // The same schema on a bare instance with no custom error handler, so the
    // comparison is against whatever Fastify actually produces rather than a
    // hard-coded copy of it that could drift.
    const reference = Fastify();
    reference.setValidatorCompiler(validatorCompiler);
    reference.setSerializerCompiler(serializerCompiler);
    reference
      .withTypeProvider<ZodTypeProvider>()
      .post("/api/auth/login", { schema: { body: LoginRequestSchema } }, async () => ({}));

    const expected = await reference.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: invalid,
    });
    await reference.close();

    expect(delegated.statusCode).toBe(400);
    expect(expected.statusCode).toBe(400);
    expect(delegated.json()).toEqual(expected.json());
    expect(delegated.body).not.toContain("internal_error");
  });

  it("does not spend the username failure budget on an unexpected failure", async () => {
    let explode = true;
    const instance = buildTestApp(
      buildService({
        login() {
          return explode
            ? Promise.reject(new Error("argon2 exploded"))
            : Promise.resolve({ ok: false, code: "invalid_credentials" });
        },
      }),
    );
    app = instance;

    for (let index = 0; index < 20; index += 1) {
      expect(
        await attempt(instance, { username: "Player_One", remoteAddress: `198.51.100.${index}` }),
      ).toBe(500);
    }

    explode = false;
    for (let index = 20; index < 30; index += 1) {
      expect(
        await attempt(instance, { username: "Player_One", remoteAddress: `198.51.100.${index}` }),
      ).toBe(401);
    }

    expect(
      await attempt(instance, { username: "Player_One", remoteAddress: "198.51.100.200" }),
    ).toBe(429);
  });
});
