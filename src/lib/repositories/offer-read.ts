import { and, asc, desc, eq } from "drizzle-orm";
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

const garmentMedia = alias(mediaObjects, "offer_garment_media");
const resultMedia = alias(mediaObjects, "offer_result_media");
const offerUrlTtlSeconds = 5 * 60;

export async function getAuthorizedOfferSnapshot(
  db: Database,
  actor: Actor,
  briefId: string,
  objectStore: ObjectStore,
) {
  if (actor.role !== "shopper") throw new NotFoundError();
  const [brief] = await db
    .select({ revision: eventBriefs.matchingRevision, status: eventBriefs.status })
    .from(eventBriefs)
    .where(and(eq(eventBriefs.id, briefId), eq(eventBriefs.shopperId, actor.userId)))
    .limit(1);
  if (!brief) throw new NotFoundError();

  const rows = await db
    .select({
      id: offers.id,
      listingId: listings.id,
      status: offers.status,
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
      explanations: matches.explanation,
      garmentObjectKey: garmentMedia.objectKey,
      resultObjectKey: resultMedia.objectKey,
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
    .orderBy(desc(matches.scoreBasisPoints), asc(matches.listingId))
    .limit(3);

  const signedOffers = await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      listingId: row.listingId,
      status: row.status,
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
      originalImageUrl: await objectStore.createReadUrl(
        row.garmentObjectKey,
        offerUrlTtlSeconds,
      ),
      resultImageUrl:
        row.status === "ready" && row.resultObjectKey
          ? await objectStore.createReadUrl(row.resultObjectKey, offerUrlTtlSeconds)
          : null,
      expiresAt: row.expiresAt.toISOString(),
    })),
  );

  return {
    briefId,
    matchingRevision: brief.revision,
    briefStatus: brief.status,
    offers: signedOffers,
  };
}

export type OfferSnapshot = Awaited<ReturnType<typeof getAuthorizedOfferSnapshot>>;
export type OfferSnapshotItem = OfferSnapshot["offers"][number];
