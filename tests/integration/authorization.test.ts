import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
  eventBriefs,
  listings,
  matches,
  mediaObjects,
  offers,
  users,
} from "@/lib/db/schema";
import type { Actor } from "@/lib/auth/demo-session";
import type { TenthsCm } from "@/lib/domain/contracts";
import { BriefRepository, NotFoundError } from "@/lib/repositories/briefs";
import { ListingRepository } from "@/lib/repositories/listings";
import { createDemoSessionPostHandler } from "@/app/api/demo/session/route";
import { seedIds, seedRelay } from "../../scripts/seed";
import {
  closeTestDatabase,
  migrateTestDatabase,
  resetTestDatabase,
  testDb,
} from "../helpers/test-db";

const cm = (value: number) => value as TenthsCm;
const shopperBId = "60000000-0000-4000-8000-000000000001";
const shopperBMediaId = "60000000-0000-4000-8000-000000000002";
const shopperBBriefId = "60000000-0000-4000-8000-000000000003";
const priyaMatchId = "60000000-0000-4000-8000-000000000004";
const priyaOfferId = "60000000-0000-4000-8000-000000000005";

const shopperA: Actor = { userId: seedIds.shopper, role: "shopper" };
const shopperB: Actor = { userId: shopperBId, role: "shopper" };
const providerA: Actor = { userId: seedIds.peerJordan, role: "provider" };
const providerB: Actor = { userId: seedIds.peerPriya, role: "provider" };

beforeAll(migrateTestDatabase);
beforeEach(async () => {
  await resetTestDatabase();
  await seedRelay(testDb, { uploadAsset: async () => undefined });
  await testDb.insert(users).values({
    id: shopperBId,
    demoRole: "shopper",
    displayName: "Second Shopper",
    providerType: null,
  });
  await testDb.insert(mediaObjects).values({
    id: shopperBMediaId,
    ownerUserId: shopperBId,
    kind: "brief_source",
    objectKey: "briefs/second-shopper/source/private.png",
    contentType: "image/png",
    byteSize: 1_024,
    briefId: shopperBBriefId,
  });
  await testDb.insert(eventBriefs).values({
    id: shopperBBriefId,
    shopperId: shopperBId,
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
    preferredColors: ["burgundy"],
    styleTags: ["statement"],
    exclusions: [],
    shopperMediaId: shopperBMediaId,
    photoConsentAt: new Date("2026-08-15T12:00:00.000Z"),
    status: "active",
  });
  await testDb.insert(matches).values({
    id: priyaMatchId,
    briefId: shopperBBriefId,
    listingId: seedIds.burgundyListing,
    briefRevision: 1,
    listingVersion: 1,
    scoreBasisPoints: 8_000,
    scoreBreakdown: { measurement: 3_000 },
    explanation: ["Matches formal dress code"],
  });
  await testDb.insert(offers).values({
    id: priyaOfferId,
    matchId: priyaMatchId,
    status: "reservation_requested",
    expiresAt: new Date("2026-09-19T12:00:00.000Z"),
  });
});
afterAll(closeTestDatabase);

describe("signed demo session route", () => {
  it("returns 404 for an unknown identity and issues a hardened role-based redirect for a seed user", async () => {
    const handler = createDemoSessionPostHandler({
      db: testDb,
      sessionSecret: "integration-session-secret-at-least-32-characters",
      production: true,
      now: () => Date.UTC(2026, 7, 15, 12, 0, 0),
    });

    const unknown = await handler(
      new Request("http://localhost/api/demo/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "99999999-9999-4999-8999-999999999999" }),
      }),
    );
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("set-cookie")).toBeNull();

    const known = await handler(
      new Request("http://localhost/api/demo/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: seedIds.peerJordan }),
      }),
    );
    expect(known.status).toBe(303);
    expect(known.headers.get("location")).toBe("/provider");
    expect(known.headers.get("set-cookie")).toContain("HttpOnly");
    expect(known.headers.get("set-cookie")).toContain("Secure");
  });
});

describe("authorized repositories", () => {
  it("hides a shopper brief from every other shopper for reads and deletion", async () => {
    const repository = new BriefRepository(testDb);

    await expect(repository.getById(shopperA, shopperBBriefId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(repository.markDeleting(shopperA, shopperBBriefId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(repository.getById(shopperB, shopperBBriefId)).resolves.toMatchObject({
      id: shopperBBriefId,
    });
    const [persisted] = await testDb.select().from(eventBriefs);
    expect(persisted!.status).toBe("active");
  });

  it("does not let a shopper create provider inventory", async () => {
    const repository = new ListingRepository(testDb);

    await expect(
      repository.create(shopperA, {
        title: "Unauthorized Dress",
        garmentCategory: "full_body",
        sizeLabel: "M",
        measurements: {
          bustTenthsCm: cm(960),
          waistTenthsCm: cm(780),
          hipsTenthsCm: cm(1_040),
          lengthTenthsCm: cm(1_200),
        },
        condition: "excellent",
        colorTags: ["emerald"],
        styleTags: ["formal"],
        rentalPriceCents: 7_000,
        depositDisplayCents: 3_000,
        serviceRadiusMiles: 15,
        locationBand: "west",
        garmentMediaId: seedIds.emeraldMedia,
        unavailableRanges: [],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await testDb.select().from(listings)).toHaveLength(5);
  });

  it("prevents provider A from changing provider B inventory or request state", async () => {
    const repository = new ListingRepository(testDb);
    const [beforeListing] = await testDb
      .select()
      .from(listings)
      .where(eq(listings.id, seedIds.burgundyListing));

    await expect(
      repository.updatePrice(providerA, seedIds.burgundyListing, 8_800, 1),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(repository.decideRequest(providerA, priyaOfferId, "accepted")).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const [afterListing] = await testDb
      .select()
      .from(listings)
      .where(eq(listings.id, seedIds.burgundyListing));
    const [afterOffer] = await testDb.select().from(offers);
    expect(afterListing!.rentalPriceCents).toBe(beforeListing!.rentalPriceCents);
    expect(afterOffer!.status).toBe("reservation_requested");
  });

  it("returns provider-scoped request fields without shopper media or measurements", async () => {
    const repository = new ListingRepository(testDb);
    const requests = await repository.listRequests(providerB);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      id: priyaOfferId,
      listingId: seedIds.burgundyListing,
      eventType: "wedding_guest",
    });
    const serialized = JSON.stringify(requests);
    expect(serialized).not.toContain("shopperMediaId");
    expect(serialized).not.toContain("measurementProfile");
    await expect(repository.listRequests(providerA)).resolves.toEqual([]);
  });
});
