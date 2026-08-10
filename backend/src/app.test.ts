import { HealthResponseSchema } from "@poe2/protocol";
import type { FastifyServerOptions } from "fastify";
import { describe, expect, it } from "vitest";

import { buildApp } from "./app.js";

const PROXY_ADDRESS = "172.18.0.4";

/** Reports the client address the app resolved for a request. */
async function resolveClientIp(
  options: FastifyServerOptions,
  forwardedFor: string | undefined,
): Promise<string> {
  const app = buildApp(options);
  app.get("/client-ip", (request) => request.ip);

  try {
    const response = await app.inject({
      method: "GET",
      url: "/client-ip",
      remoteAddress: PROXY_ADDRESS,
      ...(forwardedFor === undefined ? {} : { headers: { "x-forwarded-for": forwardedFor } }),
    });

    return response.body;
  } finally {
    await app.close();
  }
}

describe("buildApp", () => {
  it("responds to GET /health with a valid health response", async () => {
    const app = buildApp();

    try {
      const response = await app.inject({ method: "GET", url: "/health" });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toMatch(/application\/json/);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(HealthResponseSchema.safeParse(response.json()).success).toBe(true);
    } finally {
      await app.close();
    }
  });
});

describe("client address resolution", () => {
  it("uses the socket address when no proxy is trusted", async () => {
    await expect(resolveClientIp({ trustProxy: false }, undefined)).resolves.toBe(PROXY_ADDRESS);
  });

  it("ignores forwarding headers when no proxy is trusted", async () => {
    await expect(resolveClientIp({ trustProxy: false }, "203.0.113.7")).resolves.toBe(
      PROXY_ADDRESS,
    );
  });

  it("uses the address the single trusted hop appended", async () => {
    await expect(resolveClientIp({ trustProxy: 1 }, "203.0.113.7")).resolves.toBe("203.0.113.7");
  });

  it("ignores an address the client injected ahead of the trusted hop", async () => {
    await expect(resolveClientIp({ trustProxy: 1 }, "10.0.0.1, 203.0.113.7")).resolves.toBe(
      "203.0.113.7",
    );
  });

  it("still resolves the socket address when a trusted hop sends no header", async () => {
    await expect(resolveClientIp({ trustProxy: 1 }, undefined)).resolves.toBe(PROXY_ADDRESS);
  });

  it("never walks past one hop, however long the chain claims to be", async () => {
    await expect(
      resolveClientIp({ trustProxy: 1 }, "10.0.0.1, 10.0.0.2, 10.0.0.3, 203.0.113.7"),
    ).resolves.toBe("203.0.113.7");
  });

  it("trusts a forwarded address from anything that opens the socket directly", async () => {
    // Pinning a known limitation rather than a guarantee. The hop count is
    // positional, so hop 0 is trusted whoever it is: a caller that reaches this
    // process without going through the proxy picks its own `request.ip`. The
    // containment for that is the loopback-only published port, not this
    // setting. See the trusted-proxy notes in docs/dev.md.
    await expect(resolveClientIp({ trustProxy: 1 }, "9.9.9.9")).resolves.toBe("9.9.9.9");
  });
});
