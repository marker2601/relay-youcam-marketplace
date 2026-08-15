import { randomUUID } from "node:crypto";

import { S3Client } from "@aws-sdk/client-s3";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getServerEnv } from "@/lib/config/env";
import { createDatabaseConnection, type Database, type DatabaseConnection } from "@/lib/db/client";
import { eventBriefs, matches, mediaObjects, offers } from "@/lib/db/schema";
import { ImageValidationError, validateImage } from "@/lib/images/validate-image";
import { actorFromRequest } from "@/lib/http/request-auth";
import { BriefRepository, NotFoundError } from "@/lib/repositories/briefs";
import { MarketplaceRepository } from "@/lib/repositories/marketplace";
import type { ObjectStore } from "@/lib/storage/object-store";
import { createBriefSourceKey, S3ObjectStore } from "@/lib/storage/s3-object-store";

export const runtime = "nodejs";

const patchSchema = z
  .strictObject({
    radiusMiles: z.number().int().min(1).max(100).optional(),
    budgetMaxCents: z.number().int().nonnegative().optional(),
    garmentCategory: z.enum(["upper_body", "lower_body", "full_body"]).optional(),
    preferredColors: z
      .array(z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/))
      .max(10)
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

interface ResourceOptions {
  db: Database;
  objectStore: ObjectStore;
  sessionSecret: string;
  marketplace?: MarketplaceRepository;
  now?: () => Date;
}

function idFromContext(context: { params: Promise<{ briefId: string }> }) {
  return context.params.then((params) => z.uuid().safeParse(params.briefId));
}

export function createBriefResourceHandlers(options: ResourceOptions) {
  const briefs = new BriefRepository(options.db);
  const marketplace = options.marketplace ?? new MarketplaceRepository(options.db);

  async function authenticate(request: Request) {
    const actor = actorFromRequest(
      request,
      options.sessionSecret,
      options.now?.().getTime() ?? Date.now(),
    );
    return actor?.role === "shopper" ? actor : null;
  }

  return {
    async get(request: Request, context: { params: Promise<{ briefId: string }> }) {
      const actor = await authenticate(request);
      if (!actor) return Response.json({ code: "unauthenticated" }, { status: 401 });
      const parsedId = await idFromContext(context);
      if (!parsedId.success) return Response.json({ code: "not_found" }, { status: 404 });
      try {
        const brief = await briefs.getById(actor, parsedId.data);
        return Response.json({
          id: brief.id,
          eventType: brief.eventType,
          eventDate: brief.eventDate,
          dressCode: brief.dressCode,
          budgetMinCents: brief.budgetMinCents,
          budgetMaxCents: brief.budgetMaxCents,
          garmentCategory: brief.garmentCategory,
          sizeLabel: brief.sizeLabel,
          measurementProfile: brief.measurementProfile,
          locationBand: brief.locationBand,
          radiusMiles: brief.radiusMiles,
          preferredColors: brief.preferredColors,
          styleTags: brief.styleTags,
          exclusions: brief.exclusions,
          status: brief.status,
          matchingRevision: brief.matchingRevision,
        });
      } catch (error) {
        if (error instanceof NotFoundError) {
          return Response.json({ code: "not_found" }, { status: 404 });
        }
        throw error;
      }
    },

    async patch(request: Request, context: { params: Promise<{ briefId: string }> }) {
      const actor = await authenticate(request);
      if (!actor) return Response.json({ code: "unauthenticated" }, { status: 401 });
      const parsedId = await idFromContext(context);
      if (!parsedId.success) return Response.json({ code: "not_found" }, { status: 404 });
      let json: unknown;
      try {
        json = await request.json();
      } catch {
        return Response.json({ code: "invalid_command" }, { status: 400 });
      }
      const command = patchSchema.safeParse(json);
      if (!command.success) return Response.json({ code: "invalid_command" }, { status: 400 });
      const idempotencyKey = request.headers.get("idempotency-key")?.trim();
      if (!idempotencyKey || idempotencyKey.length < 8) {
        return Response.json({ code: "invalid_idempotency_key" }, { status: 400 });
      }
      try {
        const brief = await briefs.getById(actor, parsedId.data);
        if (
          command.data.budgetMaxCents !== undefined &&
          command.data.budgetMaxCents < brief.budgetMinCents
        ) {
          return Response.json({ code: "invalid_command" }, { status: 400 });
        }
        const nextRevision = brief.matchingRevision + 1;
        const currentTime = options.now?.() ?? new Date();
        await options.db.transaction(async (transaction) => {
          const priorMatches = await transaction
            .select({ id: matches.id })
            .from(matches)
            .where(
              and(
                eq(matches.briefId, brief.id),
                eq(matches.briefRevision, brief.matchingRevision),
              ),
            );
          if (priorMatches.length > 0) {
            await transaction
              .update(offers)
              .set({ status: "expired" })
              .where(
                and(
                  inArray(
                    offers.matchId,
                    priorMatches.map((match) => match.id),
                  ),
                  inArray(offers.status, ["matched", "generating", "ready"]),
                ),
              );
          }
          const updated = await transaction
            .update(eventBriefs)
            .set({
              ...command.data,
              matchingRevision: nextRevision,
              status: "matching",
              updatedAt: currentTime,
            })
            .where(
              and(
                eq(eventBriefs.id, brief.id),
                eq(eventBriefs.shopperId, actor.userId),
                eq(eventBriefs.matchingRevision, brief.matchingRevision),
              ),
            )
            .returning({ id: eventBriefs.id });
          if (updated.length !== 1) throw new Error("Concurrent brief update");
        });
        const graph = await marketplace.createMatchesAndJobs({
          briefId: brief.id,
          actorId: actor.userId,
          idempotencyKey,
          now: currentTime,
        });
        return Response.json({
          briefId: brief.id,
          matchingRevision: nextRevision,
          matchCount: graph.matchIds.length,
        });
      } catch (error) {
        if (error instanceof NotFoundError) {
          return Response.json({ code: "not_found" }, { status: 404 });
        }
        return Response.json({ code: "brief_update_failed" }, { status: 500 });
      }
    },

    async put(request: Request, context: { params: Promise<{ briefId: string }> }) {
      const actor = await authenticate(request);
      if (!actor) return Response.json({ code: "unauthenticated" }, { status: 401 });
      const parsedId = await idFromContext(context);
      if (!parsedId.success) return Response.json({ code: "not_found" }, { status: 404 });
      const idempotencyKey = request.headers.get("idempotency-key")?.trim();
      if (!idempotencyKey || idempotencyKey.length < 8) {
        return Response.json({ code: "invalid_idempotency_key" }, { status: 400 });
      }
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return Response.json({ code: "invalid_multipart" }, { status: 400 });
      }
      const photo = form.get("photo");
      if (
        form.get("photoConsent") !== "true" ||
        typeof photo !== "object" ||
        photo === null ||
        !("arrayBuffer" in photo) ||
        typeof photo.arrayBuffer !== "function" ||
        !("type" in photo) ||
        typeof photo.type !== "string"
      ) {
        return Response.json({ code: "invalid_multipart" }, { status: 400 });
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

      let newObjectKey: string | undefined;
      try {
        const brief = await briefs.getById(actor, parsedId.data);
        const [oldMedia] = await options.db
          .select()
          .from(mediaObjects)
          .where(and(eq(mediaObjects.id, brief.shopperMediaId), eq(mediaObjects.ownerUserId, actor.userId)))
          .limit(1);
        if (!oldMedia) throw new NotFoundError();
        const currentTime = options.now?.() ?? new Date();
        const newMediaId = randomUUID();
        newObjectKey = createBriefSourceKey(
          brief.id,
          validated.contentType === "image/jpeg" ? "jpg" : "png",
        );
        await options.objectStore.putPrivate({
          key: newObjectKey,
          bytes,
          contentType: validated.contentType,
        });
        const nextRevision = brief.matchingRevision + 1;
        await options.db.transaction(async (transaction) => {
          await transaction.insert(mediaObjects).values({
            id: newMediaId,
            ownerUserId: actor.userId,
            kind: "brief_source",
            objectKey: newObjectKey!,
            contentType: validated.contentType,
            byteSize: validated.byteSize,
            briefId: brief.id,
            createdAt: currentTime,
          });
          const priorMatches = await transaction
            .select({ id: matches.id })
            .from(matches)
            .where(
              and(
                eq(matches.briefId, brief.id),
                eq(matches.briefRevision, brief.matchingRevision),
              ),
            );
          if (priorMatches.length > 0) {
            await transaction
              .update(offers)
              .set({ status: "expired" })
              .where(
                and(
                  inArray(
                    offers.matchId,
                    priorMatches.map((match) => match.id),
                  ),
                  inArray(offers.status, ["matched", "generating", "ready"]),
                ),
              );
          }
          await transaction
            .update(eventBriefs)
            .set({
              shopperMediaId: newMediaId,
              photoConsentAt: currentTime,
              matchingRevision: nextRevision,
              status: "matching",
              updatedAt: currentTime,
            })
            .where(
              and(
                eq(eventBriefs.id, brief.id),
                eq(eventBriefs.shopperId, actor.userId),
                eq(eventBriefs.matchingRevision, brief.matchingRevision),
              ),
            );
        });
        const graph = await marketplace.createMatchesAndJobs({
          briefId: brief.id,
          actorId: actor.userId,
          idempotencyKey,
          now: currentTime,
        });
        try {
          await options.objectStore.delete(oldMedia.objectKey);
          await options.db
            .update(mediaObjects)
            .set({ deletionStatus: "deleted", deletedAt: currentTime })
            .where(eq(mediaObjects.id, oldMedia.id));
        } catch {
          await options.db
            .update(mediaObjects)
            .set({ deletionStatus: "delete_failed", deletionErrorCode: "object_delete_failed" })
            .where(eq(mediaObjects.id, oldMedia.id));
        }
        return Response.json({
          briefId: brief.id,
          matchingRevision: nextRevision,
          matchCount: graph.matchIds.length,
        });
      } catch (error) {
        if (newObjectKey) await options.objectStore.delete(newObjectKey);
        if (error instanceof NotFoundError) {
          return Response.json({ code: "not_found" }, { status: 404 });
        }
        return Response.json({ code: "photo_replacement_failed" }, { status: 500 });
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
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    }),
    bucket: env.S3_BUCKET,
  });
  return createBriefResourceHandlers({
    db: connection.db,
    objectStore: store,
    sessionSecret: env.SESSION_SECRET,
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ briefId: string }> },
) {
  return runtimeHandlers().get(request, context);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ briefId: string }> },
) {
  return runtimeHandlers().patch(request, context);
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ briefId: string }> },
) {
  return runtimeHandlers().put(request, context);
}
