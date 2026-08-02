import { HealthResponseSchema } from "@poe2/protocol";
import { describe, expect, it } from "vitest";

import { buildApp } from "./app.js";

describe("buildApp", () => {
  it("responds to GET /health with a valid health response", async () => {
    const app = buildApp();

    try {
      const response = await app.inject({ method: "GET", url: "/health" });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toMatch(/application\/json/);
      expect(HealthResponseSchema.safeParse(response.json()).success).toBe(true);
    } finally {
      await app.close();
    }
  });
});
