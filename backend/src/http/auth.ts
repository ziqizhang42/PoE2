import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import {
  AuthErrorResponseSchema,
  AuthSessionResponseSchema,
  LoginRequestSchema,
  RegisterRequestSchema,
  type AuthErrorResponse,
  type AuthSessionResponse,
} from "@poe2/protocol";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import type { AuthService, CreatedAuthSession } from "../auth/service.js";
import type { AuthConfig } from "../config/auth.js";

export interface AuthHttpOptions extends AuthConfig {
  readonly service: AuthService;
}

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

const RATE_LIMITED_RESPONSE: AuthErrorResponse = {
  code: "rate_limited",
  message: "Too many authentication attempts; try again later",
};

export const authPlugin: FastifyPluginAsync<AuthHttpOptions> = async (app, options) => {
  await app.register(cookie);

  await app.register(rateLimit, {
    global: false,
    ipv6Subnet: 64,
    max: 10,
    timeWindow: "1 minute",
  });

  const checkPasswordRateLimit = app.createRateLimit();

  const enforcePasswordRateLimit = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply | undefined> => {
    const result = await checkPasswordRateLimit(request);

    if (result.isAllowed || !result.isExceeded) {
      return undefined;
    }

    reply.header("retry-after", String(result.ttlInSeconds));
    reply.code(429).send(RATE_LIMITED_RESPONSE);
    return reply;
  };

  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.post(
    "/api/auth/register",
    {
      onRequest: enforcePasswordRateLimit,
      schema: {
        body: RegisterRequestSchema,
        response: {
          201: AuthSessionResponseSchema,
          409: AuthErrorResponseSchema,
          429: AuthErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await options.service.register(request.body);

      if (!result.ok) {
        return reply.code(409).send(USERNAME_TAKEN_RESPONSE);
      }

      setSessionCookie(reply, options, result.session);

      const response: AuthSessionResponse = {
        user: result.session.user,
      };
      return reply.code(201).send(response);
    },
  );

  routes.post(
    "/api/auth/login",
    {
      onRequest: enforcePasswordRateLimit,
      schema: {
        body: LoginRequestSchema,
        response: {
          200: AuthSessionResponseSchema,
          401: AuthErrorResponseSchema,
          429: AuthErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await options.service.login(request.body);

      if (!result.ok) {
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
