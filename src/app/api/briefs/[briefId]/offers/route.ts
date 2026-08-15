import { z } from "zod";

import { getServerEnv } from "@/lib/config/env";
import { createDatabaseConnection, type Database, type DatabaseConnection } from "@/lib/db/client";
import { actorFromRequest } from "@/lib/http/request-auth";
import { NotFoundError } from "@/lib/repositories/briefs";
import { getAuthorizedOfferSnapshot } from "@/lib/repositories/offer-read";

export interface OfferGetHandlerOptions {
  db: Database;
  sessionSecret: string;
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
        await getAuthorizedOfferSnapshot(options.db, actor, id.data, new URL(request.url).origin),
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

export async function GET(
  request: Request,
  context: { params: Promise<{ briefId: string }> },
) {
  const env = getServerEnv();
  connection ??= createDatabaseConnection(env.DATABASE_URL);
  return createOfferGetHandler({ db: connection.db, sessionSecret: env.SESSION_SECRET })(
    request,
    context,
  );
}
