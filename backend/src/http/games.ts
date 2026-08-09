import {
  GameReplaySchema,
  GamesErrorResponseSchema,
  type GamesErrorResponse,
} from "@poe2/protocol";
import type { FastifyError, FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { HistoryService } from "../game/history-service.js";
import type { RateLimiter } from "../limits/rate-limiter.js";
import { clientAddressKey } from "./client-address.js";

export const REPLAY_ROUTE = "/api/games/:gameId";

export interface GamesHttpOptions {
  readonly historyService: HistoryService;
  readonly readLimiter: RateLimiter;
}

/** Do not reveal whether a valid id belongs to a live game. */
const NOT_FOUND: GamesErrorResponse = {
  code: "game_not_found",
  message: "No such game",
};

const INVALID_REQUEST: GamesErrorResponse = {
  code: "invalid_request",
  message: "That request was not in a shape this endpoint accepts",
};

const RATE_LIMITED: GamesErrorResponse = {
  code: "rate_limited",
  message: "Too many requests; try again shortly",
};

const INTERNAL_ERROR: GamesErrorResponse = {
  code: "internal_error",
  message: "The request could not be completed",
};

const MS_PER_SECOND = 1_000;

const replayParamsSchema = z.strictObject({ gameId: z.uuid() });

export const gamesPlugin: FastifyPluginAsync<GamesHttpOptions> = async (app, options) => {
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    // Keep validation failures inside this API's declared error union.
    if (error.validation !== undefined) {
      return reply.code(400).send(INVALID_REQUEST);
    }

    const statusCode = error.statusCode ?? 500;

    if (statusCode < 500) {
      return reply.send(error);
    }

    request.log.error({ err: error }, "unexpected games failure");
    return reply.code(500).send(INTERNAL_ERROR);
  });

  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get(
    REPLAY_ROUTE,
    {
      schema: {
        params: replayParamsSchema,
        response: {
          200: GameReplaySchema,
          400: GamesErrorResponseSchema,
          404: GamesErrorResponseSchema,
          429: GamesErrorResponseSchema,
          500: GamesErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      // Charge the public request before replay materialization.
      const budget = await options.readLimiter.consume(clientAddressKey(request));
      if (!budget.allowed) {
        return reply
          .code(429)
          .header("retry-after", String(Math.ceil(budget.retryAfterMs / MS_PER_SECOND)))
          .send(RATE_LIMITED);
      }

      const game = await options.historyService.findReplay(request.params.gameId);

      return game === null ? reply.code(404).send(NOT_FOUND) : game;
    },
  );
};
