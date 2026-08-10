import {
  GameHistoryPageSchema,
  HISTORY_PAGE_LIMIT,
  MAX_HISTORY_PAGE_LIMIT,
  normalizeUsername,
  PlayerDirectorySchema,
  PlayerErrorResponseSchema,
  PublicPlayerProfileSchema,
  UsernameSchema,
  type PlayerErrorResponse,
} from "@poe2/protocol";
import cookie from "@fastify/cookie";
import type { FastifyError, FastifyPluginAsync, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { decodeHistoryCursor } from "../game/history-cursor.js";
import type { HistoryService } from "../game/history-service.js";
import type { PlayerRepository } from "../player/repository.js";
import type { RateLimiter } from "../limits/rate-limiter.js";
import { clientAddressKey } from "./client-address.js";
import { readSessionUser, type SessionReaderOptions } from "./session.js";

export const PLAYER_DIRECTORY_ROUTE = "/api/players";
export const PLAYER_ROUTE = "/api/players/:username";
export const PLAYER_GAMES_ROUTE = "/api/players/:username/games";

export interface PlayersHttpOptions {
  readonly repository: PlayerRepository;
  readonly historyService: HistoryService;
  readonly session: SessionReaderOptions;
  /** Authenticated directory reads have their own address budget. */
  readonly directoryLimiter: RateLimiter;
  readonly readLimiter: RateLimiter;
  /** Separate, tighter budget because history pages materialize many replays. */
  readonly historyLimiter: RateLimiter;
}

const INVALID_REQUEST: PlayerErrorResponse = {
  code: "invalid_request",
  message: "That request was not in a shape this endpoint accepts",
};
const NOT_FOUND: PlayerErrorResponse = {
  code: "player_not_found",
  message: "No such player",
};
const INVALID_CURSOR: PlayerErrorResponse = {
  code: "invalid_cursor",
  message: "That page cursor is not one this server issued",
};
const RATE_LIMITED: PlayerErrorResponse = {
  code: "rate_limited",
  message: "Too many requests; try again shortly",
};
const UNAUTHENTICATED: PlayerErrorResponse = {
  code: "unauthenticated",
  message: "Authentication required",
};
const INTERNAL_ERROR: PlayerErrorResponse = {
  code: "internal_error",
  message: "The request could not be completed",
};
const MS_PER_SECOND = 1_000;

const usernameParamsSchema = z.strictObject({ username: UsernameSchema });

const historyQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(MAX_HISTORY_PAGE_LIMIT).default(HISTORY_PAGE_LIMIT),
  cursor: z.string().min(1).optional(),
});

export const playersPlugin: FastifyPluginAsync<PlayersHttpOptions> = async (app, options) => {
  // Initializes the cookie parser in this independently testable route scope.
  await app.register(cookie);

  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error.validation !== undefined) {
      return reply.code(400).send(INVALID_REQUEST);
    }
    if ((error.statusCode ?? 500) < 500) {
      return reply.send(error);
    }
    request.log.error({ err: error }, "unexpected public profile failure");
    return reply.code(500).send(INTERNAL_ERROR);
  });

  const spend = async (limiter: RateLimiter, key: string, reply: FastifyReply) => {
    const budget = await limiter.consume(key);
    if (budget.allowed) {
      return true;
    }

    await reply
      .code(429)
      .header("retry-after", String(Math.ceil(budget.retryAfterMs / MS_PER_SECOND)))
      .send(RATE_LIMITED);
    return false;
  };

  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get(
    PLAYER_DIRECTORY_ROUTE,
    {
      schema: {
        response: {
          200: PlayerDirectorySchema,
          401: PlayerErrorResponseSchema,
          429: PlayerErrorResponseSchema,
          500: PlayerErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const user = await readSessionUser(request, options.session);
      if (user === null) {
        return reply.code(401).send(UNAUTHENTICATED);
      }

      if (!(await spend(options.directoryLimiter, clientAddressKey(request), reply))) {
        return reply;
      }

      return options.repository.listDirectory();
    },
  );

  routes.get(
    PLAYER_ROUTE,
    {
      schema: {
        params: usernameParamsSchema,
        response: {
          200: PublicPlayerProfileSchema,
          400: PlayerErrorResponseSchema,
          404: PlayerErrorResponseSchema,
          429: PlayerErrorResponseSchema,
          500: PlayerErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!(await spend(options.readLimiter, clientAddressKey(request), reply))) {
        return reply;
      }

      const profile = await options.repository.findPublicProfile(
        normalizeUsername(request.params.username),
      );
      return profile === null ? reply.code(404).send(NOT_FOUND) : profile;
    },
  );

  routes.get(
    PLAYER_GAMES_ROUTE,
    {
      schema: {
        params: usernameParamsSchema,
        querystring: historyQuerySchema,
        response: {
          200: GameHistoryPageSchema,
          400: PlayerErrorResponseSchema,
          404: PlayerErrorResponseSchema,
          429: PlayerErrorResponseSchema,
          500: PlayerErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!(await spend(options.historyLimiter, clientAddressKey(request), reply))) {
        return reply;
      }

      const encoded = request.query.cursor;
      const before = encoded === undefined ? null : decodeHistoryCursor(encoded);

      // Restarting on an invalid cursor would silently duplicate the first page.
      if (encoded !== undefined && before === null) {
        return reply.code(400).send(INVALID_CURSOR);
      }

      const playerId = await options.repository.findUserIdByUsername(
        normalizeUsername(request.params.username),
      );
      if (playerId === null) {
        return reply.code(404).send(NOT_FOUND);
      }

      return options.historyService.listHistory({
        playerId,
        limit: request.query.limit,
        before,
      });
    },
  );
};
