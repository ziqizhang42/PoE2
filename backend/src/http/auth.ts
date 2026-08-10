import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import {
  AuthErrorResponseSchema,
  AuthSessionResponseSchema,
  LoginRequestSchema,
  RegisterRequestSchema,
  type AuthErrorResponse,
  type AuthSessionResponse,
  type LoginRequest,
} from "@poe2/protocol";
import type { FastifyError, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import type { AuthService, CreatedAuthSession } from "../auth/service.js";
import { normalizeUsername } from "../auth/username.js";
import type { AuthConfig } from "../config/auth.js";

export interface AuthHttpOptions extends AuthConfig {
  readonly service: AuthService;
  /** Announces the durable account only after registration has committed. */
  readonly onRegistered?: (user: AuthSessionResponse["user"]) => void;
}

/**
 * Two independent limiters, because they defend against different things.
 *
 * The per-IP limiter caps how much authentication traffic one client may
 * generate at all, register and login together, and runs before any expensive
 * work. The per-username limiter caps failed logins against a single account no
 * matter how many addresses they come from, which is what a distributed
 * password-guessing attempt looks like.
 *
 * Neither replaces the other, and they are never combined into one
 * `IP + username` key: such a key would reset for every new address and so
 * would not slow a distributed attack down at all.
 */
const IP_ATTEMPT_LIMIT = 10;
const IP_ATTEMPT_WINDOW = "1 minute";

/** Failed logins tolerated per normalized username before the account locks out. */
const USERNAME_FAILURE_LIMIT = 10;
const USERNAME_FAILURE_WINDOW = "5 minutes";

/**
 * A fixed hint, in seconds, rather than each limiter's own remaining TTL. The
 * two windows differ by minutes, so a real TTL would say which limiter fired
 * even though the bodies are identical.
 *
 * It is the longer of the two windows, because `Retry-After` is a floor: a
 * shorter hint would send a username-locked client back early, and each early
 * retry still spends the per-IP budget.
 */
const RATE_LIMIT_RETRY_AFTER_SECONDS = 300;

/** How long a load-shed client is asked to wait, in seconds. */
const CAPACITY_RETRY_AFTER_SECONDS = 1;

const USERNAME_TAKEN_RESPONSE: AuthErrorResponse = {
  code: "username_taken",
  message: "Username is already in use",
};

const INVALID_CREDENTIALS_RESPONSE: AuthErrorResponse = {
  code: "invalid_credentials",
  message: "Invalid username or password",
};

const UNAUTHENTICATED_RESPONSE: AuthErrorResponse = {
  code: "unauthenticated",
  message: "Authentication required",
};

/**
 * One body for both limiters. A distinct message per limiter would tell an
 * attacker whether a username exists and which defence they tripped.
 */
const RATE_LIMITED_RESPONSE: AuthErrorResponse = {
  code: "rate_limited",
  message: "Too many authentication attempts; try again later",
};

const TEMPORARILY_UNAVAILABLE_RESPONSE: AuthErrorResponse = {
  code: "temporarily_unavailable",
  message: "Authentication is temporarily unavailable; try again shortly",
};

/** Replaces Fastify's default 500, which would echo the internal message. */
const INTERNAL_ERROR_RESPONSE: AuthErrorResponse = {
  code: "internal_error",
  message: "Authentication failed unexpectedly",
};

export const authPlugin: FastifyPluginAsync<AuthHttpOptions> = async (app, options) => {
  await app.register(cookie);

  /**
   * An unexpected failure - a crypto fault, a lost database connection - must
   * not reach the client as Fastify's default body, which echoes the internal
   * message. Client errors, including schema validation, are handed back to the
   * enclosing handler unchanged.
   */
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const statusCode = error.statusCode ?? 500;

    if (statusCode < 500) {
      return reply.send(error);
    }

    request.log.error({ err: error }, "unexpected authentication failure");
    return reply.code(500).send(INTERNAL_ERROR_RESPONSE);
  });

  await app.register(rateLimit, {
    global: false,
    ipv6Subnet: 64,
    max: IP_ATTEMPT_LIMIT,
    timeWindow: IP_ATTEMPT_WINDOW,
  });

  // Keyed on `request.ip`, which is the real client only as far as the
  // configured trusted-proxy hop count allows.
  const checkAttemptRateLimit = app.createRateLimit();

  // Its own store and key space, keyed on the same normalization the lookup
  // uses so `Player_One` and `PLAYER_ONE` share one budget.
  const checkUsernameRateLimit = app.createRateLimit({
    max: USERNAME_FAILURE_LIMIT,
    timeWindow: USERNAME_FAILURE_WINDOW,
    keyGenerator: (request) => usernameKey(request),
  });

  const enforceAttemptRateLimit = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply | undefined> => {
    const result = await checkAttemptRateLimit(request);

    if (result.isAllowed || !result.isExceeded) {
      return undefined;
    }

    return sendRateLimited(reply);
  };

  /**
   * Peeks at the username budget without spending it, so a successful login is
   * never recorded as a failure. Only `recordUsernameFailure` increments.
   *
   * Concurrent requests can all peek before any of them increments, so this is
   * not a hard cap on simultaneous guesses. The KDF capacity bound is what
   * keeps that burst from turning into unbounded Argon2 work.
   */
  const enforceUsernameRateLimit = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply | undefined> => {
    const result = await checkUsernameRateLimit(request, { increment: false });

    // `remaining` is the unspent failure budget, so zero means the limit has
    // already been reached and this attempt must not proceed.
    if (result.isAllowed || result.remaining > 0) {
      return undefined;
    }

    return sendRateLimited(reply);
  };

  const recordUsernameFailure = async (request: FastifyRequest): Promise<void> => {
    await checkUsernameRateLimit(request);
  };

  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.post(
    "/api/auth/register",
    {
      onRequest: enforceAttemptRateLimit,
      schema: {
        body: RegisterRequestSchema,
        response: {
          201: AuthSessionResponseSchema,
          409: AuthErrorResponseSchema,
          429: AuthErrorResponseSchema,
          500: AuthErrorResponseSchema,
          503: AuthErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await options.service.register(request.body);

      if (!result.ok) {
        return result.code === "temporarily_unavailable"
          ? sendTemporarilyUnavailable(reply)
          : reply.code(409).send(USERNAME_TAKEN_RESPONSE);
      }

      setSessionCookie(reply, options, result.session);

      const response: AuthSessionResponse = {
        user: result.session.user,
      };
      try {
        options.onRegistered?.(response.user);
      } catch (error) {
        // Registration is already durable; a transient push failure cannot undo it.
        request.log.error({ err: error }, "could not announce registered player");
      }
      return reply.code(201).send(response);
    },
  );

  routes.post(
    "/api/auth/login",
    {
      onRequest: enforceAttemptRateLimit,
      // After validation, so the username is known to be well formed before it
      // becomes a rate-limit key.
      preHandler: enforceUsernameRateLimit,
      schema: {
        body: LoginRequestSchema,
        response: {
          200: AuthSessionResponseSchema,
          401: AuthErrorResponseSchema,
          429: AuthErrorResponseSchema,
          500: AuthErrorResponseSchema,
          503: AuthErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await options.service.login(request.body);

      if (!result.ok) {
        if (result.code === "temporarily_unavailable") {
          // Shed load is not a credential failure, so it must not consume the
          // account's failure budget.
          return sendTemporarilyUnavailable(reply);
        }

        await recordUsernameFailure(request);
        return reply.code(401).send(INVALID_CREDENTIALS_RESPONSE);
      }

      setSessionCookie(reply, options, result.session);

      const response: AuthSessionResponse = {
        user: result.session.user,
      };
      return response;
    },
  );

  routes.get(
    "/api/auth/session",
    {
      schema: {
        response: {
          200: AuthSessionResponseSchema,
          401: AuthErrorResponseSchema,
          500: AuthErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const token = request.cookies[options.sessionCookieName];

      if (token === undefined) {
        return reply.code(401).send(UNAUTHENTICATED_RESPONSE);
      }

      const user = await options.service.authenticateSession(token);

      if (user === null) {
        clearSessionCookie(reply, options);
        return reply.code(401).send(UNAUTHENTICATED_RESPONSE);
      }

      const response: AuthSessionResponse = { user };
      return response;
    },
  );

  routes.delete("/api/auth/session", async (request, reply) => {
    const token = request.cookies[options.sessionCookieName];

    if (token !== undefined) {
      await options.service.logout(token);
    }

    clearSessionCookie(reply, options);
    return reply.code(204).send();
  });
};

/**
 * The login body has already passed `LoginRequestSchema` by the time this runs,
 * but the limiter is reached through Fastify's untyped request, so the shape is
 * re-checked.
 */
function usernameKey(request: FastifyRequest): string {
  const body: unknown = request.body;

  if (typeof body !== "object" || body === null) {
    return "";
  }

  const { username } = body as Partial<LoginRequest>;

  return typeof username === "string" ? normalizeUsername(username) : "";
}

function sendRateLimited(reply: FastifyReply): FastifyReply {
  reply.header("retry-after", String(RATE_LIMIT_RETRY_AFTER_SECONDS));
  return reply.code(429).send(RATE_LIMITED_RESPONSE);
}

function sendTemporarilyUnavailable(reply: FastifyReply): FastifyReply {
  reply.header("retry-after", String(CAPACITY_RETRY_AFTER_SECONDS));
  return reply.code(503).send(TEMPORARILY_UNAVAILABLE_RESPONSE);
}

function setSessionCookie(
  reply: FastifyReply,
  options: AuthHttpOptions,
  session: CreatedAuthSession,
): void {
  reply.setCookie(options.sessionCookieName, session.token, {
    expires: session.expiresAt,
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: options.secureCookies,
  });
}

function clearSessionCookie(reply: FastifyReply, options: AuthHttpOptions): void {
  reply.clearCookie(options.sessionCookieName, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: options.secureCookies,
  });
}
