import { and, eq, inArray, lte, ne, or } from "drizzle-orm";

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
import { classifyEventUrgency, responseWindowMs } from "@/lib/domain/assurance";
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
  responseDueAt: string;
  backupOfferId: string | null;
  supersedesReservationId: string | null;
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

function isSerializationFailure(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "40001";
}

async function retrySerializable<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= 2 || !isSerializationFailure(error)) throw error;
    }
  }
}

export class ReservationRepository {
  constructor(private readonly db: Database) {}

  async getDetail(
    actor: Actor,
    reservationId: string,
    now = new Date(),
  ): Promise<ReservationDetail> {
    const ownership =
      actor.role === "shopper"
        ? eq(reservations.shopperId, actor.userId)
        : eq(reservations.providerId, actor.userId);
    const row = await this.db.transaction(async (transaction) => {
      const [selected] = await transaction
        .select({
          id: reservations.id,
          offerId: reservations.offerId,
          status: reservations.status,
          offerStatus: offers.status,
          garmentTitle: listings.title,
          providerDisplayName: users.displayName,
          providerType: users.providerType,
          eventDate: eventBriefs.eventDate,
          pickupDate: reservations.pickupDate,
          returnDate: reservations.returnDate,
          rentalPriceCents: reservations.rentalPriceCents,
          depositDisplayCents: reservations.depositDisplayCents,
          responseDueAt: reservations.responseDueAt,
          backupOfferId: reservations.backupOfferId,
          supersedesReservationId: reservations.supersedesReservationId,
        })
        .from(reservations)
        .innerJoin(offers, eq(offers.id, reservations.offerId))
        .innerJoin(matches, eq(matches.id, offers.matchId))
        .innerJoin(listings, eq(listings.id, matches.listingId))
        .innerJoin(users, eq(users.id, listings.providerId))
        .innerJoin(eventBriefs, eq(eventBriefs.id, reservations.briefId))
        .where(and(eq(reservations.id, reservationId), ownership))
        .limit(1)
        .for("update", { of: reservations });
      if (
        selected?.status === "requested" &&
        selected.responseDueAt.getTime() <= now.getTime()
      ) {
        transitionReservation(selected.status, "cancelled");
        transitionOffer(selected.offerStatus, "expired");
        await transaction
          .update(reservations)
          .set({ status: "cancelled" })
          .where(and(eq(reservations.id, selected.id), eq(reservations.status, "requested")));
        await transaction
          .update(offers)
          .set({ status: "expired" })
          .where(
            and(
              eq(offers.id, selected.offerId),
              eq(offers.status, "reservation_requested"),
            ),
          );
        return { ...selected, status: "cancelled" as const, offerStatus: "expired" as const };
      }
      return selected;
    });
    if (!row || !row.providerType) throw new NotFoundError();
    return {
      id: row.id,
      offerId: row.offerId,
      status: row.status,
      garmentTitle: row.garmentTitle,
      providerDisplayName: row.providerDisplayName,
      providerType: row.providerType,
      eventDate: row.eventDate,
      pickupDate: row.pickupDate.toISOString(),
      returnDate: row.returnDate.toISOString(),
      rentalPriceCents: row.rentalPriceCents,
      depositDisplayCents: row.depositDisplayCents,
      responseDueAt: row.responseDueAt.toISOString(),
      backupOfferId: row.backupOfferId,
      supersedesReservationId: row.supersedesReservationId,
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
          assuranceRole: offers.assuranceRole,
          matchId: matches.id,
          briefId: eventBriefs.id,
          briefRevision: eventBriefs.matchingRevision,
          eventDate: eventBriefs.eventDate,
          eventStartsAt: eventBriefs.eventStartsAt,
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
      if (candidate.assuranceRole !== "primary") {
        throw new ReservationConflictError("Only the primary offer can be requested first");
      }
      transitionOffer(candidate.offerStatus, "reservation_requested");

      const [backup] = await transaction
        .select({ id: offers.id })
        .from(offers)
        .innerJoin(matches, eq(matches.id, offers.matchId))
        .where(
          and(
            eq(matches.briefId, candidate.briefId),
            eq(matches.briefRevision, candidate.briefRevision),
            eq(offers.assuranceRole, "backup"),
            eq(offers.status, "ready"),
            ne(offers.id, offerId),
          ),
        )
        .limit(1)
        .for("update", { of: offers });

      const pickupDate = chicagoNoon(addCalendarDays(candidate.eventDate, -1));
      const eventDate = chicagoNoon(candidate.eventDate);
      const returnDate = chicagoNoon(addCalendarDays(candidate.eventDate, 1));
      const urgency = classifyEventUrgency(candidate.eventStartsAt, now);
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
          responseDueAt: new Date(now.getTime() + responseWindowMs(urgency)),
          backupOfferId: backup?.id ?? null,
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
        .innerJoin(offers, eq(offers.matchId, matches.id))
        .where(
          and(
            eq(matches.briefId, candidate.briefId),
            eq(matches.briefRevision, candidate.briefRevision),
            ne(matches.id, candidate.matchId),
            eq(offers.assuranceRole, "alternative"),
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

    return this.getDetail(actor, reservationId, now);
  }

  async decide(
    actor: Actor,
    reservationId: string,
    decision: "accept" | "decline",
    idempotencyKey: string,
    now: Date,
  ): Promise<ReservationDetail> {
    if (actor.role !== "provider") throw new NotFoundError();
    const outcome = await this.db.transaction(async (transaction) => {
      const [request] = await transaction
        .select({
          reservationStatus: reservations.status,
          responseDueAt: reservations.responseDueAt,
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

      if (
        request.reservationStatus === "requested" &&
        request.responseDueAt.getTime() <= now.getTime()
      ) {
        transitionReservation(request.reservationStatus, "cancelled");
        transitionOffer(request.offerStatus, "expired");
        await transaction
          .update(reservations)
          .set({ status: "cancelled" })
          .where(and(eq(reservations.id, reservationId), eq(reservations.status, "requested")));
        await transaction
          .update(offers)
          .set({ status: "expired" })
          .where(
            and(eq(offers.id, request.offerId), eq(offers.status, "reservation_requested")),
          );
        return "timed_out" as const;
      }

      const targetReservation = decision === "accept" ? "confirmed" : "cancelled";
      const targetOffer = decision === "accept" ? "accepted" : "declined";
      if (
        request.reservationStatus === targetReservation &&
        request.offerStatus === targetOffer
      ) {
        return "decided" as const;
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
      return "decided" as const;
    }, { isolationLevel: "serializable" });
    if (outcome === "timed_out") {
      throw new ReservationConflictError("The provider response window has expired");
    }
    return this.getDetail(actor, reservationId, now);
  }

  async activateBackup(
    actor: Actor,
    reservationId: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<ReservationDetail> {
    if (actor.role !== "shopper") throw new NotFoundError();

    const activatedReservationId = await retrySerializable(() =>
      this.db.transaction(async (transaction) => {
        const [original] = await transaction
          .select({
            id: reservations.id,
            status: reservations.status,
            responseDueAt: reservations.responseDueAt,
            offerId: reservations.offerId,
            offerStatus: offers.status,
            backupOfferId: reservations.backupOfferId,
            briefId: reservations.briefId,
            eventDate: reservations.eventDate,
            pickupDate: reservations.pickupDate,
            returnDate: reservations.returnDate,
            eventStartsAt: eventBriefs.eventStartsAt,
          })
          .from(reservations)
          .innerJoin(offers, eq(offers.id, reservations.offerId))
          .innerJoin(eventBriefs, eq(eventBriefs.id, reservations.briefId))
          .where(
            and(
              eq(reservations.id, reservationId),
              eq(reservations.shopperId, actor.userId),
            ),
          )
          .limit(1)
          .for("update", { of: reservations });
        if (!original) throw new NotFoundError();

        const scope = `reservation_backup:${reservationId}`;
        const [prior] = await transaction
          .select({ reservationId: idempotencyKeys.responseResourceId })
          .from(idempotencyKeys)
          .where(
            and(
              eq(idempotencyKeys.actorId, actor.userId),
              eq(idempotencyKeys.scope, scope),
              eq(idempotencyKeys.key, idempotencyKey),
            ),
          )
          .limit(1);
        if (prior?.reservationId) return prior.reservationId;

        let originalStatus = original.status;
        let originalOfferStatus = original.offerStatus;
        if (
          originalStatus === "requested" &&
          original.responseDueAt.getTime() <= now.getTime()
        ) {
          transitionReservation(originalStatus, "cancelled");
          transitionOffer(originalOfferStatus, "expired");
          await transaction
            .update(reservations)
            .set({ status: "cancelled" })
            .where(and(eq(reservations.id, original.id), eq(reservations.status, "requested")));
          await transaction
            .update(offers)
            .set({ status: "expired" })
            .where(
              and(
                eq(offers.id, original.offerId),
                eq(offers.status, "reservation_requested"),
              ),
            );
          originalStatus = "cancelled";
          originalOfferStatus = "expired";
        }

        if (
          originalStatus !== "cancelled" ||
          (originalOfferStatus !== "declined" && originalOfferStatus !== "expired")
        ) {
          throw new ReservationConflictError("The primary request is still active");
        }
        if (!original.backupOfferId) {
          throw new ReservationConflictError("No backup offer is available");
        }

        const [backup] = await transaction
          .select({
            id: offers.id,
            status: offers.status,
            assuranceRole: offers.assuranceRole,
            briefId: matches.briefId,
            providerId: listings.providerId,
            rentalPriceCents: listings.rentalPriceCents,
            depositDisplayCents: listings.depositDisplayCents,
          })
          .from(offers)
          .innerJoin(matches, eq(matches.id, offers.matchId))
          .innerJoin(listings, eq(listings.id, matches.listingId))
          .where(eq(offers.id, original.backupOfferId))
          .limit(1)
          .for("update", { of: offers });
        if (
          !backup ||
          backup.status !== "ready" ||
          backup.assuranceRole !== "backup" ||
          backup.briefId !== original.briefId
        ) {
          throw new ReservationConflictError("The designated backup is no longer eligible");
        }

        const [existingSuccessor] = await transaction
          .select({ id: reservations.id })
          .from(reservations)
          .where(eq(reservations.supersedesReservationId, original.id))
          .limit(1);
        if (existingSuccessor) {
          throw new ReservationConflictError("A backup has already been activated");
        }

        transitionOffer(backup.status, "reservation_requested");
        const urgency = classifyEventUrgency(original.eventStartsAt, now);
        const [created] = await transaction
          .insert(reservations)
          .values({
            offerId: backup.id,
            briefId: original.briefId,
            shopperId: actor.userId,
            providerId: backup.providerId,
            eventDate: original.eventDate,
            pickupDate: original.pickupDate,
            returnDate: original.returnDate,
            rentalPriceCents: backup.rentalPriceCents,
            depositDisplayCents: backup.depositDisplayCents,
            status: "requested",
            responseDueAt: new Date(now.getTime() + responseWindowMs(urgency)),
            backupOfferId: null,
            supersedesReservationId: original.id,
            createdAt: now,
          })
          .returning({ id: reservations.id });
        await transaction
          .update(offers)
          .set({ status: "reservation_requested" })
          .where(and(eq(offers.id, backup.id), eq(offers.status, "ready")));
        await transaction.insert(idempotencyKeys).values({
          actorId: actor.userId,
          scope,
          key: idempotencyKey,
          responseResourceId: created!.id,
          createdAt: now,
        });
        return created!.id;
      }, { isolationLevel: "serializable" }),
    );

    return this.getDetail(actor, activatedReservationId, now);
  }

  async listProviderRequests(
    actor: Actor,
    now = new Date(),
  ): Promise<ProviderReservationRequest[]> {
    if (actor.role !== "provider") throw new NotFoundError();
    await this.db.transaction(async (transaction) => {
      const overdue = await transaction
        .select({
          reservationId: reservations.id,
          reservationStatus: reservations.status,
          offerId: offers.id,
          offerStatus: offers.status,
        })
        .from(reservations)
        .innerJoin(offers, eq(offers.id, reservations.offerId))
        .innerJoin(matches, eq(matches.id, offers.matchId))
        .innerJoin(listings, eq(listings.id, matches.listingId))
        .where(
          and(
            eq(listings.providerId, actor.userId),
            eq(reservations.status, "requested"),
            lte(reservations.responseDueAt, now),
          ),
        )
        .for("update", { of: reservations });
      if (overdue.length === 0) return;
      for (const request of overdue) {
        transitionReservation(request.reservationStatus, "cancelled");
        transitionOffer(request.offerStatus, "expired");
      }
      await transaction
        .update(reservations)
        .set({ status: "cancelled" })
        .where(inArray(reservations.id, overdue.map((request) => request.reservationId)));
      await transaction
        .update(offers)
        .set({ status: "expired" })
        .where(inArray(offers.id, overdue.map((request) => request.offerId)));
    }, { isolationLevel: "serializable" });
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
