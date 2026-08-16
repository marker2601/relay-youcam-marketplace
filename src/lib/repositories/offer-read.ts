import { and, asc, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Actor } from "@/lib/auth/demo-session";
import type { Database } from "@/lib/db/client";
import {
  eventBriefs,
  listings,
  matches,
  mediaObjects,
  offers,
  tryOnJobs,
  users,
} from "@/lib/db/schema";
import { NotFoundError } from "@/lib/repositories/briefs";
import type { ObjectStore } from "@/lib/storage/object-store";
import {
  calculateReadiness,
  classifyEventUrgency,
  type AssuranceCoverage,
} from "@/lib/domain/assurance";

const garmentMedia = alias(mediaObjects, "offer_garment_media");
const resultMedia = alias(mediaObjects, "offer_result_media");
const offerUrlTtlSeconds = 5 * 60;

export async function getAuthorizedOfferSnapshot(
  db: Database,
  actor: Actor,
  briefId: string,
  objectStore: ObjectStore,
  now = new Date(),
) {
  if (actor.role !== "shopper") throw new NotFoundError();
  const [brief] = await db
    .select({
      revision: eventBriefs.matchingRevision,
      status: eventBriefs.status,
      eventStartsAt: eventBriefs.eventStartsAt,
    })
    .from(eventBriefs)
    .where(and(eq(eventBriefs.id, briefId), eq(eventBriefs.shopperId, actor.userId)))
    .limit(1);
  if (!brief) throw new NotFoundError();

  const rows = await db
    .select({
      id: offers.id,
      listingId: listings.id,
      status: offers.status,
      assuranceRole: offers.assuranceRole,
      title: listings.title,
      garmentCategory: listings.garmentCategory,
      sizeLabel: listings.sizeLabel,
      measurements: listings.measurements,
      condition: listings.condition,
      rentalPriceCents: listings.rentalPriceCents,
      depositDisplayCents: listings.depositDisplayCents,
      providerId: users.id,
      providerDisplayName: users.displayName,
      providerType: users.providerType,
      locationBand: listings.locationBand,
      scoreBasisPoints: matches.scoreBasisPoints,
      scoreBreakdown: matches.scoreBreakdown,
      explanations: matches.explanation,
      garmentObjectKey: garmentMedia.objectKey,
      resultObjectKey: resultMedia.objectKey,
      normalizedErrorCode: tryOnJobs.normalizedErrorCode,
      expiresAt: offers.expiresAt,
    })
    .from(matches)
    .innerJoin(offers, eq(offers.matchId, matches.id))
    .innerJoin(listings, eq(listings.id, matches.listingId))
    .innerJoin(users, eq(users.id, listings.providerId))
    .innerJoin(tryOnJobs, eq(tryOnJobs.matchId, matches.id))
    .innerJoin(garmentMedia, eq(garmentMedia.id, listings.garmentMediaId))
    .leftJoin(resultMedia, eq(resultMedia.id, tryOnJobs.resultMediaId))
    .where(
      and(
        eq(matches.briefId, briefId),
        eq(matches.briefRevision, brief.revision),
      ),
    )
    .orderBy(
      sql`case ${offers.assuranceRole} when 'primary' then 0 when 'backup' then 1 else 2 end`,
      desc(matches.scoreBasisPoints),
      asc(matches.listingId),
    )
    .limit(3);

  const activeRoles = new Set(
    rows.filter((row) => row.status !== "failed").map((row) => row.assuranceRole),
  );
  const assuranceCoverage: AssuranceCoverage =
    activeRoles.has("primary") && activeRoles.has("backup")
      ? "primary_and_backup"
      : "primary_only";
  const urgency = classifyEventUrgency(brief.eventStartsAt, now);

  const signedOffers = await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      listingId: row.listingId,
      status: row.status,
      assuranceRole: row.assuranceRole,
      title: row.title,
      garmentCategory: row.garmentCategory,
      sizeLabel: row.sizeLabel,
      measurements: row.measurements,
      condition: row.condition,
      rentalPriceCents: row.rentalPriceCents,
      depositDisplayCents: row.depositDisplayCents,
      provider: {
        id: row.providerId,
        displayName: row.providerDisplayName,
        providerType: row.providerType!,
      },
      distanceBand: `${row.locationBand} Chicago`,
      pickupMethod: "Local pickup",
      scoreBasisPoints: row.scoreBasisPoints,
      explanations: row.explanations,
      readiness: calculateReadiness({
        available: row.status !== "expired" && row.status !== "failed",
        measurementBasisPoints: row.scoreBreakdown.measurement ?? 0,
        distanceBasisPoints: row.scoreBreakdown.distance ?? 0,
        styleBasisPoints:
          (row.scoreBreakdown.eventDress ?? 0) + (row.scoreBreakdown.styleColor ?? 0),
        providerConfirmed: row.status === "accepted",
      }),
      originalImageUrl: await objectStore.createReadUrl(
        row.garmentObjectKey,
        offerUrlTtlSeconds,
      ),
      resultImageUrl:
        row.status === "ready" && row.resultObjectKey
          ? await objectStore.createReadUrl(row.resultObjectKey, offerUrlTtlSeconds)
          : null,
      failureGuidance:
        row.status !== "failed"
          ? null
          : row.normalizedErrorCode === "invalid_reference"
            ? ("listing_image" as const)
            : row.normalizedErrorCode === "invalid_source"
              ? null
              : ("preview" as const),
      expiresAt: row.expiresAt.toISOString(),
    })),
  );

  return {
    briefId,
    matchingRevision: brief.revision,
    briefStatus: brief.status,
    eventStartsAt: brief.eventStartsAt.toISOString(),
    urgency,
    assuranceCoverage,
    sourcePhotoNeedsReplacement: rows.some(
      (row) => row.status === "failed" && row.normalizedErrorCode === "invalid_source",
    ),
    offers: signedOffers,
  };
}

export type OfferSnapshot = Awaited<ReturnType<typeof getAuthorizedOfferSnapshot>>;
export type OfferSnapshotItem = OfferSnapshot["offers"][number];
