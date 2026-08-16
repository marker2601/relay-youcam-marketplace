import { randomUUID } from "node:crypto";

import { S3Client } from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";

import { readDemoSession, sessionTokenFromCookieHeader } from "@/lib/auth/demo-session";
import { getServerEnv } from "@/lib/config/env";
import { createDatabaseConnection, type Database, type DatabaseConnection } from "@/lib/db/client";
import {
  eventBriefs,
  idempotencyKeys,
  listings,
  matches,
  mediaObjects,
} from "@/lib/db/schema";
import { createBriefCommandSchema, type CreateBriefCommand } from "@/lib/domain/schemas";
import { ImageValidationError, validateImage } from "@/lib/images/validate-image";
import { PayloadTooLargeHttpError, toHttpErrorResponse } from "@/lib/http/errors";
import { MarketplaceRepository } from "@/lib/repositories/marketplace";
import type { ObjectStore } from "@/lib/storage/object-store";
import { createBriefSourceKey, S3ObjectStore } from "@/lib/storage/s3-object-store";

export const runtime = "nodejs";

interface MatchCreator {
  createMatchesAndJobs: MarketplaceRepository["createMatchesAndJobs"];
}

export interface CreateBriefPostHandlerOptions {
  db: Database;
  objectStore: ObjectStore;
  sessionSecret: string;
  now?: () => Date;
  marketplace?: MatchCreator;
}

const idempotencyScope = "brief_matches";

interface UploadedFile {
  name: string;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function isUploadedFile(value: FormDataEntryValue | null): value is File & UploadedFile {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "type" in value &&
    typeof value.type === "string" &&
    "arrayBuffer" in value &&
    typeof value.arrayBuffer === "function"
  );
}

function responseForExisting(status: string, briefId: string, matchCount: number): Response {
  if (status === "no_matches" || matchCount === 0) {
    return Response.json(
      { briefId, outcome: "no_matches", eliminatedBy: {} },
      { status: 201 },
    );
  }
  return Response.json({ briefId, outcome: "matched", matchCount }, { status: 201 });
}

function distanceBetweenBands(left: string, right: string): number {
  if (left === right) return 2;
  return new Set([left, right]).has("west") && new Set([left, right]).has("north") ? 8 : 5;
}

async function eliminationCounts(db: Database, command: CreateBriefCommand) {
  const candidates = await db.select().from(listings).where(eq(listings.status, "active"));
  const body = command.measurementProfile;
  const eventDate = command.eventDate;
  return {
    budget: candidates.filter((listing) => listing.rentalPriceCents > command.budgetMaxCents).length,
    category: candidates.filter(
      (listing) => listing.garmentCategory !== command.garmentCategory,
    ).length,
    radius: candidates.filter(
      (listing) =>
        distanceBetweenBands(command.locationBand, listing.locationBand) >
        Math.min(command.radiusMiles, listing.serviceRadiusMiles),
    ).length,
    measurements: candidates.filter((listing) => {
      const measurements = listing.measurements;
      const keys =
        command.garmentCategory === "upper_body"
          ? (["bustTenthsCm", "waistTenthsCm"] as const)
          : command.garmentCategory === "lower_body"
            ? (["waistTenthsCm", "hipsTenthsCm"] as const)
            : (["bustTenthsCm", "waistTenthsCm", "hipsTenthsCm"] as const);
      return keys.some((key) => {
        const ease = measurements[key] - body[key];
        return ease < 20 || ease > 120;
      });
    }).length,
    availability: candidates.filter((listing) =>
      listing.unavailableRanges.some(
        (range) => range.startDate <= eventDate && eventDate <= range.endDate,
      ),
    ).length,
  };
}

export function createBriefPostHandler(options: CreateBriefPostHandlerOptions) {
  const marketplace = options.marketplace ?? new MarketplaceRepository(options.db);
  return async (request: Request): Promise<Response> => {
    const actor = readDemoSession(
      sessionTokenFromCookieHeader(request.headers.get("cookie")),
      options.sessionSecret,
      options.now?.().getTime() ?? Date.now(),
    );
    if (!actor) {
      return Response.json({ code: "unauthenticated" }, { status: 401 });
    }
    if (actor.role !== "shopper") {
      return Response.json({ code: "not_found" }, { status: 404 });
    }

    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      return Response.json({ code: "invalid_idempotency_key" }, { status: 400 });
    }
    const [existing] = await options.db
      .select({ briefId: idempotencyKeys.responseResourceId })
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.actorId, actor.userId),
          eq(idempotencyKeys.scope, idempotencyScope),
          eq(idempotencyKeys.key, idempotencyKey),
        ),
      )
      .limit(1);
    if (existing?.briefId) {
      const [brief] = await options.db
        .select({ status: eventBriefs.status })
        .from(eventBriefs)
        .where(
          and(eq(eventBriefs.id, existing.briefId), eq(eventBriefs.shopperId, actor.userId)),
        )
        .limit(1);
      if (brief) {
        const persistedMatches = await options.db
          .select({ id: matches.id })
          .from(matches)
          .where(eq(matches.briefId, existing.briefId));
        return responseForExisting(brief.status, existing.briefId, persistedMatches.length);
      }
    }

    if (!request.headers.get("content-type")?.toLowerCase().includes("multipart/form-data")) {
      return Response.json({ code: "invalid_multipart" }, { status: 400 });
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return Response.json({ code: "invalid_multipart" }, { status: 400 });
    }
    const commandValue = form.get("command");
    const photo = form.get("photo");
    if (typeof commandValue !== "string" || !isUploadedFile(photo)) {
      return Response.json({ code: "invalid_multipart" }, { status: 400 });
    }

    let commandJson: unknown;
    try {
      commandJson = JSON.parse(commandValue);
    } catch {
      return Response.json({ code: "invalid_command" }, { status: 400 });
    }
    const command = createBriefCommandSchema.safeParse(commandJson);
    if (!command.success) {
      return Response.json({ code: "invalid_command", issues: command.error.issues }, { status: 400 });
    }

    const bytes = new Uint8Array(await photo.arrayBuffer());
    let validated: Awaited<ReturnType<typeof validateImage>>;
    try {
      validated = await validateImage(bytes, photo.type);
    } catch (error) {
      if (error instanceof ImageValidationError) {
        if (error.code === "too_large") {
          return toHttpErrorResponse(new PayloadTooLargeHttpError());
        }
        return Response.json(
          { code: error.code, guidance: error.guidance },
          { status: 400 },
        );
      }
      return Response.json({ code: "invalid_image" }, { status: 400 });
    }

    const currentTime = options.now?.() ?? new Date();
    const briefId = randomUUID();
    const mediaId = randomUUID();
    const extension = validated.contentType === "image/jpeg" ? "jpg" : "png";
    const objectKey = createBriefSourceKey(briefId, extension);
    let stored = false;
    let databaseInserted = false;
    try {
      await options.objectStore.putPrivate({
        key: objectKey,
        bytes,
        contentType: validated.contentType,
      });
      stored = true;
      await options.db.transaction(async (transaction) => {
        await transaction.insert(mediaObjects).values({
          id: mediaId,
          ownerUserId: actor.userId,
          kind: "brief_source",
          objectKey,
          contentType: validated.contentType,
          byteSize: validated.byteSize,
          briefId,
          createdAt: currentTime,
        });
        await transaction.insert(eventBriefs).values({
          id: briefId,
          shopperId: actor.userId,
          eventType: command.data.eventType,
          eventDate: command.data.eventDate,
          eventStartsAt: new Date(command.data.eventStartsAt),
          dressCode: command.data.dressCode,
          budgetMinCents: command.data.budgetMinCents,
          budgetMaxCents: command.data.budgetMaxCents,
          garmentCategory: command.data.garmentCategory,
          sizeLabel: command.data.sizeLabel,
          measurementProfile: command.data.measurementProfile,
          locationBand: command.data.locationBand,
          radiusMiles: command.data.radiusMiles,
          preferredColors: command.data.preferredColors,
          styleTags: command.data.styleTags,
          exclusions: command.data.exclusions,
          shopperMediaId: mediaId,
          photoConsentAt: currentTime,
          status: "matching",
          createdAt: currentTime,
          updatedAt: currentTime,
        });
      });
      databaseInserted = true;

      const graph = await marketplace.createMatchesAndJobs({
        briefId,
        actorId: actor.userId,
        idempotencyKey,
        now: currentTime,
      });
      if (graph.matchIds.length > 0) {
        return Response.json(
          { briefId, outcome: "matched", matchCount: graph.matchIds.length },
          { status: 201 },
        );
      }
      return Response.json(
        { briefId, outcome: "no_matches", eliminatedBy: await eliminationCounts(options.db, command.data) },
        { status: 201 },
      );
    } catch {
      if (databaseInserted) {
        await options.db.transaction(async (transaction) => {
          await transaction.delete(eventBriefs).where(eq(eventBriefs.id, briefId));
          await transaction.delete(mediaObjects).where(eq(mediaObjects.id, mediaId));
        });
      }
      if (stored) {
        await options.objectStore.delete(objectKey);
      }
      return Response.json({ code: "brief_creation_failed" }, { status: 500 });
    }
  };
}

let connection: DatabaseConnection | undefined;
let store: S3ObjectStore | undefined;

export async function POST(request: Request): Promise<Response> {
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
  return createBriefPostHandler({
    db: connection.db,
    objectStore: store,
    sessionSecret: env.SESSION_SECRET,
  })(request);
}
