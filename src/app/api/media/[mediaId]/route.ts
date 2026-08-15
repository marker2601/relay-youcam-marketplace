import { S3Client } from "@aws-sdk/client-s3";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import {
  readDemoSession,
  sessionTokenFromCookieHeader,
  type DemoSession,
} from "@/lib/auth/demo-session";
import { getServerEnv } from "@/lib/config/env";
import { createDatabaseConnection, type DatabaseConnection } from "@/lib/db/client";
import { mediaObjects } from "@/lib/db/schema";
import { S3ObjectStore } from "@/lib/storage/s3-object-store";

export const runtime = "nodejs";

interface MediaRuntime {
  connection: DatabaseConnection;
  store: S3ObjectStore;
  sessionSecret: string;
}

let mediaRuntime: MediaRuntime | undefined;

function getMediaRuntime(): MediaRuntime {
  if (mediaRuntime) {
    return mediaRuntime;
  }

  const env = getServerEnv();
  const client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
  mediaRuntime = {
    connection: createDatabaseConnection(env.DATABASE_URL),
    store: new S3ObjectStore({ client, bucket: env.S3_BUCKET }),
    sessionSecret: env.SESSION_SECRET,
  };
  return mediaRuntime;
}

type MediaRecord = typeof mediaObjects.$inferSelect;

export function canReadMedia(actor: DemoSession, media: MediaRecord): boolean {
  if (actor.role === "provider") {
    return actor.userId === media.ownerUserId && media.kind === "listing_garment";
  }

  return actor.userId === media.ownerUserId || media.kind === "listing_garment";
}

async function findReadableMedia(
  db: DatabaseConnection["db"],
  actor: DemoSession,
  mediaId: string,
): Promise<MediaRecord | null> {
  const [media] = await db
    .select()
    .from(mediaObjects)
    .where(
      and(
        eq(mediaObjects.id, mediaId),
        eq(mediaObjects.deletionStatus, "active"),
        isNull(mediaObjects.deletedAt),
      ),
    )
    .limit(1);

  return media && canReadMedia(actor, media) ? media : null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ mediaId: string }> },
): Promise<Response> {
  const runtimeState = getMediaRuntime();
  const actor = readDemoSession(
    sessionTokenFromCookieHeader(request.headers.get("cookie")),
    runtimeState.sessionSecret,
  );
  if (!actor) {
    return Response.json({ code: "unauthenticated" }, { status: 401 });
  }

  const parsedId = z.uuid().safeParse((await context.params).mediaId);
  if (!parsedId.success) {
    return Response.json({ code: "not_found" }, { status: 404 });
  }

  const media = await findReadableMedia(runtimeState.connection.db, actor, parsedId.data);
  if (!media) {
    return Response.json({ code: "not_found" }, { status: 404 });
  }

  const signedUrl = await runtimeState.store.createReadUrl(media.objectKey, 300);
  return Response.redirect(signedUrl, 302);
}
