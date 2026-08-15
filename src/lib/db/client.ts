import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/lib/db/schema";

export interface DatabaseConnectionOptions {
  max?: number;
}

export function createDatabaseConnection(
  connectionString: string,
  options: DatabaseConnectionOptions = {},
) {
  const sql = postgres(connectionString, {
    max: options.max ?? 10,
    prepare: false,
  });
  const db = drizzle(sql, { schema });

  return { db, sql };
}

export type DatabaseConnection = ReturnType<typeof createDatabaseConnection>;
export type Database = DatabaseConnection["db"];
