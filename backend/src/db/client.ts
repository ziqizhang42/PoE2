import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { DatabaseConfig } from "../config/database.js";
import * as schema from "./schema.js";

export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseClient {
  readonly db: Database;
  close(): Promise<void>;
}

export function createDatabaseClient(config: DatabaseConfig): DatabaseClient {
  const queryClient = postgres(config.databaseUrl);

  return {
    db: drizzle(queryClient, { schema }),
    close: async () => {
      await queryClient.end();
    },
  };
}
