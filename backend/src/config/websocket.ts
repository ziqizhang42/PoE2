import { z } from "zod";

/**
 * A WebSocket upgrade is not subject to the same-origin policy and carries the
 * session cookie automatically, so the `Origin` header is the only thing
 * standing between an authenticated browser and any page that decides to open a
 * socket to this backend. It is therefore checked against an explicit list.
 *
 * There is no wildcard. Production must name its origins; development falls
 * back to the Vite dev server only because a wrong guess there is not a
 * credential boundary anyone relies on.
 */
const DEVELOPMENT_ORIGINS: readonly string[] = ["http://localhost:5173"];

const websocketEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  WEBSOCKET_ALLOWED_ORIGINS: z.string().default(""),
});

export interface WebSocketConfig {
  /** Normalized `scheme://host[:port]` origins allowed to open a socket. */
  readonly allowedOrigins: readonly string[];
}

export function readWebSocketConfig(
  environment: Readonly<Record<string, string | undefined>>,
): WebSocketConfig {
  const parsed = websocketEnvironmentSchema.parse(environment);
  const configured = parsed.WEBSOCKET_ALLOWED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (configured.includes("*")) {
    throw new Error("WEBSOCKET_ALLOWED_ORIGINS must list explicit origins; '*' is not accepted");
  }

  if (configured.length === 0) {
    if (parsed.NODE_ENV === "production") {
      throw new Error("WEBSOCKET_ALLOWED_ORIGINS is required when NODE_ENV is production");
    }

    return { allowedOrigins: DEVELOPMENT_ORIGINS };
  }

  return { allowedOrigins: configured.map(normalizeOrigin) };
}

/**
 * `null` is rejected along with everything unlisted. A browser always sends an
 * origin on an upgrade, so a missing one means the caller is not the browser
 * this endpoint is for.
 */
export function isAllowedOrigin(config: WebSocketConfig, origin: string | undefined): boolean {
  if (origin === undefined) {
    return false;
  }

  let normalized: string;
  try {
    normalized = normalizeOrigin(origin);
  } catch {
    return false;
  }

  return config.allowedOrigins.includes(normalized);
}

function normalizeOrigin(value: string): string {
  const origin = new URL(value).origin;

  // `new URL('data:...')` and friends parse but have no meaningful origin.
  if (origin === "null") {
    throw new Error(`${value} is not an origin a browser can send`);
  }

  return origin;
}
