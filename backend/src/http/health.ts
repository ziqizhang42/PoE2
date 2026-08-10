import type { FastifyPluginAsync } from "fastify";
import type { FastifyPluginCallbackZod, ZodTypeProvider } from "fastify-type-provider-zod";

import {
  HealthResponseSchema,
  ReadinessResponseSchema,
  type HealthResponse,
  type ReadinessResponse,
} from "@poe2/protocol";

const READY: ReadinessResponse = { status: "ok" };
const UNAVAILABLE: ReadinessResponse = { status: "unavailable" };

export interface ReadinessHttpOptions {
  readonly check: () => Promise<void>;
}

export const healthPlugin: FastifyPluginCallbackZod = (app, _options, done) => {
  app.get(
    "/health",
    {
      schema: {
        response: {
          200: HealthResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const response: HealthResponse = { status: "ok" };
      return reply.header("cache-control", "no-store").send(response);
    },
  );

  done();
};

/** Database-backed readiness is separate from process liveness. */
export const readinessPlugin: FastifyPluginAsync<ReadinessHttpOptions> = async (app, options) => {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get(
    "/ready",
    {
      schema: {
        response: {
          200: ReadinessResponseSchema,
          503: ReadinessResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        await options.check();
        return reply.header("cache-control", "no-store").send(READY);
      } catch (error) {
        request.log.warn({ err: error }, "readiness check failed");
        return reply.code(503).header("cache-control", "no-store").send(UNAVAILABLE);
      }
    },
  );
};
