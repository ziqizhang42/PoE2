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

/**
 * Whatever a query can run against: the pool itself or an open transaction.
 * Query helpers take this so the same code serves both, which is what lets a
 * read and its write share one transaction and one row lock.
 */
export type DatabaseExecutor = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;

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
