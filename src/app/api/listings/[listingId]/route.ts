import { randomUUID } from "node:crypto";

import { S3Client } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getServerEnv } from "@/lib/config/env";
import { createDatabaseConnection, type Database, type DatabaseConnection } from "@/lib/db/client";
import { mediaObjects } from "@/lib/db/schema";
import { createListingCommandSchema } from "@/lib/domain/schemas";
import { actorFromRequest } from "@/lib/http/request-auth";
import { ImageValidationError, validateImage } from "@/lib/images/validate-image";
import { NotFoundError } from "@/lib/repositories/briefs";
import { ListingEditConflictError, ListingRepository } from "@/lib/repositories/listings";
import type { ObjectStore } from "@/lib/storage/object-store";
import { createListingGarmentKey, S3ObjectStore } from "@/lib/storage/s3-object-store";

const patchSchema = createListingCommandSchema
  .partial()
  .extend({ expectedVersion: z.number().int().positive() })
  .refine((value) => Object.keys(value).some((key) => key !== "expectedVersion"));
const imageCommandSchema = z.strictObject({ expectedVersion: z.number().int().positive() });

interface ListingResourceOptions {
  db: Database;
  objectStore: ObjectStore;
  sessionSecret: string;
  now?: () => Date;
}

export function createListingResourceHandlers(options: ListingResourceOptions) {
  const repository = new ListingRepository(options.db);
  async function actorAndId(request: Request, context: { params: Promise<{ listingId: string }> }) {
    const currentTime = options.now?.() ?? new Date();
    const actor = actorFromRequest(request, options.sessionSecret, currentTime.getTime());
    const id = z.uuid().safeParse((await context.params).listingId);
    return { actor, id, currentTime };
  }
  function mappedError(error: unknown): Response | null {
    if (error instanceof NotFoundError) return Response.json({ code: "not_found" }, { status: 404 });
    if (error instanceof ListingEditConflictError) return Response.json({ code: "listing_locked" }, { status: 409 });
    return null;
  }

  return {
    async patch(request: Request, context: { params: Promise<{ listingId: string }> }) {
      const { actor, id, currentTime } = await actorAndId(request, context);
      if (!actor) return Response.json({ code: "unauthenticated" }, { status: 401 });
      if (actor.role !== "provider" || !id.success) return Response.json({ code: "not_found" }, { status: 404 });
      let json: unknown;
      try { json = await request.json(); } catch { return Response.json({ code: "invalid_command" }, { status: 400 }); }
      const command = patchSchema.safeParse(json);
      if (!command.success) return Response.json({ code: "invalid_command" }, { status: 400 });
      const { expectedVersion } = command.data;
      const metadata = Object.fromEntries(
        Object.entries(command.data).filter(([key, value]) => key !== "expectedVersion" && value !== undefined),
      ) as Parameters<ListingRepository["updateMetadata"]>[2];
      try {
        const listing = await repository.updateMetadata(actor, id.data, metadata, expectedVersion, currentTime);
        return Response.json({ listingId: listing.id, version: listing.version });
      } catch (error) {
        return mappedError(error) ?? Response.json({ code: "listing_update_failed" }, { status: 500 });
      }
    },

    async put(request: Request, context: { params: Promise<{ listingId: string }> }) {
      const { actor, id, currentTime } = await actorAndId(request, context);
      if (!actor) return Response.json({ code: "unauthenticated" }, { status: 401 });
      if (actor.role !== "provider" || !id.success) return Response.json({ code: "not_found" }, { status: 404 });
      let form: FormData;
      try { form = await request.formData(); } catch { return Response.json({ code: "invalid_multipart" }, { status: 400 }); }
      const rawCommand = form.get("command");
      const photo = form.get("photo");
      if (typeof rawCommand !== "string" || !(photo instanceof File)) {
        return Response.json({ code: "invalid_multipart" }, { status: 400 });
      }
      let json: unknown;
      try { json = JSON.parse(rawCommand); } catch { return Response.json({ code: "invalid_command" }, { status: 400 }); }
      const command = imageCommandSchema.safeParse(json);
      if (!command.success) return Response.json({ code: "invalid_command" }, { status: 400 });
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
      const mediaId = randomUUID();
      const objectKey = createListingGarmentKey(id.data, validated.contentType === "image/jpeg" ? "jpg" : "png");
      try {
        await options.objectStore.putPrivate({ key: objectKey, bytes, contentType: validated.contentType });
        const result = await repository.replaceImage(
          actor,
          id.data,
          { id: mediaId, objectKey, contentType: validated.contentType, byteSize: validated.byteSize },
          command.data.expectedVersion,
          currentTime,
        );
        try {
          await options.objectStore.delete(result.oldMedia.objectKey);
          await options.db.update(mediaObjects).set({ deletionStatus: "deleted", deletedAt: currentTime }).where(eq(mediaObjects.id, result.oldMedia.id));
        } catch {
          await options.db.update(mediaObjects).set({ deletionStatus: "delete_failed", deletionErrorCode: "object_delete_failed" }).where(eq(mediaObjects.id, result.oldMedia.id));
        }
        return Response.json({ listingId: result.listing.id, version: result.listing.version });
      } catch (error) {
        await options.objectStore.delete(objectKey);
        return mappedError(error) ?? Response.json({ code: "listing_image_update_failed" }, { status: 500 });
      }
    },
  };
}

let connection: DatabaseConnection | undefined;
let store: S3ObjectStore | undefined;

function runtimeHandlers() {
  const env = getServerEnv();
  connection ??= createDatabaseConnection(env.DATABASE_URL);
  store ??= new S3ObjectStore({
    client: new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    }),
    bucket: env.S3_BUCKET,
  });
  return createListingResourceHandlers({ db: connection.db, objectStore: store, sessionSecret: env.SESSION_SECRET });
}

export async function PATCH(request: Request, context: { params: Promise<{ listingId: string }> }) {
  return runtimeHandlers().patch(request, context);
}

export async function PUT(request: Request, context: { params: Promise<{ listingId: string }> }) {
  return runtimeHandlers().put(request, context);
}
