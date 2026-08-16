import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createDatabaseConnection } from "@/lib/db/client";

const tableNames = [
  "reservations",
  "offers",
  "try_on_jobs",
  "matches",
  "idempotency_keys",
  "event_briefs",
  "listings",
  "media_objects",
  "users",
] as const;

function getTestDatabaseUrl(): string {
  const value =
    process.env.TEST_DATABASE_URL ??
    "postgresql://relay:relay_local@localhost:54329/relay_test";
  const databaseName = new URL(value).pathname.slice(1);
  if (!databaseName.endsWith("_test")) {
    throw new Error("TEST_DATABASE_URL must target a database ending in _test");
  }
  return value;
}

export function createTestDatabaseConnection(options: { max?: number } = {}) {
  return createDatabaseConnection(getTestDatabaseUrl(), options);
}

export const testConnection = createTestDatabaseConnection({ max: 1 });
export const testDb = testConnection.db;

export async function migrateTestDatabase(): Promise<void> {
  await migrate(testDb, { migrationsFolder: "./drizzle" });
}

export async function resetTestDatabase(): Promise<void> {
  await testConnection.sql.unsafe(
    `TRUNCATE TABLE ${tableNames.map((name) => `"${name}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );
}

export async function closeTestDatabase(): Promise<void> {
  await testConnection.sql.end();
}
