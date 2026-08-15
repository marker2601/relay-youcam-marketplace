import { randomUUID } from "node:crypto";

import { S3Client } from "@aws-sdk/client-s3";

import { getServerEnv } from "@/lib/config/env";
import { createDatabaseConnection, type Database, type DatabaseConnection } from "@/lib/db/client";
import { createListingCommandSchema } from "@/lib/domain/schemas";
import { actorFromRequest } from "@/lib/http/request-auth";
import { ImageValidationError, validateImage } from "@/lib/images/validate-image";
import { ListingRepository } from "@/lib/repositories/listings";
import type { ObjectStore } from "@/lib/storage/object-store";
import { createListingGarmentKey, S3ObjectStore } from "@/lib/storage/s3-object-store";

export const runtime = "nodejs";

export interface ListingPostHandlerOptions {
  db: Database;
  objectStore: ObjectStore;
  sessionSecret: string;
  now?: () => Date;
}

export function createListingPostHandler(options: ListingPostHandlerOptions) {
  return async (request: Request): Promise<Response> => {
    const currentTime = options.now?.() ?? new Date();
    const actor = actorFromRequest(request, options.sessionSecret, currentTime.getTime());
    if (!actor) return Response.json({ code: "unauthenticated" }, { status: 401 });
    if (actor.role !== "provider") return Response.json({ code: "not_found" }, { status: 404 });

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return Response.json({ code: "invalid_multipart" }, { status: 400 });
    }
    const rawCommand = form.get("command");
    const photo = form.get("photo");
    if (
      typeof rawCommand !== "string" ||
      typeof photo !== "object" ||
      photo === null ||
      !("arrayBuffer" in photo) ||
      typeof photo.arrayBuffer !== "function" ||
      !("type" in photo) ||
      typeof photo.type !== "string"
    ) {
      return Response.json({ code: "invalid_multipart" }, { status: 400 });
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawCommand);
    } catch {
      return Response.json({ code: "invalid_command" }, { status: 400 });
    }
    const command = createListingCommandSchema.safeParse(parsedJson);
    if (!command.success) {
      return Response.json({ code: "invalid_command" }, { status: 400 });
    }

    const bytes = new Uint8Array(await photo.arrayBuffer());
    let validated: Awaited<ReturnType<typeof validateImage>>;
    try {
      validated = await validateImage(bytes, photo.type);
    } catch (error) {
      if (error instanceof ImageValidationError) {
        return Response.json({ code: error.code, guidance: error.guidance }, { status: 400 });
      }
      return Response.json({ code: "invalid_image" }, { status: 400 });
    }

    const listingId = randomUUID();
    const mediaId = randomUUID();
    const objectKey = createListingGarmentKey(
      listingId,
      validated.contentType === "image/jpeg" ? "jpg" : "png",
    );
    try {
      await options.objectStore.putPrivate({
        key: objectKey,
        bytes,
        contentType: validated.contentType,
      });
      await new ListingRepository(options.db).createWithMedia(
        actor,
        listingId,
        {
          id: mediaId,
          objectKey,
          contentType: validated.contentType,
          byteSize: validated.byteSize,
        },
        command.data,
        currentTime,
      );
      return Response.json({ listingId, version: 1 }, { status: 201 });
    } catch {
      await options.objectStore.delete(objectKey);
      return Response.json({ code: "listing_creation_failed" }, { status: 500 });
    }
  };
}

let connection: DatabaseConnection | undefined;
let store: S3ObjectStore | undefined;

export async function POST(request: Request) {
  const env = getServerEnv();
  connection ??= createDatabaseConnection(env.DATABASE_URL);
  store ??= new S3ObjectStore({
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
  return createListingPostHandler({
    db: connection.db,
    objectStore: store,
    sessionSecret: env.SESSION_SECRET,
  })(request);
}
