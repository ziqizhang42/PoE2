import { z } from "zod";

/**
 * The only proxy topologies this project supports:
 *
 * - `0`: nothing in front of Fastify, so no forwarding header is trusted and
 *   `request.ip` is always the socket address.
 * - `1`: exactly one trusted hop (the Compose `frontend` Vite container, and
 *   later a single reverse proxy).
 *
 * A larger value is rejected.
 *
 * What one hop buys: Fastify's hop count is positional, not
 * address-based, so hop 0 - whoever opened the socket — is trusted
 * unconditionally. For traffic arriving through the proxy that is exactly
 * right: the proxy appends the real peer to `x-forwarded-for`, Fastify takes
 * that appended address, and anything the client put in the header sits to its
 * left and is discarded.
 *
 * What it does not buy: anything that can open a socket to this process
 * directly is inside the trust boundary and can set `request.ip` freely. That
 * is why the development ports are published on loopback only, and why the
 * default is to trust nothing. Pinning a reverse proxy's address, which needs a
 * `trustProxy` function rather than a hop count, belongs with the production
 * deployment work.
 */
const MAX_TRUST_PROXY_HOPS = 1;

const serverEnvironmentSchema = z.object({
  HOST: z.string().trim().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  // Not `z.coerce.number()`: that turns an empty or whitespace-only value into
  // 0, which would silently look like a deliberate "trust nothing" setting.
  TRUST_PROXY_HOPS: z
    .string()
    .trim()
    .regex(/^\d+$/u, "TRUST_PROXY_HOPS must be a whole number of proxy hops")
    .transform(Number)
    .pipe(z.number().int().min(0).max(MAX_TRUST_PROXY_HOPS))
    .default(0),
});

/** Options for `app.listen()`. */
export interface ServerListenConfig {
  readonly host: string;
  readonly port: number;
}

/**
 * Options for `Fastify()`. These are fixed when the instance is constructed and
 * are deliberately kept apart from {@link ServerListenConfig}, which is only
 * read when the socket is bound.
 */
export interface ServerInstanceConfig {
  /** `false` trusts no proxy; a number trusts that many hops. */
  readonly trustProxy: false | number;
}

export interface ServerConfig {
  readonly listen: ServerListenConfig;
  readonly instance: ServerInstanceConfig;
}

export function readServerConfig(
  environment: Readonly<Record<string, string | undefined>>,
): ServerConfig {
  const parsed = serverEnvironmentSchema.parse(environment);

  return {
    listen: {
      host: parsed.HOST,
      port: parsed.PORT,
    },
    instance: {
      trustProxy: parsed.TRUST_PROXY_HOPS === 0 ? false : parsed.TRUST_PROXY_HOPS,
    },
  };
}
