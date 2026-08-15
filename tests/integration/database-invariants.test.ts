import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  eventBriefs,
  listings,
  matches,
  mediaObjects,
  offers,
  reservations,
  users,
} from "@/lib/db/schema";
import type { TenthsCm } from "@/lib/domain/contracts";
import {
  closeTestDatabase,
  migrateTestDatabase,
  resetTestDatabase,
  testDb,
} from "../helpers/test-db";

const ids = {
  shopper: "20000000-0000-4000-8000-000000000001",
  provider: "20000000-0000-4000-8000-000000000002",
  sourceMedia: "20000000-0000-4000-8000-000000000003",
  garmentMedia: "20000000-0000-4000-8000-000000000004",
  garmentMedia2: "20000000-0000-4000-8000-000000000005",
  brief: "20000000-0000-4000-8000-000000000006",
  listing: "20000000-0000-4000-8000-000000000007",
  listing2: "20000000-0000-4000-8000-000000000008",
  match: "20000000-0000-4000-8000-000000000009",
  match2: "20000000-0000-4000-8000-000000000010",
  offer: "20000000-0000-4000-8000-000000000011",
  offer2: "20000000-0000-4000-8000-000000000012",
  reservation: "20000000-0000-4000-8000-000000000013",
  reservation2: "20000000-0000-4000-8000-000000000014",
} as const;

const cm = (value: number) => value as TenthsCm;

const garmentMeasurements = {
  bustTenthsCm: cm(960),
  waistTenthsCm: cm(780),
  hipsTenthsCm: cm(1_040),
  lengthTenthsCm: cm(1_180),
};

async function expectConstraint(
  operation: Promise<unknown>,
  code: "23505" | "23514",
  constraintName: string,
): Promise<void> {
  let caught: unknown;
  try {
    await operation;
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({
    cause: { code, constraint_name: constraintName },
  });
}

async function seedSecondGarmentMedia(): Promise<void> {
  await testDb.insert(mediaObjects).values({
    id: ids.garmentMedia2,
    ownerUserId: ids.provider,
    kind: "listing_garment",
    objectKey: "listings/garment-2.jpg",
    contentType: "image/jpeg",
    byteSize: 1_024,
    listingId: ids.listing2,
  });
}

async function seedBaseGraph(): Promise<void> {
  await testDb.insert(users).values([
    { id: ids.shopper, demoRole: "shopper", displayName: "Maya Chen" },
    {
      id: ids.provider,
      demoRole: "provider",
      displayName: "West Loop Wardrobe",
      providerType: "boutique",
    },
  ]);
  await testDb.insert(mediaObjects).values([
    {
      id: ids.sourceMedia,
      ownerUserId: ids.shopper,
      kind: "brief_source",
      objectKey: "briefs/source.jpg",
      contentType: "image/jpeg",
      byteSize: 1_024,
      briefId: ids.brief,
    },
    {
      id: ids.garmentMedia,
      ownerUserId: ids.provider,
      kind: "listing_garment",
      objectKey: "listings/garment.jpg",
      contentType: "image/jpeg",
      byteSize: 1_024,
      listingId: ids.listing,
    },
  ]);
  await testDb.insert(eventBriefs).values({
    id: ids.brief,
    shopperId: ids.shopper,
    eventType: "wedding_guest",
    eventDate: "2099-06-12",
    dressCode: "formal",
    budgetMinCents: 4_000,
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
    preferredColors: ["emerald"],
    styleTags: ["formal"],
    exclusions: [],
    shopperMediaId: ids.sourceMedia,
    photoConsentAt: new Date("2099-01-01T00:00:00.000Z"),
    status: "active",
  });
  await testDb.insert(listings).values({
    id: ids.listing,
    providerId: ids.provider,
    title: "Emerald satin midi",
    garmentCategory: "full_body",
    sizeLabel: "M",
    measurements: garmentMeasurements,
    condition: "excellent",
    colorTags: ["emerald"],
    styleTags: ["formal"],
    rentalPriceCents: 7_800,
    depositDisplayCents: 4_000,
    serviceRadiusMiles: 20,
    locationBand: "west",
    garmentMediaId: ids.garmentMedia,
    unavailableRanges: [],
    reliabilityBasisPoints: 9_000,
    status: "active",
  });
  await testDb.insert(matches).values({
    id: ids.match,
    briefId: ids.brief,
    listingId: ids.listing,
    briefRevision: 1,
    listingVersion: 1,
    scoreBasisPoints: 8_725,
    scoreBreakdown: { measurement: 3_200 },
    explanation: ["Measurements allow 4–8 cm ease"],
  });
  await testDb.insert(offers).values({
    id: ids.offer,
    matchId: ids.match,
    status: "ready",
    expiresAt: new Date("2099-06-11T00:00:00.000Z"),
  });
}

beforeAll(migrateTestDatabase);
beforeEach(resetTestDatabase);
afterAll(closeTestDatabase);

describe("database invariants", () => {
  it("stores a valid marketplace graph", async () => {
    await expect(seedBaseGraph()).resolves.toBeUndefined();
  });

  it("rejects a duplicate match for the same brief revision and listing version", async () => {
    await seedBaseGraph();
    await expectConstraint(
      testDb.insert(matches).values({
        id: ids.match2,
        briefId: ids.brief,
        listingId: ids.listing,
        briefRevision: 1,
        listingVersion: 1,
        scoreBasisPoints: 7_000,
        scoreBreakdown: {},
        explanation: ["Duplicate"],
      }),
      "23505",
      "matches_brief_revision_listing_version_unique",
    );
  });

  it("rejects a listing with a negative rental price", async () => {
    await seedBaseGraph();
    await seedSecondGarmentMedia();
    await expectConstraint(
      testDb.insert(listings).values({
        id: ids.listing2,
        providerId: ids.provider,
        title: "Invalid listing",
        garmentCategory: "full_body",
        sizeLabel: "M",
        measurements: garmentMeasurements,
        condition: "good",
        colorTags: ["black"],
        styleTags: ["formal"],
        rentalPriceCents: -1,
        depositDisplayCents: 0,
        serviceRadiusMiles: 10,
        locationBand: "west",
        garmentMediaId: ids.garmentMedia2,
        unavailableRanges: [],
        reliabilityBasisPoints: 8_000,
        status: "active",
      }),
      "23514",
      "listings_nonnegative_rental_price_check",
    );
  });

  it("rejects a match score above 10000 basis points", async () => {
    await seedBaseGraph();
    await expectConstraint(
      testDb.insert(matches).values({
        id: ids.match2,
        briefId: ids.brief,
        listingId: ids.listing,
        briefRevision: 2,
        listingVersion: 1,
        scoreBasisPoints: 10_001,
        scoreBreakdown: {},
        explanation: ["Invalid score"],
      }),
      "23514",
      "matches_score_check",
    );
  });

  it("allows only one non-cancelled reservation per brief", async () => {
    await seedBaseGraph();
    await seedSecondGarmentMedia();
    await testDb.insert(listings).values({
      id: ids.listing2,
      providerId: ids.provider,
      title: "Midnight jumpsuit",
      garmentCategory: "full_body",
      sizeLabel: "M",
      measurements: garmentMeasurements,
      condition: "good",
      colorTags: ["black"],
      styleTags: ["formal"],
      rentalPriceCents: 6_500,
      depositDisplayCents: 3_000,
      serviceRadiusMiles: 20,
      locationBand: "west",
      garmentMediaId: ids.garmentMedia2,
      unavailableRanges: [],
      reliabilityBasisPoints: 8_500,
      status: "active",
    });
    await testDb.insert(matches).values({
      id: ids.match2,
      briefId: ids.brief,
      listingId: ids.listing2,
      briefRevision: 1,
      listingVersion: 1,
      scoreBasisPoints: 8_000,
      scoreBreakdown: {},
      explanation: ["Within budget"],
    });
    await testDb.insert(offers).values({
      id: ids.offer2,
      matchId: ids.match2,
      status: "ready",
      expiresAt: new Date("2099-06-11T00:00:00.000Z"),
    });
    const reservationValues = {
      briefId: ids.brief,
      shopperId: ids.shopper,
      providerId: ids.provider,
      eventDate: new Date("2099-06-12T05:00:00.000Z"),
      pickupDate: new Date("2099-06-11T05:00:00.000Z"),
      returnDate: new Date("2099-06-14T05:00:00.000Z"),
      rentalPriceCents: 7_800,
      depositDisplayCents: 4_000,
      status: "requested" as const,
    };
    await testDb.insert(reservations).values({
      ...reservationValues,
      id: ids.reservation,
      offerId: ids.offer,
    });

    await expectConstraint(
      testDb.insert(reservations).values({
        ...reservationValues,
        id: ids.reservation2,
        offerId: ids.offer2,
      }),
      "23505",
      "reservations_one_active_per_brief_unique",
    );
  });
});
