import { z } from "zod";

const databaseEnvironmentSchema = z.object({
  DATABASE_URL: z
    .string()
    .trim()
    .min(1)
    .refine(isPostgresUrl, "DATABASE_URL must be a valid PostgreSQL URL"),
});

export interface DatabaseConfig {
  readonly databaseUrl: string;
}

export function readDatabaseConfig(
  environment: Readonly<Record<string, string | undefined>>,
): DatabaseConfig {
  const parsed = databaseEnvironmentSchema.parse(environment);
  return { databaseUrl: parsed.DATABASE_URL };
}

function isPostgresUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "postgres:" || protocol === "postgresql:";
  } catch {
    return false;
  }
}
