import type { PgDatabase } from "drizzle-orm/pg-core";
import {
  drizzle,
  type PostgresJsDatabase,
  type PostgresJsQueryResultHKT,
} from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { DatabaseConfig } from "../config/database.js";
import * as schema from "./schema.js";

export type Database = PostgresJsDatabase<typeof schema>;

/** Pool or transaction executor, allowing helpers to share locks and writes. */
export type DatabaseExecutor = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;

export interface DatabaseClient {
  readonly db: Database;
  checkReady(): Promise<void>;
  close(): Promise<void>;
}

export function createDatabaseClient(config: DatabaseConfig): DatabaseClient {
  const queryClient = postgres(config.databaseUrl);

  return {
    db: drizzle(queryClient, { schema }),
    checkReady: async () => {
      await queryClient`select 1`;
    },
    close: async () => {
      await queryClient.end();
    },
  };
}
