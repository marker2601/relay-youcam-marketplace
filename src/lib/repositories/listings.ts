import { and, eq, inArray } from "drizzle-orm";

import type { Actor } from "@/lib/auth/demo-session";
import type { Database } from "@/lib/db/client";
import { eventBriefs, listings, matches, mediaObjects, offers } from "@/lib/db/schema";
import type { GarmentMeasurements } from "@/lib/domain/contracts";
import { transitionOffer } from "@/lib/domain/state-machines";
import { NotFoundError } from "@/lib/repositories/briefs";

export interface CreateListingInput {
  title: string;
  garmentCategory: "upper_body" | "lower_body" | "full_body";
  sizeLabel: string;
  measurements: GarmentMeasurements;
  condition: "excellent" | "good" | "fair";
  colorTags: string[];
  styleTags: string[];
  rentalPriceCents: number;
  depositDisplayCents: number;
  serviceRadiusMiles: number;
  locationBand: "loop" | "west" | "north";
  garmentMediaId: string;
  unavailableRanges: Array<{ startDate: string; endDate: string }>;
}

export interface ProviderRequestRecord {
  id: string;
  reservationId: null;
  status: "reservation_requested" | "accepted" | "declined";
  eventType: "wedding_guest" | "cocktail_party" | "gala" | "holiday_party";
  eventDate: string;
  dressCode: "cocktail" | "formal" | "semi_formal" | "festive";
  sizeLabel: string;
  listingId: string;
  listingTitle: string;
  rentalPriceCents: number;
}

export class ListingRepository {
  constructor(private readonly db: Database) {}

  async create(actor: Actor, input: CreateListingInput): Promise<string> {
    if (actor.role !== "provider") {
      throw new NotFoundError();
    }
    const [ownedMedia] = await this.db
      .select({ id: mediaObjects.id })
      .from(mediaObjects)
      .where(
        and(
          eq(mediaObjects.id, input.garmentMediaId),
          eq(mediaObjects.ownerUserId, actor.userId),
          eq(mediaObjects.kind, "listing_garment"),
        ),
      )
      .limit(1);
    if (!ownedMedia) {
      throw new NotFoundError();
    }

    const [created] = await this.db
      .insert(listings)
      .values({ ...input, providerId: actor.userId })
      .returning({ id: listings.id });
    return created!.id;
  }

  async updatePrice(
    actor: Actor,
    listingId: string,
    rentalPriceCents: number,
    expectedVersion: number,
  ): Promise<void> {
    if (actor.role !== "provider" || !Number.isInteger(rentalPriceCents) || rentalPriceCents < 0) {
      throw new NotFoundError();
    }
    const updated = await this.db
      .update(listings)
      .set({
        rentalPriceCents,
        version: expectedVersion + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(listings.id, listingId),
          eq(listings.providerId, actor.userId),
          eq(listings.version, expectedVersion),
        ),
      )
      .returning({ id: listings.id });
    if (updated.length !== 1) {
      throw new NotFoundError();
    }
  }

  async listRequests(actor: Actor): Promise<ProviderRequestRecord[]> {
    if (actor.role !== "provider") {
      throw new NotFoundError();
    }
    const rows = await this.db
      .select({
        id: offers.id,
        status: offers.status,
        eventType: eventBriefs.eventType,
        eventDate: eventBriefs.eventDate,
        dressCode: eventBriefs.dressCode,
        sizeLabel: eventBriefs.sizeLabel,
        listingId: listings.id,
        listingTitle: listings.title,
        rentalPriceCents: listings.rentalPriceCents,
      })
      .from(offers)
      .innerJoin(matches, eq(matches.id, offers.matchId))
      .innerJoin(listings, eq(listings.id, matches.listingId))
      .innerJoin(eventBriefs, eq(eventBriefs.id, matches.briefId))
      .where(
        and(
          eq(listings.providerId, actor.userId),
          inArray(offers.status, ["reservation_requested", "accepted", "declined"]),
        ),
      );

    return rows.map((row) => ({
      ...row,
      status: row.status as ProviderRequestRecord["status"],
      reservationId: null,
    }));
  }

  async decideRequest(
    actor: Actor,
    offerId: string,
    decision: "accepted" | "declined",
  ): Promise<void> {
    if (actor.role !== "provider") {
      throw new NotFoundError();
    }

    await this.db.transaction(async (transaction) => {
      const [request] = await transaction
        .select({ id: offers.id, status: offers.status })
        .from(offers)
        .innerJoin(matches, eq(matches.id, offers.matchId))
        .innerJoin(listings, eq(listings.id, matches.listingId))
        .where(
          and(
            eq(offers.id, offerId),
            eq(offers.status, "reservation_requested"),
            eq(listings.providerId, actor.userId),
          ),
        )
        .limit(1)
        .for("update", { of: offers });
      if (!request) {
        throw new NotFoundError();
      }

      transitionOffer(request.status, decision);
      const updated = await transaction
        .update(offers)
        .set({ status: decision })
        .where(and(eq(offers.id, request.id), eq(offers.status, request.status)))
        .returning({ id: offers.id });
      if (updated.length !== 1) {
        throw new NotFoundError();
      }
    });
  }
}
