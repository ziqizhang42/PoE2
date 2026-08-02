import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { HealthResponseSchema, type HealthResponse } from "@poe2/protocol";

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
    async () => {
      const response: HealthResponse = { status: "ok" };
      return response;
    },
  );

  done();
};
