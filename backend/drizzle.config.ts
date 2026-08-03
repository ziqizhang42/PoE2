import process from "node:process";

import { defineConfig } from "drizzle-kit";

const databaseUrl = requireDatabaseUrl();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
});

function requireDatabaseUrl(): string {
  const databaseUrl = process.env["DATABASE_URL"]?.trim();

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for database commands");
  }

  return databaseUrl;
}
