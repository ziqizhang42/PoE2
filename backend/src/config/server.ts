import { z } from "zod";

const serverEnvironmentSchema = z.object({
  HOST: z.string().trim().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
});

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
}

export function readServerConfig(
  environment: Readonly<Record<string, string | undefined>>,
): ServerConfig {
  const parsed = serverEnvironmentSchema.parse(environment);

  return {
    host: parsed.HOST,
    port: parsed.PORT,
  };
}
