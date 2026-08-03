import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { DatabaseConfig } from "../config/database.js";

export interface DatabaseClient {
  readonly db: PostgresJsDatabase;
  close(): Promise<void>;
}

export function createDatabaseClient(config: DatabaseConfig): DatabaseClient {
  const queryClient = postgres(config.databaseUrl);

  return {
    db: drizzle(queryClient),
    close: async () => {
      await queryClient.end();
    },
  };
}
