import { z } from "zod";

import { getServerEnv } from "@/lib/config/env";
import { createDatabaseConnection, type DatabaseConnection } from "@/lib/db/client";
import { actorFromRequest } from "@/lib/http/request-auth";
import { reservationDetailSchema } from "@/lib/domain/schemas";
import { NotFoundError } from "@/lib/repositories/briefs";
import { ReservationConflictError, ReservationRepository } from "@/lib/repositories/reservations";

let connection: DatabaseConnection | undefined;

export async function POST(
  request: Request,
  context: { params: Promise<{ offerId: string }> },
) {
  const env = getServerEnv();
  const now = new Date();
  const actor = actorFromRequest(request, env.SESSION_SECRET, now.getTime());
  if (!actor) return Response.json({ code: "unauthenticated" }, { status: 401 });
  const id = z.uuid().safeParse((await context.params).offerId);
  if (!id.success || actor.role !== "shopper") return Response.json({ code: "not_found" }, { status: 404 });
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key || key.length < 8 || key.length > 128) {
    return Response.json({ code: "invalid_idempotency_key" }, { status: 400 });
  }
  connection ??= createDatabaseConnection(env.DATABASE_URL);
  try {
    const detail = await new ReservationRepository(connection.db).request(actor, id.data, key, now);
    return Response.json(reservationDetailSchema.parse(detail));
  } catch (error) {
    if (error instanceof NotFoundError) return Response.json({ code: "not_found" }, { status: 404 });
    if (error instanceof ReservationConflictError) return Response.json({ code: "reservation_conflict" }, { status: 409 });
    throw error;
  }
}
