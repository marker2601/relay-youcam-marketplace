import { eq, ne } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { eventBriefs, matches, mediaObjects, offers, reservations, tryOnJobs } from "@/lib/db/schema";
import type { Actor } from "@/lib/auth/demo-session";
import type { TenthsCm } from "@/lib/domain/contracts";
import {
  providerRequestSchema,
  reservationDetailSchema,
} from "@/lib/domain/schemas";
import {
  ListingEditConflictError,
  ListingRepository,
} from "@/lib/repositories/listings";
import { MarketplaceRepository } from "@/lib/repositories/marketplace";
import {
  ReservationConflictError,
  ReservationRepository,
} from "@/lib/repositories/reservations";
import { NotFoundError } from "@/lib/repositories/briefs";
import { seedIds, seedRelay } from "../../scripts/seed";
import {
  closeTestDatabase,
  createTestDatabaseConnection,
  migrateTestDatabase,
  resetTestDatabase,
  testDb,
} from "../helpers/test-db";

const cm = (value: number) => value as TenthsCm;
const briefId = "52000000-0000-4000-8000-000000000001";
const sourceMediaId = "52000000-0000-4000-8000-000000000002";
const crossBriefId = "52000000-0000-4000-8000-000000000003";
const crossMatchId = "52000000-0000-4000-8000-000000000004";
const crossOfferId = "52000000-0000-4000-8000-000000000005";
const now = new Date("2026-08-15T12:00:00.000Z");
const shopper: Actor = { userId: seedIds.shopper, role: "shopper" };
const boutique: Actor = { userId: seedIds.boutique, role: "provider" };
const jordan: Actor = { userId: seedIds.peerJordan, role: "provider" };

let graph: Awaited<ReturnType<MarketplaceRepository["createMatchesAndJobs"]>>;

beforeAll(migrateTestDatabase);
beforeEach(async () => {
  await resetTestDatabase();
  await seedRelay(testDb, { uploadAsset: async () => undefined });
  await testDb.insert(mediaObjects).values({
    id: sourceMediaId,
    ownerUserId: seedIds.shopper,
    kind: "brief_source",
    objectKey: `briefs/${briefId}/source.png`,
    contentType: "image/png",
    byteSize: 1_024,
    briefId,
  });
  await testDb.insert(eventBriefs).values({
    id: briefId,
    shopperId: seedIds.shopper,
    eventType: "wedding_guest",
    eventDate: "2026-09-20",
    eventStartsAt: new Date("2026-09-21T00:00:00.000Z"),
    dressCode: "formal",
    budgetMinCents: 5_000,
    budgetMaxCents: 12_000,
    garmentCategory: "full_body",
    sizeLabel: "M",
    measurementProfile: {
      bustTenthsCm: cm(900),
      waistTenthsCm: cm(720),
      hipsTenthsCm: cm(980),
      desiredEaseMinTenthsCm: cm(20),
      desiredEaseMaxTenthsCm: cm(120),
    },
    locationBand: "west",
    radiusMiles: 15,
    preferredColors: ["emerald", "navy", "burgundy"],
    styleTags: ["minimal", "polished", "statement"],
    exclusions: [],
    shopperMediaId: sourceMediaId,
    photoConsentAt: now,
  });
  graph = await new MarketplaceRepository(testDb).createMatchesAndJobs({
    briefId,
    actorId: seedIds.shopper,
    idempotencyKey: "reservation-flow-graph",
    now,
  });
  await testDb.update(offers).set({ status: "ready" });
  await testDb
    .update(tryOnJobs)
    .set({ status: "succeeded", completedAt: now })
    .where(ne(tryOnJobs.status, "succeeded"));
});
afterAll(closeTestDatabase);

describe("provider listing versions", () => {
  it("updates only owned inventory, increments its version, and expires stale offer work", async () => {
    const repository = new ListingRepository(testDb);
    const before = await repository.getOwned(boutique, seedIds.emeraldListing);

    const updated = await repository.updateMetadata(
      boutique,
      seedIds.emeraldListing,
      { rentalPriceCents: 8_100, colorTags: ["emerald", "jewel_tone"] },
      before.version,
      now,
    );

    expect(updated).toMatchObject({ version: 2, rentalPriceCents: 8_100 });
    const staleOffer = await testDb
      .select({ status: offers.status })
      .from(offers)
      .where(eq(offers.id, graph.offerIds[0]!));
    expect(staleOffer[0]!.status).toBe("expired");
    await expect(
      repository.updateMetadata(jordan, seedIds.emeraldListing, { rentalPriceCents: 1 }, 2, now),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects listing edits while its selected reservation is requested or confirmed", async () => {
    const reservationsRepository = new ReservationRepository(testDb);
    const selected = await reservationsRepository.request(shopper, graph.offerIds[0]!, "reserve-lock-001", now);
    const listingsRepository = new ListingRepository(testDb);

    await expect(
      listingsRepository.updateMetadata(
        boutique,
        seedIds.emeraldListing,
        { rentalPriceCents: 8_100 },
        1,
        now,
      ),
    ).rejects.toBeInstanceOf(ListingEditConflictError);

    await reservationsRepository.decide(
      boutique,
      selected.id,
      "accept",
      "accept-lock-001",
      now,
    );
    await expect(
      listingsRepository.updateMetadata(
        boutique,
        seedIds.emeraldListing,
        { rentalPriceCents: 8_100 },
        1,
        now,
      ),
    ).rejects.toBeInstanceOf(ListingEditConflictError);
  });
});

describe("reservation selection and provider decision", () => {
  it("preserves the designated backup while expiring only alternatives", async () => {
    const repository = new ReservationRepository(testDb);
    const primaryOfferId = graph.offerIds[0]!;
    const backupOfferId = graph.offerIds[1]!;
    const alternativeOfferId = graph.offerIds[2]!;
    const selected = await repository.request(shopper, primaryOfferId, "primary-request-001", now);
    const repeated = await repository.request(shopper, primaryOfferId, "primary-request-001", now);

    expect(repeated).toEqual(selected);
    expect(selected).toMatchObject({
      offerId: primaryOfferId,
      status: "requested",
      eventDate: "2026-09-20",
      pickupDate: "2026-09-19T17:00:00.000Z",
      returnDate: "2026-09-21T17:00:00.000Z",
      responseDueAt: "2026-08-15T16:00:00.000Z",
      backupOfferId,
      supersedesReservationId: null,
      simulation: true,
    });
    const persistedReservations = await testDb.select().from(reservations);
    expect(persistedReservations).toHaveLength(1);
    expect(persistedReservations[0]).toMatchObject({
      responseDueAt: new Date("2026-08-15T16:00:00.000Z"),
      backupOfferId,
      supersedesReservationId: null,
    });

    expect(
      (await testDb.select().from(offers).where(eq(offers.id, primaryOfferId)))[0]!.status,
    ).toBe("reservation_requested");
    expect(
      (await testDb.select().from(offers).where(eq(offers.id, backupOfferId)))[0]!.status,
    ).toBe("ready");
    expect(
      (await testDb.select().from(offers).where(eq(offers.id, alternativeOfferId)))[0]!.status,
    ).toBe("expired");
    expect(
      (await testDb.select().from(tryOnJobs).where(eq(tryOnJobs.id, graph.jobIds[1]!)))[0],
    ).toMatchObject({ status: "succeeded", normalizedErrorCode: null });

    await expect(
      repository.request(shopper, graph.offerIds[1]!, "reserve-second-001", now),
    ).rejects.toBeInstanceOf(ReservationConflictError);
  });

  it("requires the initial selected offer to be the primary", async () => {
    await expect(
      new ReservationRepository(testDb).request(
        shopper,
        graph.offerIds[1]!,
        "backup-first-001",
        now,
      ),
    ).rejects.toBeInstanceOf(ReservationConflictError);

    expect(await testDb.select().from(reservations)).toHaveLength(0);
  });

  it("waits for an independent designated backup before opening the primary request", async () => {
    await testDb
      .update(offers)
      .set({ status: "generating" })
      .where(eq(offers.id, graph.offerIds[1]!));

    await expect(
      new ReservationRepository(testDb).request(
        shopper,
        graph.offerIds[0]!,
        "backup-still-generating",
        now,
      ),
    ).rejects.toBeInstanceOf(ReservationConflictError);

    expect(await testDb.select().from(reservations)).toHaveLength(0);
    expect(
      (await testDb.select().from(offers).where(eq(offers.id, graph.offerIds[2]!)))[0]!.status,
    ).toBe("ready");
  });

  it("repairs migrated alternative roles before accepting the visible primary", async () => {
    await testDb.update(offers).set({ assuranceRole: "alternative" });
    const repository = new ReservationRepository(testDb);

    const selected = await repository.request(
      shopper,
      graph.offerIds[0]!,
      "request-migrated-primary",
      now,
    );

    expect(selected.backupOfferId).toBe(graph.offerIds[1]);
    const persisted = await testDb
      .select({ id: offers.id, role: offers.assuranceRole })
      .from(offers)
      .innerJoin(matches, eq(matches.id, offers.matchId));
    expect(new Map(persisted.map((row) => [row.id, row.role]))).toEqual(new Map([
      [graph.offerIds[0]!, "primary"],
      [graph.offerIds[1]!, "backup"],
      [graph.offerIds[2]!, "alternative"],
    ]));
  });

  it("caps a response deadline at an event that starts inside the normal window", async () => {
    const eventStartsAt = new Date(now.getTime() + 5 * 60_000);
    await testDb
      .update(eventBriefs)
      .set({ eventDate: "2026-08-15", eventStartsAt })
      .where(eq(eventBriefs.id, briefId));

    const selected = await new ReservationRepository(testDb).request(
      shopper,
      graph.offerIds[0]!,
      "near-event-deadline",
      now,
    );

    expect(selected.responseDueAt).toBe(eventStartsAt.toISOString());
  });

  it("rejects a stale request after the event instead of leaking a range error", async () => {
    await testDb
      .update(eventBriefs)
      .set({ eventDate: "2026-08-14", eventStartsAt: new Date("2026-08-14T12:00:00.000Z") })
      .where(eq(eventBriefs.id, briefId));

    await expect(
      new ReservationRepository(testDb).request(
        shopper,
        graph.offerIds[0]!,
        "post-event-request",
        now,
      ),
    ).rejects.toBeInstanceOf(ReservationConflictError);
  });

  it("activates one backup only after primary decline and repeats the same response concurrently", async () => {
    const repository = new ReservationRepository(testDb);
    const primary = await repository.request(
      shopper,
      graph.offerIds[0]!,
      "primary-request-002",
      now,
    );
    await repository.decide(boutique, primary.id, "decline", "decline-primary-002", now);

    const [first, concurrent] = await Promise.all([
      repository.activateBackup(shopper, primary.id, "activate-backup-002", now),
      repository.activateBackup(shopper, primary.id, "activate-backup-002", now),
    ]);
    const repeated = await repository.activateBackup(
      shopper,
      primary.id,
      "activate-backup-002",
      now,
    );

    expect(concurrent.id).toBe(first.id);
    expect(repeated.id).toBe(first.id);
    expect(first).toMatchObject({
      offerId: graph.offerIds[1],
      status: "requested",
      backupOfferId: null,
      supersedesReservationId: primary.id,
    });
    expect(await testDb.select().from(reservations)).toHaveLength(2);
  });

  it("rejects backup activation before primary decline or expiry", async () => {
    const repository = new ReservationRepository(testDb);
    const primary = await repository.request(
      shopper,
      graph.offerIds[0]!,
      "primary-request-early",
      now,
    );

    await expect(
      repository.activateBackup(shopper, primary.id, "activate-too-early", now),
    ).rejects.toBeInstanceOf(ReservationConflictError);
    expect(await testDb.select().from(reservations)).toHaveLength(1);
  });

  it("rejects a second active backup when the idempotency key differs", async () => {
    const repository = new ReservationRepository(testDb);
    const primary = await repository.request(
      shopper,
      graph.offerIds[0]!,
      "primary-request-second",
      now,
    );
    await repository.decide(boutique, primary.id, "decline", "decline-primary-second", now);
    await repository.activateBackup(shopper, primary.id, "activate-backup-first", now);

    await expect(
      repository.activateBackup(shopper, primary.id, "activate-backup-second", now),
    ).rejects.toBeInstanceOf(ReservationConflictError);
    expect(await testDb.select().from(reservations)).toHaveLength(2);
  });

  it("rejects a designated backup that belongs to a different brief", async () => {
    const repository = new ReservationRepository(testDb);
    const primary = await repository.request(
      shopper,
      graph.offerIds[0]!,
      "primary-request-cross",
      now,
    );
    await repository.decide(boutique, primary.id, "decline", "decline-primary-cross", now);
    await testDb.insert(eventBriefs).values({
      id: crossBriefId,
      shopperId: seedIds.shopper,
      eventType: "gala",
      eventDate: "2026-09-25",
      eventStartsAt: new Date("2026-09-26T00:00:00.000Z"),
      dressCode: "formal",
      budgetMinCents: 5_000,
      budgetMaxCents: 12_000,
      garmentCategory: "full_body",
      sizeLabel: "M",
      measurementProfile: {
        bustTenthsCm: cm(900),
        waistTenthsCm: cm(720),
        hipsTenthsCm: cm(980),
        desiredEaseMinTenthsCm: cm(20),
        desiredEaseMaxTenthsCm: cm(120),
      },
      locationBand: "west",
      radiusMiles: 15,
      preferredColors: ["burgundy"],
      styleTags: ["statement"],
      exclusions: [],
      photoConsentAt: now,
    });
    await testDb.insert(matches).values({
      id: crossMatchId,
      briefId: crossBriefId,
      listingId: seedIds.burgundyListing,
      briefRevision: 1,
      listingVersion: 1,
      scoreBasisPoints: 8_000,
      scoreBreakdown: { measurement: 3_000 },
      explanation: ["Matches formal dress code"],
    });
    await testDb.insert(offers).values({
      id: crossOfferId,
      matchId: crossMatchId,
      status: "ready",
      assuranceRole: "backup",
      expiresAt: new Date("2026-09-24T12:00:00.000Z"),
    });
    await testDb
      .update(reservations)
      .set({ backupOfferId: crossOfferId })
      .where(eq(reservations.id, primary.id));

    await expect(
      repository.activateBackup(shopper, primary.id, "activate-cross-brief", now),
    ).rejects.toBeInstanceOf(ReservationConflictError);
    expect(await testDb.select().from(reservations)).toHaveLength(1);
  });

  it("expires an overdue provider request before acceptance", async () => {
    await testDb
      .update(eventBriefs)
      .set({ eventStartsAt: new Date("2026-08-16T12:00:00.000Z") })
      .where(eq(eventBriefs.id, briefId));
    const repository = new ReservationRepository(testDb);
    const primary = await repository.request(
      shopper,
      graph.offerIds[0]!,
      "primary-request-003",
      now,
    );

    expect(primary.responseDueAt).toBe("2026-08-15T13:00:00.000Z");
    await expect(
      repository.decide(
        boutique,
        primary.id,
        "accept",
        "late-accept-003",
        new Date(primary.responseDueAt),
      ),
    ).rejects.toBeInstanceOf(ReservationConflictError);
    expect(
      (await testDb.select().from(reservations).where(eq(reservations.id, primary.id)))[0]!.status,
    ).toBe("cancelled");
    expect(
      (await testDb.select().from(offers).where(eq(offers.id, primary.offerId)))[0]!.status,
    ).toBe("expired");
  });

  it("reconciles an overdue request before returning reservation detail", async () => {
    await testDb
      .update(eventBriefs)
      .set({ eventStartsAt: new Date("2026-08-16T12:00:00.000Z") })
      .where(eq(eventBriefs.id, briefId));
    const repository = new ReservationRepository(testDb);
    const primary = await repository.request(shopper, graph.offerIds[0]!, "primary-read-004", now);

    const detail = await repository.getDetail(
      shopper,
      primary.id,
      new Date(primary.responseDueAt),
    );

    expect(detail.status).toBe("cancelled");
    expect(
      (await testDb.select().from(offers).where(eq(offers.id, primary.offerId)))[0]!.status,
    ).toBe("expired");
  });

  it("reconciles overdue requests before listing provider work", async () => {
    await testDb
      .update(eventBriefs)
      .set({ eventStartsAt: new Date("2026-08-16T12:00:00.000Z") })
      .where(eq(eventBriefs.id, briefId));
    const repository = new ReservationRepository(testDb);
    const primary = await repository.request(shopper, graph.offerIds[0]!, "primary-list-005", now);

    const requests = await repository.listProviderRequests(
      boutique,
      new Date(primary.responseDueAt),
    );

    expect(requests).toEqual([]);
    await expect(repository.getProviderRequestByOfferId(boutique, primary.offerId, new Date(primary.responseDueAt)))
      .resolves.toMatchObject({
        id: primary.offerId,
        reservationId: primary.id,
        status: "expired",
        offerStatus: "expired",
      });
    await expect(
      repository.getProviderRequestByOfferId(
        { userId: seedIds.peerJordan, role: "provider" },
        primary.offerId,
        new Date(primary.responseDueAt),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(
      (await testDb.select().from(reservations).where(eq(reservations.id, primary.id)))[0]!.status,
    ).toBe("cancelled");
  });

  it("retries a serialization race between a deadline decision and provider-list reconciliation", async () => {
    await testDb
      .update(eventBriefs)
      .set({ eventStartsAt: new Date("2026-08-16T12:00:00.000Z") })
      .where(eq(eventBriefs.id, briefId));
    const repository = new ReservationRepository(testDb);
    const primary = await repository.request(
      shopper,
      graph.offerIds[0]!,
      "primary-race-006",
      now,
    );
    const deadline = new Date(primary.responseDueAt);

    const blockerConnection = createTestDatabaseConnection({ max: 1 });
    const concurrentConnection = createTestDatabaseConnection({ max: 1 });
    const observerConnection = createTestDatabaseConnection({ max: 1 });
    const concurrentRepository = new ReservationRepository(concurrentConnection.db);
    let releaseBlocker: () => void = () => undefined;
    let announceBlocker: () => void = () => undefined;
    const blockerReleased = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    const blockerLocked = new Promise<void>((resolve) => {
      announceBlocker = resolve;
    });
    const blocker = blockerConnection.db.transaction(async (transaction) => {
      await transaction
        .select({ id: reservations.id })
        .from(reservations)
        .where(eq(reservations.id, primary.id))
        .for("update", { of: reservations });
      announceBlocker();
      await blockerReleased;
    });
    await blockerLocked;

    const decisionPromise = repository.decide(
      boutique,
      primary.id,
      "accept",
      "deadline-race-006",
      deadline,
    );
    const providerListPromise = concurrentRepository.listProviderRequests(boutique, deadline);
    let waitingTransactions = 0;
    try {
      for (let attempt = 0; attempt < 100 && waitingTransactions < 2; attempt += 1) {
        const [activity] = await observerConnection.sql<{ waiting_transactions: number }[]>`
          select count(*)::int as waiting_transactions
          from pg_stat_activity
          where datname = current_database()
            and wait_event_type = 'Lock'
            and query ilike '%reservations%'
        `;
        waitingTransactions = activity!.waiting_transactions;
        if (waitingTransactions < 2) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
    } finally {
      releaseBlocker();
      await blocker;
    }
    const [decision, providerList] = await Promise.allSettled([
      decisionPromise,
      providerListPromise,
    ]).finally(async () => {
      await Promise.all([
        blockerConnection.sql.end(),
        concurrentConnection.sql.end(),
        observerConnection.sql.end(),
      ]);
    });

    expect(waitingTransactions).toBeGreaterThanOrEqual(2);
    expect(decision.status).toBe("rejected");
    if (decision.status === "rejected") {
      expect(decision.reason).toBeInstanceOf(ReservationConflictError);
    }
    expect(providerList).toEqual({ status: "fulfilled", value: [] });
    expect(
      (await testDb.select().from(reservations).where(eq(reservations.id, primary.id)))[0]!.status,
    ).toBe("cancelled");
    expect(
      (await testDb.select().from(offers).where(eq(offers.id, primary.offerId)))[0]!.status,
    ).toBe("expired");
  });

  it("allows only the selected listing provider to accept exactly once", async () => {
    const repository = new ReservationRepository(testDb);
    const selected = await repository.request(shopper, graph.offerIds[0]!, "reserve-accept-001", now);

    await expect(
      repository.decide(jordan, selected.id, "accept", "wrong-provider-001", now),
    ).rejects.toBeInstanceOf(NotFoundError);
    const accepted = await repository.decide(
      boutique,
      selected.id,
      "accept",
      "accept-once-001",
      now,
    );
    const repeated = await repository.decide(
      boutique,
      selected.id,
      "accept",
      "accept-once-001",
      now,
    );

    expect(repeated).toEqual(accepted);
    expect(accepted.status).toBe("confirmed");
    expect((await testDb.select().from(offers).where(eq(offers.id, selected.offerId)))[0]!.status).toBe("accepted");
    expect((await testDb.select().from(reservations))[0]!.status).toBe("confirmed");
  });

  it("keeps accepted shopper and provider history readable after the event", async () => {
    const eventStartsAt = new Date(now.getTime() + 2 * 60 * 60_000);
    await testDb
      .update(eventBriefs)
      .set({ eventDate: "2026-08-15", eventStartsAt })
      .where(eq(eventBriefs.id, briefId));
    const repository = new ReservationRepository(testDb);
    const selected = await repository.request(
      shopper,
      graph.offerIds[0]!,
      "post-event-history-request",
      now,
    );
    await repository.decide(
      boutique,
      selected.id,
      "accept",
      "post-event-history-accept",
      now,
    );
    const afterEvent = new Date(eventStartsAt.getTime() + 60_000);

    const shopperHistory = await repository.getDetail(shopper, selected.id, afterEvent);
    const providerHistory = await repository.listProviderRequests(boutique, afterEvent);
    const providerDetail = await repository.getProviderRequestByOfferId(
      boutique,
      selected.offerId,
      afterEvent,
    );

    expect(shopperHistory.status).toBe("confirmed");
    expect(providerHistory).toHaveLength(1);
    expect(providerDetail.status).toBe("accepted");
  });

  it("validates actual repository recovery responses against canonical schemas", async () => {
    const repository = new ReservationRepository(testDb);
    const selected = await repository.request(
      shopper,
      graph.offerIds[0]!,
      "canonical-response-request",
      now,
    );
    const [providerRequest] = await repository.listProviderRequests(boutique, now);

    expect(reservationDetailSchema.parse(selected)).toEqual(selected);
    expect(providerRequestSchema.parse(providerRequest)).toEqual(providerRequest);
  });

  it("maps decline to a declined offer and cancelled reservation", async () => {
    const repository = new ReservationRepository(testDb);
    const selected = await repository.request(shopper, graph.offerIds[0]!, "reserve-decline-001", now);
    const declined = await repository.decide(
      boutique,
      selected.id,
      "decline",
      "decline-once-001",
      now,
    );

    expect(declined.status).toBe("cancelled");
    expect((await testDb.select().from(offers).where(eq(offers.id, selected.offerId)))[0]!.status).toBe("declined");
    expect((await testDb.select().from(reservations))[0]!.status).toBe("cancelled");
    expect(await repository.listProviderRequests(boutique)).toEqual([
      expect.objectContaining({ reservationId: selected.id, status: "declined" }),
    ]);
  });
});
