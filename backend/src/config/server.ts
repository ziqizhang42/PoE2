import { z } from "zod";

/**
 * Supports zero or one positional proxy hop. With one hop, direct callers can
 * forge `request.ip`, so the backend port must remain private or loopback-only.
 * See `docs/dev.md#development-proxy-and-ports`.
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

export interface ServerListenConfig {
  readonly host: string;
  readonly port: number;
}

/** Fastify construction options, kept separate from socket binding settings. */
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
