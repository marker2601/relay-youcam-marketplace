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
import type {
  AssuranceRole,
  EventUrgency,
  OfferStatus,
  ReservationStatus,
} from "@/lib/domain/contracts";
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
  offerStatus: OfferStatus;
  assuranceRole: AssuranceRole;
  status: "requested" | "confirmed" | "ready_for_pickup" | "in_use" | "returned" | "cancelled";
  garmentTitle: string;
  providerDisplayName: string;
  providerType: "peer" | "boutique";
  eventDate: string;
  eventStartsAt: string;
  urgency: EventUrgency;
  pickupDate: string;
  returnDate: string;
  rentalPriceCents: number;
  depositDisplayCents: number;
  responseDueAt: string;
  backupOfferId: string | null;
  backup: { offerId: string; title: string; providerDisplayName: string } | null;
  canActivateBackup: boolean;
  supersedesReservationId: string | null;
  simulation: true;
}

export interface ProviderReservationRequest {
  id: string;
  reservationId: string;
  status: "reservation_requested" | "accepted" | "declined" | "expired";
  offerStatus: OfferStatus;
  assuranceRole: AssuranceRole;
  eventType: "wedding_guest" | "cocktail_party" | "gala" | "holiday_party";
  eventDate: string;
  eventStartsAt: string;
  urgency: EventUrgency;
  dressCode: "cocktail" | "formal" | "semi_formal" | "festive";
  sizeLabel: string;
  listingId: string;
  listingTitle: string;
  rentalPriceCents: number;
  pickupDate: string;
  returnDate: string;
  responseDueAt: string;
  hasBackup: boolean;
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
  let current = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth += 1) {
    if ("code" in current && current.code === "40001") return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
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

type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

interface LockedReservationOffer {
  reservationId: string;
  reservationStatus: ReservationStatus;
  responseDueAt: Date;
  offerId: string;
  offerStatus: OfferStatus;
}

interface ReconciledReservationOffer {
  reservationStatus: ReservationStatus;
  offerStatus: OfferStatus;
  timedOut: boolean;
}

async function reconcileTimedOutRequest(
  transaction: DatabaseTransaction,
  request: LockedReservationOffer,
  now: Date,
): Promise<ReconciledReservationOffer> {
  if (
    request.reservationStatus !== "requested" ||
    request.responseDueAt.getTime() > now.getTime()
  ) {
    return {
      reservationStatus: request.reservationStatus,
      offerStatus: request.offerStatus,
      timedOut: false,
    };
  }

  transitionReservation(request.reservationStatus, "cancelled");
  transitionOffer(request.offerStatus, "expired");
  await transaction
    .update(reservations)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(reservations.id, request.reservationId),
        eq(reservations.status, "requested"),
      ),
    );
  await transaction
    .update(offers)
    .set({ status: "expired" })
    .where(
      and(
        eq(offers.id, request.offerId),
        eq(offers.status, "reservation_requested"),
      ),
    );
  return {
    reservationStatus: "cancelled",
    offerStatus: "expired",
    timedOut: true,
  };
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
          assuranceRole: offers.assuranceRole,
          briefId: reservations.briefId,
          garmentTitle: listings.title,
          providerDisplayName: users.displayName,
          providerType: users.providerType,
          eventDate: eventBriefs.eventDate,
          eventStartsAt: eventBriefs.eventStartsAt,
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
      if (!selected) return selected;
      const reconciled = await reconcileTimedOutRequest(
        transaction,
        {
          reservationId: selected.id,
          reservationStatus: selected.status,
          responseDueAt: selected.responseDueAt,
          offerId: selected.offerId,
          offerStatus: selected.offerStatus,
        },
        now,
      );
      const [backupCandidate] = selected.backupOfferId
        ? await transaction
            .select({
              offerId: offers.id,
              offerStatus: offers.status,
              assuranceRole: offers.assuranceRole,
              briefId: matches.briefId,
              title: listings.title,
              providerDisplayName: users.displayName,
            })
            .from(offers)
            .innerJoin(matches, eq(matches.id, offers.matchId))
            .innerJoin(listings, eq(listings.id, matches.listingId))
            .innerJoin(users, eq(users.id, listings.providerId))
            .where(eq(offers.id, selected.backupOfferId))
            .limit(1)
        : [];
      const eligibleBackup =
        backupCandidate?.assuranceRole === "backup" &&
        backupCandidate.briefId === selected.briefId
          ? backupCandidate
          : undefined;
      const [successor] =
        actor.role === "shopper" && eligibleBackup
          ? await transaction
              .select({ id: reservations.id })
              .from(reservations)
              .where(eq(reservations.supersedesReservationId, selected.id))
              .limit(1)
          : [];
      return {
        ...selected,
        status: reconciled.reservationStatus,
        offerStatus: reconciled.offerStatus,
        backupCandidate: eligibleBackup,
        hasSuccessor: Boolean(successor),
      };
    });
    if (!row || !row.providerType) throw new NotFoundError();
    return {
      id: row.id,
      offerId: row.offerId,
      offerStatus: row.offerStatus,
      assuranceRole: row.assuranceRole,
      status: row.status,
      garmentTitle: row.garmentTitle,
      providerDisplayName: row.providerDisplayName,
      providerType: row.providerType,
      eventDate: row.eventDate,
      eventStartsAt: row.eventStartsAt.toISOString(),
      urgency: classifyEventUrgency(row.eventStartsAt, now),
      pickupDate: row.pickupDate.toISOString(),
      returnDate: row.returnDate.toISOString(),
      rentalPriceCents: row.rentalPriceCents,
      depositDisplayCents: row.depositDisplayCents,
      responseDueAt: row.responseDueAt.toISOString(),
      backupOfferId: actor.role === "shopper" ? row.backupOfferId : null,
      backup:
        actor.role === "shopper" && row.backupCandidate
          ? {
              offerId: row.backupCandidate.offerId,
              title: row.backupCandidate.title,
              providerDisplayName: row.backupCandidate.providerDisplayName,
            }
          : null,
      canActivateBackup:
        actor.role === "shopper" &&
        row.status === "cancelled" &&
        (row.offerStatus === "declined" || row.offerStatus === "expired") &&
        row.backupCandidate?.offerStatus === "ready" &&
        !row.hasSuccessor,
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
    const outcome = await retrySerializable(() => this.db.transaction(async (transaction) => {
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
      const reconciled = await reconcileTimedOutRequest(
        transaction,
        {
          reservationId,
          reservationStatus: request.reservationStatus,
          responseDueAt: request.responseDueAt,
          offerId: request.offerId,
          offerStatus: request.offerStatus,
        },
        now,
      );
      if (reconciled.timedOut) return "timed_out" as const;

      const targetReservation = decision === "accept" ? "confirmed" : "cancelled";
      const targetOffer = decision === "accept" ? "accepted" : "declined";
      if (
        reconciled.reservationStatus === targetReservation &&
        reconciled.offerStatus === targetOffer
      ) {
        return "decided" as const;
      }
      if (
        reconciled.reservationStatus !== "requested" ||
        reconciled.offerStatus !== "reservation_requested"
      ) {
        throw new ReservationConflictError("This request has already been decided");
      }
      transitionReservation(reconciled.reservationStatus, targetReservation);
      transitionOffer(reconciled.offerStatus, targetOffer);
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
    }, { isolationLevel: "serializable" }));
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

        const reconciled = await reconcileTimedOutRequest(
          transaction,
          {
            reservationId: original.id,
            reservationStatus: original.status,
            responseDueAt: original.responseDueAt,
            offerId: original.offerId,
            offerStatus: original.offerStatus,
          },
          now,
        );

        if (
          reconciled.reservationStatus !== "cancelled" ||
          (reconciled.offerStatus !== "declined" && reconciled.offerStatus !== "expired")
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
    await retrySerializable(() => this.db.transaction(async (transaction) => {
      const overdue = await transaction
        .select({
          reservationId: reservations.id,
          reservationStatus: reservations.status,
          responseDueAt: reservations.responseDueAt,
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
        await reconcileTimedOutRequest(
          transaction,
          {
            reservationId: request.reservationId,
            reservationStatus: request.reservationStatus,
            responseDueAt: request.responseDueAt,
            offerId: request.offerId,
            offerStatus: request.offerStatus,
          },
          now,
        );
      }
    }, { isolationLevel: "serializable" }));
    const rows = await this.db
      .select({
        id: offers.id,
        reservationId: reservations.id,
        status: offers.status,
        assuranceRole: offers.assuranceRole,
        eventType: eventBriefs.eventType,
        eventDate: eventBriefs.eventDate,
        eventStartsAt: eventBriefs.eventStartsAt,
        dressCode: eventBriefs.dressCode,
        sizeLabel: eventBriefs.sizeLabel,
        listingId: listings.id,
        listingTitle: listings.title,
        rentalPriceCents: reservations.rentalPriceCents,
        pickupDate: reservations.pickupDate,
        returnDate: reservations.returnDate,
        responseDueAt: reservations.responseDueAt,
        backupOfferId: reservations.backupOfferId,
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
    return rows.map((row) => {
      const { backupOfferId, ...publicRow } = row;
      return {
        ...publicRow,
        status: row.status as ProviderReservationRequest["status"],
        offerStatus: row.status,
        eventStartsAt: row.eventStartsAt.toISOString(),
        urgency: classifyEventUrgency(row.eventStartsAt, now),
        pickupDate: row.pickupDate.toISOString(),
        returnDate: row.returnDate.toISOString(),
        responseDueAt: row.responseDueAt.toISOString(),
        hasBackup: backupOfferId !== null,
      };
    });
  }

  async getProviderRequestByOfferId(
    actor: Actor,
    offerId: string,
    now = new Date(),
  ): Promise<ProviderReservationRequest> {
    if (actor.role !== "provider") throw new NotFoundError();
    const row = await retrySerializable(() =>
      this.db.transaction(async (transaction) => {
        const [selected] = await transaction
          .select({
            id: offers.id,
            reservationId: reservations.id,
            reservationStatus: reservations.status,
            offerStatus: offers.status,
            assuranceRole: offers.assuranceRole,
            eventType: eventBriefs.eventType,
            eventDate: eventBriefs.eventDate,
            eventStartsAt: eventBriefs.eventStartsAt,
            dressCode: eventBriefs.dressCode,
            sizeLabel: eventBriefs.sizeLabel,
            listingId: listings.id,
            listingTitle: listings.title,
            rentalPriceCents: reservations.rentalPriceCents,
            pickupDate: reservations.pickupDate,
            returnDate: reservations.returnDate,
            responseDueAt: reservations.responseDueAt,
            backupOfferId: reservations.backupOfferId,
          })
          .from(reservations)
          .innerJoin(offers, eq(offers.id, reservations.offerId))
          .innerJoin(matches, eq(matches.id, offers.matchId))
          .innerJoin(listings, eq(listings.id, matches.listingId))
          .innerJoin(eventBriefs, eq(eventBriefs.id, reservations.briefId))
          .where(
            and(
              eq(offers.id, offerId),
              eq(listings.providerId, actor.userId),
              inArray(offers.status, [
                "reservation_requested",
                "accepted",
                "declined",
                "expired",
              ]),
            ),
          )
          .limit(1)
          .for("update", { of: reservations });
        if (!selected) throw new NotFoundError();
        const reconciled = await reconcileTimedOutRequest(
          transaction,
          {
            reservationId: selected.reservationId,
            reservationStatus: selected.reservationStatus,
            responseDueAt: selected.responseDueAt,
            offerId: selected.id,
            offerStatus: selected.offerStatus,
          },
          now,
        );
        return { ...selected, offerStatus: reconciled.offerStatus };
      }, { isolationLevel: "serializable" }),
    );
    return {
      id: row.id,
      reservationId: row.reservationId,
      status: row.offerStatus as ProviderReservationRequest["status"],
      offerStatus: row.offerStatus,
      assuranceRole: row.assuranceRole,
      eventType: row.eventType,
      eventDate: row.eventDate,
      eventStartsAt: row.eventStartsAt.toISOString(),
      urgency: classifyEventUrgency(row.eventStartsAt, now),
      dressCode: row.dressCode,
      sizeLabel: row.sizeLabel,
      listingId: row.listingId,
      listingTitle: row.listingTitle,
      rentalPriceCents: row.rentalPriceCents,
      pickupDate: row.pickupDate.toISOString(),
      returnDate: row.returnDate.toISOString(),
      responseDueAt: row.responseDueAt.toISOString(),
      hasBackup: row.backupOfferId !== null,
    };
  }
}
