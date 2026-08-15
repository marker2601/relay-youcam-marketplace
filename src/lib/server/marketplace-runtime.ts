import { S3Client } from "@aws-sdk/client-s3";
import { cookies } from "next/headers";

import { demoSessionCookieName, readDemoSession } from "@/lib/auth/demo-session";
import { getServerEnv } from "@/lib/config/env";
import { createDatabaseConnection, type DatabaseConnection } from "@/lib/db/client";
import { S3ObjectStore } from "@/lib/storage/s3-object-store";

let connection: DatabaseConnection | undefined;
let objectStore: S3ObjectStore | undefined;

export function marketplaceRuntime() {
  const env = getServerEnv();
  connection ??= createDatabaseConnection(env.DATABASE_URL);
  objectStore ??= new S3ObjectStore({
    client: new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    }),
    bucket: env.S3_BUCKET,
  });
  return { env, db: connection.db, objectStore };
}

export async function currentPageActor() {
  const { env } = marketplaceRuntime();
  const cookieStore = await cookies();
  const session = readDemoSession(cookieStore.get(demoSessionCookieName)?.value, env.SESSION_SECRET);
  return session ? { userId: session.userId, role: session.role } as const : null;
}
