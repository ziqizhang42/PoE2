import { z } from "zod";

const authEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
});

export interface AuthConfig {
  readonly sessionCookieName: string;
  readonly secureCookies: boolean;
}

export function readAuthConfig(
  environment: Readonly<Record<string, string | undefined>>,
): AuthConfig {
  const parsed = authEnvironmentSchema.parse(environment);
  const secureCookies = parsed.NODE_ENV === "production";

  return {
    sessionCookieName: secureCookies ? "__Host-poe2_session" : "poe2_session",
    secureCookies,
  };
}
