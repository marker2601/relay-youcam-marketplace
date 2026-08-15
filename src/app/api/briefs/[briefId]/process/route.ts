import { S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";

import { getServerEnv } from "@/lib/config/env";
import { createDatabaseConnection, type Database, type DatabaseConnection } from "@/lib/db/client";
import { actorFromRequest } from "@/lib/http/request-auth";
import { BriefRepository, NotFoundError } from "@/lib/repositories/briefs";
import { MarketplaceRepository } from "@/lib/repositories/marketplace";
import { getAuthorizedOfferSnapshot } from "@/lib/repositories/offer-read";
import { S3ObjectStore } from "@/lib/storage/s3-object-store";
import { FetchResultDownloader, TryOnOrchestrator } from "@/lib/try-on/orchestrator";
import type { ClothesV3Client } from "@/lib/youcam/client";
import { YouCamClothesV3Client } from "@/lib/youcam/client";
import { FakeClothesV3Client } from "@/lib/youcam/fake-client";

interface BriefAdvancer {
  advanceBrief(briefId: string, now: Date): Promise<void>;
}

export interface ProcessHandlerOptions {
  db: Database;
  sessionSecret: string;
  orchestrator: BriefAdvancer;
  now?: () => Date;
  lastAdvancedAt?: Map<string, number>;
}

export function createBriefProcessHandler(options: ProcessHandlerOptions) {
  const limiter = options.lastAdvancedAt ?? new Map<string, number>();
  const briefs = new BriefRepository(options.db);
  return async (
    request: Request,
    context: { params: Promise<{ briefId: string }> },
  ): Promise<Response> => {
    const currentTime = options.now?.() ?? new Date();
    const actor = actorFromRequest(request, options.sessionSecret, currentTime.getTime());
    if (!actor) return Response.json({ code: "unauthenticated" }, { status: 401 });
    const id = z.uuid().safeParse((await context.params).briefId);
    if (!id.success) return Response.json({ code: "not_found" }, { status: 404 });
    try {
      await briefs.getById(actor, id.data);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return Response.json({ code: "not_found" }, { status: 404 });
      }
      throw error;
    }

    const prior = limiter.get(id.data);
    if (prior !== undefined && currentTime.getTime() - prior < 2_000) {
      return Response.json({ code: "rate_limited" }, { status: 429 });
    }
    limiter.set(id.data, currentTime.getTime());
    await options.orchestrator.advanceBrief(id.data, currentTime);
    return Response.json(
      await getAuthorizedOfferSnapshot(
        options.db,
        actor,
        id.data,
        new URL(request.url).origin,
      ),
    );
  };
}

let connection: DatabaseConnection | undefined;
let handler: ReturnType<typeof createBriefProcessHandler> | undefined;

export async function POST(
  request: Request,
  context: { params: Promise<{ briefId: string }> },
) {
  if (!handler) {
    const env = getServerEnv();
    connection = createDatabaseConnection(env.DATABASE_URL);
    const s3Client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    });
    const objectStore = new S3ObjectStore({ client: s3Client, bucket: env.S3_BUCKET });
    const client: ClothesV3Client =
      env.YOUCAM_MODE === "live"
        ? new YouCamClothesV3Client({ apiKey: env.YOUCAM_API_KEY, baseUrl: env.YOUCAM_BASE_URL })
        : new FakeClothesV3Client();
    const orchestrator = new TryOnOrchestrator({
      repository: new MarketplaceRepository(connection.db),
      client,
      objectStore,
      resultDownloader: new FetchResultDownloader(),
    });
    handler = createBriefProcessHandler({
      db: connection.db,
      sessionSecret: env.SESSION_SECRET,
      orchestrator,
    });
  }
  return handler(request, context);
}
