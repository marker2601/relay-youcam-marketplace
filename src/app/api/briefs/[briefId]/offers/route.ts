import { S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";

import { getServerEnv } from "@/lib/config/env";
import { createDatabaseConnection, type Database, type DatabaseConnection } from "@/lib/db/client";
import { actorFromRequest } from "@/lib/http/request-auth";
import { NotFoundError } from "@/lib/repositories/briefs";
import { getAuthorizedOfferSnapshot } from "@/lib/repositories/offer-read";
import type { ObjectStore } from "@/lib/storage/object-store";
import { S3ObjectStore } from "@/lib/storage/s3-object-store";

export interface OfferGetHandlerOptions {
  db: Database;
  sessionSecret: string;
  objectStore: ObjectStore;
  now?: () => number;
}

export function createOfferGetHandler(options: OfferGetHandlerOptions) {
  return async (
    request: Request,
    context: { params: Promise<{ briefId: string }> },
  ): Promise<Response> => {
    const actor = actorFromRequest(request, options.sessionSecret, options.now?.() ?? Date.now());
    if (!actor) return Response.json({ code: "unauthenticated" }, { status: 401 });
    const id = z.uuid().safeParse((await context.params).briefId);
    if (!id.success) return Response.json({ code: "not_found" }, { status: 404 });
    try {
      return Response.json(
        await getAuthorizedOfferSnapshot(options.db, actor, id.data, options.objectStore),
      );
    } catch (error) {
      if (error instanceof NotFoundError) {
        return Response.json({ code: "not_found" }, { status: 404 });
      }
      throw error;
    }
  };
}

let connection: DatabaseConnection | undefined;
let objectStore: ObjectStore | undefined;

export async function GET(
  request: Request,
  context: { params: Promise<{ briefId: string }> },
) {
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
  return createOfferGetHandler({
    db: connection.db,
    sessionSecret: env.SESSION_SECRET,
    objectStore,
  })(
    request,
    context,
  );
}
