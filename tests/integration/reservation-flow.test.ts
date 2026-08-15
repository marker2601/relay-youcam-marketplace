import { eq, ne } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { eventBriefs, mediaObjects, offers, reservations, tryOnJobs } from "@/lib/db/schema";
import type { Actor } from "@/lib/auth/demo-session";
import type { TenthsCm } from "@/lib/domain/contracts";
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
  migrateTestDatabase,
  resetTestDatabase,
  testDb,
} from "../helpers/test-db";

const cm = (value: number) => value as TenthsCm;
const briefId = "52000000-0000-4000-8000-000000000001";
const sourceMediaId = "52000000-0000-4000-8000-000000000002";
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
  await testDb.update(offers).set({ status: "generating" });
  await testDb.update(tryOnJobs).set({ status: "processing" });
  await testDb.update(offers).set({ status: "ready" }).where(eq(offers.id, graph.offerIds[0]!));
  await testDb
    .update(tryOnJobs)
    .set({ status: "succeeded", completedAt: now })
    .where(eq(tryOnJobs.id, graph.jobIds[0]!));
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
  it("selects one ready offer idempotently and expires all competing current-revision work", async () => {
    const repository = new ReservationRepository(testDb);
    const selected = await repository.request(shopper, graph.offerIds[0]!, "reserve-once-001", now);
    const repeated = await repository.request(shopper, graph.offerIds[0]!, "reserve-once-001", now);

    expect(repeated).toEqual(selected);
    expect(selected).toMatchObject({
      offerId: graph.offerIds[0],
      status: "requested",
      eventDate: "2026-09-20",
      pickupDate: "2026-09-19T17:00:00.000Z",
      returnDate: "2026-09-21T17:00:00.000Z",
      simulation: true,
    });
    expect(await testDb.select().from(reservations)).toHaveLength(1);

    const chosen = await testDb.select().from(offers).where(eq(offers.id, graph.offerIds[0]!));
    const competing = await testDb
      .select()
      .from(offers)
      .where(ne(offers.id, graph.offerIds[0]!));
    expect(chosen[0]!.status).toBe("reservation_requested");
    expect(competing.every((offer) => offer.status === "expired")).toBe(true);
    const stoppedJobs = await testDb
      .select()
      .from(tryOnJobs)
      .where(ne(tryOnJobs.id, graph.jobIds[0]!));
    expect(stoppedJobs.every((job) => job.status === "failed" && job.normalizedErrorCode === "superseded")).toBe(true);

    await expect(
      repository.request(shopper, graph.offerIds[1]!, "reserve-second-001", now),
    ).rejects.toBeInstanceOf(ReservationConflictError);
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
