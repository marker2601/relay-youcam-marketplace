import { readFile } from "node:fs/promises";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createDatabaseConnection } from "@/lib/db/client";
import { matches, offers, tryOnJobs } from "@/lib/db/schema";
import { seedRelay } from "../../../scripts/seed";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://relay:relay_local@localhost:54329/relay";

function objectClient() {
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? "http://localhost:59000",
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "relay_local",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "relay_local_secret",
    },
  });
}

export async function resetApplicationState(): Promise<void> {
  const connection = createDatabaseConnection(databaseUrl, { max: 1 });
  const s3 = objectClient();
  try {
    await migrate(connection.db, { migrationsFolder: "./drizzle" });
    await connection.sql.unsafe(
      'TRUNCATE TABLE "reservations", "offers", "try_on_jobs", "matches", "idempotency_keys", "event_briefs", "listings", "media_objects", "users" RESTART IDENTITY CASCADE',
    );
    await seedRelay(connection.db, {
      uploadAsset: async (asset) => {
        await s3.send(
          new PutObjectCommand({
            Bucket: process.env.S3_BUCKET ?? "relay-media",
            Key: asset.objectKey,
            Body: await readFile(asset.sourcePath),
            ContentType: asset.contentType,
          }),
        );
      },
    });
  } finally {
    s3.destroy();
    await connection.sql.end();
  }
}

export async function failOnePreview(briefId: string): Promise<void> {
  const connection = createDatabaseConnection(databaseUrl, { max: 1 });
  try {
    const [row] = await connection.db
      .select({ jobId: tryOnJobs.id, offerId: offers.id })
      .from(tryOnJobs)
      .innerJoin(matches, eq(matches.id, tryOnJobs.matchId))
      .innerJoin(offers, eq(offers.matchId, matches.id))
      .where(eq(matches.briefId, briefId))
      .limit(1);
    if (!row) throw new Error("No preview exists for the brief");
    await connection.db
      .update(tryOnJobs)
      .set({
        status: "failed",
        resultMediaId: null,
        normalizedErrorCode: "invalid_reference",
        completedAt: new Date(),
      })
      .where(eq(tryOnJobs.id, row.jobId));
    await connection.db
      .update(offers)
      .set({ status: "failed" })
      .where(eq(offers.id, row.offerId));
  } finally {
    await connection.sql.end();
  }
}
