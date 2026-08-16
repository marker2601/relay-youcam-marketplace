import { and, eq, inArray, ne, or } from "drizzle-orm";

import type { Actor } from "@/lib/auth/demo-session";
import type { Database } from "@/lib/db/client";
import {
  eventBriefs,
  idempotencyKeys,
  listings,
  matches,
  offers,
  reservations,
  tryOnJobs,
  users,
} from "@/lib/db/schema";
import { transitionOffer, transitionReservation } from "@/lib/domain/state-machines";
import { NotFoundError } from "@/lib/repositories/briefs";

export class ReservationConflictError extends Error {
  constructor(message = "This event already has a selected garment") {
    super(message);
    this.name = "ReservationConflictError";
  }
}

export interface ReservationDetail {
  id: string;
  offerId: string;
  status: "requested" | "confirmed" | "ready_for_pickup" | "in_use" | "returned" | "cancelled";
  garmentTitle: string;
  providerDisplayName: string;
  providerType: "peer" | "boutique";
  eventDate: string;
  pickupDate: string;
  returnDate: string;
  rentalPriceCents: number;
  depositDisplayCents: number;
  simulation: true;
}

export interface ProviderReservationRequest {
  id: string;
  reservationId: string;
  status: "reservation_requested" | "accepted" | "declined";
  eventType: "wedding_guest" | "cocktail_party" | "gala" | "holiday_party";
  eventDate: string;
  dressCode: "cocktail" | "formal" | "semi_formal" | "festive";
  sizeLabel: string;
  listingId: string;
  listingTitle: string;
  rentalPriceCents: number;
  pickupDate: string;
  returnDate: string;
}

function addCalendarDays(dateOnly: string, days: number): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

function chicagoNoon(dateOnly: string): Date {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const desired = Date.UTC(year!, month! - 1, day!, 12, 0, 0);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(desired));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)!.value);
  const observedAsUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  return new Date(desired + (desired - observedAsUtc));
}

export class ReservationRepository {
  constructor(private readonly db: Database) {}

  async getDetail(actor: Actor, reservationId: string): Promise<ReservationDetail> {
    const ownership =
      actor.role === "shopper"
        ? eq(reservations.shopperId, actor.userId)
        : eq(reservations.providerId, actor.userId);
    const [row] = await this.db
      .select({
        id: reservations.id,
        offerId: reservations.offerId,
        status: reservations.status,
        garmentTitle: listings.title,
        providerDisplayName: users.displayName,
        providerType: users.providerType,
        eventDate: eventBriefs.eventDate,
        pickupDate: reservations.pickupDate,
        returnDate: reservations.returnDate,
        rentalPriceCents: reservations.rentalPriceCents,
        depositDisplayCents: reservations.depositDisplayCents,
      })
      .from(reservations)
      .innerJoin(offers, eq(offers.id, reservations.offerId))
      .innerJoin(matches, eq(matches.id, offers.matchId))
      .innerJoin(listings, eq(listings.id, matches.listingId))
      .innerJoin(users, eq(users.id, listings.providerId))
      .innerJoin(eventBriefs, eq(eventBriefs.id, reservations.briefId))
      .where(and(eq(reservations.id, reservationId), ownership))
      .limit(1);
    if (!row || !row.providerType) throw new NotFoundError();
    return {
      ...row,
      providerType: row.providerType,
      pickupDate: row.pickupDate.toISOString(),
      returnDate: row.returnDate.toISOString(),
      simulation: true,
    };
  }

  async request(
    actor: Actor,
    offerId: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<ReservationDetail> {
    if (actor.role !== "shopper") throw new NotFoundError();

    const reservationId = await this.db.transaction(async (transaction) => {
      const [candidate] = await transaction
        .select({
          offerId: offers.id,
          offerStatus: offers.status,
          matchId: matches.id,
          briefId: eventBriefs.id,
          briefRevision: eventBriefs.matchingRevision,
          eventDate: eventBriefs.eventDate,
          providerId: listings.providerId,
          rentalPriceCents: listings.rentalPriceCents,
          depositDisplayCents: listings.depositDisplayCents,
        })
        .from(offers)
        .innerJoin(matches, eq(matches.id, offers.matchId))
        .innerJoin(eventBriefs, eq(eventBriefs.id, matches.briefId))
        .innerJoin(listings, eq(listings.id, matches.listingId))
        .where(
          and(
            eq(offers.id, offerId),
            eq(eventBriefs.shopperId, actor.userId),
            eq(matches.briefRevision, eventBriefs.matchingRevision),
          ),
        )
        .limit(1)
        .for("update", { of: offers });
      if (!candidate) throw new NotFoundError();

      const [sameOffer] = await transaction
        .select({ id: reservations.id })
        .from(reservations)
        .where(and(eq(reservations.offerId, offerId), eq(reservations.shopperId, actor.userId)))
        .limit(1);
      if (sameOffer) return sameOffer.id;

      const [existingSelection] = await transaction
        .select({ id: reservations.id })
        .from(reservations)
        .where(
          and(
            eq(reservations.briefId, candidate.briefId),
            eq(reservations.shopperId, actor.userId),
            ne(reservations.status, "cancelled"),
          ),
        )
        .limit(1);
      if (existingSelection) throw new ReservationConflictError();
      if (candidate.offerStatus !== "ready") {
        throw new ReservationConflictError("Only a ready offer can be requested");
      }
      transitionOffer(candidate.offerStatus, "reservation_requested");

      const pickupDate = chicagoNoon(addCalendarDays(candidate.eventDate, -1));
      const eventDate = chicagoNoon(candidate.eventDate);
      const returnDate = chicagoNoon(addCalendarDays(candidate.eventDate, 1));
      const [created] = await transaction
        .insert(reservations)
        .values({
          offerId,
          briefId: candidate.briefId,
          shopperId: actor.userId,
          providerId: candidate.providerId,
          eventDate,
          pickupDate,
          returnDate,
          rentalPriceCents: candidate.rentalPriceCents,
          depositDisplayCents: candidate.depositDisplayCents,
          status: "requested",
          responseDueAt: new Date(now.getTime() + 4 * 60 * 60_000),
          backupOfferId: null,
          supersedesReservationId: null,
          createdAt: now,
        })
        .returning({ id: reservations.id });
      await transaction
        .update(offers)
        .set({ status: "reservation_requested" })
        .where(and(eq(offers.id, offerId), eq(offers.status, "ready")));

      const competingMatches = await transaction
        .select({ id: matches.id })
        .from(matches)
        .where(
          and(
            eq(matches.briefId, candidate.briefId),
            eq(matches.briefRevision, candidate.briefRevision),
            ne(matches.id, candidate.matchId),
          ),
        );
      if (competingMatches.length > 0) {
        const ids = competingMatches.map((match) => match.id);
        await transaction
          .update(offers)
          .set({ status: "expired" })
          .where(
            and(
              inArray(offers.matchId, ids),
              inArray(offers.status, ["matched", "generating", "ready"]),
            ),
          );
        await transaction
          .update(tryOnJobs)
          .set({
            status: "failed",
            normalizedErrorCode: "superseded",
            nextPollAt: null,
            completedAt: now,
          })
          .where(
            and(
              inArray(tryOnJobs.matchId, ids),
              inArray(tryOnJobs.status, ["queued", "uploading", "processing"]),
            ),
          );
      }
      await transaction
        .insert(idempotencyKeys)
        .values({
          actorId: actor.userId,
          scope: "reservation_request",
          key: idempotencyKey,
          responseResourceId: created!.id,
          createdAt: now,
        })
        .onConflictDoNothing();
      return created!.id;
    }, { isolationLevel: "serializable" });

    return this.getDetail(actor, reservationId);
  }

  async decide(
    actor: Actor,
    reservationId: string,
    decision: "accept" | "decline",
    idempotencyKey: string,
    now: Date,
  ): Promise<ReservationDetail> {
    if (actor.role !== "provider") throw new NotFoundError();
    await this.db.transaction(async (transaction) => {
      const [request] = await transaction
        .select({
          reservationStatus: reservations.status,
          offerId: offers.id,
          offerStatus: offers.status,
        })
        .from(reservations)
        .innerJoin(offers, eq(offers.id, reservations.offerId))
        .innerJoin(matches, eq(matches.id, offers.matchId))
        .innerJoin(listings, eq(listings.id, matches.listingId))
        .where(and(eq(reservations.id, reservationId), eq(listings.providerId, actor.userId)))
        .limit(1)
        .for("update", { of: reservations });
      if (!request) throw new NotFoundError();

      const targetReservation = decision === "accept" ? "confirmed" : "cancelled";
      const targetOffer = decision === "accept" ? "accepted" : "declined";
      if (
        request.reservationStatus === targetReservation &&
        request.offerStatus === targetOffer
      ) {
        return;
      }
      if (
        request.reservationStatus !== "requested" ||
        request.offerStatus !== "reservation_requested"
      ) {
        throw new ReservationConflictError("This request has already been decided");
      }
      transitionReservation(request.reservationStatus, targetReservation);
      transitionOffer(request.offerStatus, targetOffer);
      await transaction
        .update(reservations)
        .set({ status: targetReservation })
        .where(and(eq(reservations.id, reservationId), eq(reservations.status, "requested")));
      await transaction
        .update(offers)
        .set({ status: targetOffer })
        .where(and(eq(offers.id, request.offerId), eq(offers.status, "reservation_requested")));
      await transaction
        .insert(idempotencyKeys)
        .values({
          actorId: actor.userId,
          scope: `reservation_${decision}`,
          key: idempotencyKey,
          responseResourceId: reservationId,
          createdAt: now,
        })
        .onConflictDoNothing();
    }, { isolationLevel: "serializable" });
    return this.getDetail(actor, reservationId);
  }

  async listProviderRequests(actor: Actor): Promise<ProviderReservationRequest[]> {
    if (actor.role !== "provider") throw new NotFoundError();
    const rows = await this.db
      .select({
        id: offers.id,
        reservationId: reservations.id,
        status: offers.status,
        eventType: eventBriefs.eventType,
        eventDate: eventBriefs.eventDate,
        dressCode: eventBriefs.dressCode,
        sizeLabel: eventBriefs.sizeLabel,
        listingId: listings.id,
        listingTitle: listings.title,
        rentalPriceCents: reservations.rentalPriceCents,
        pickupDate: reservations.pickupDate,
        returnDate: reservations.returnDate,
      })
      .from(reservations)
      .innerJoin(offers, eq(offers.id, reservations.offerId))
      .innerJoin(matches, eq(matches.id, offers.matchId))
      .innerJoin(listings, eq(listings.id, matches.listingId))
      .innerJoin(eventBriefs, eq(eventBriefs.id, reservations.briefId))
      .where(
        and(
          eq(listings.providerId, actor.userId),
          or(eq(offers.status, "reservation_requested"), eq(offers.status, "accepted"), eq(offers.status, "declined")),
        ),
      );
    return rows.map((row) => ({
      ...row,
      status: row.status as ProviderReservationRequest["status"],
      pickupDate: row.pickupDate.toISOString(),
      returnDate: row.returnDate.toISOString(),
    }));
  }
}
