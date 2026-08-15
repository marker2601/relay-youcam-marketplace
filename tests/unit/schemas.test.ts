import { describe, expect, it } from "vitest";

import {
  createBriefCommandSchema,
  createListingCommandSchema,
} from "@/lib/domain/schemas";

const validBrief = {
  eventType: "wedding_guest",
  eventDate: "2099-06-12",
  dressCode: "formal",
  budgetMinCents: 4_000,
  budgetMaxCents: 12_000,
  garmentCategory: "full_body",
  sizeLabel: "M",
  measurementProfile: {
    bustTenthsCm: 900,
    waistTenthsCm: 720,
    hipsTenthsCm: 980,
    desiredEaseMinTenthsCm: 20,
    desiredEaseMaxTenthsCm: 120,
  },
  locationBand: "west",
  radiusMiles: 15,
  preferredColors: ["emerald"],
  styleTags: ["formal", "minimal"],
  exclusions: ["sequins"],
  photoConsent: true,
} as const;

const validListing = {
  title: "Emerald satin midi",
  garmentCategory: "full_body",
  sizeLabel: "M",
  measurements: {
    bustTenthsCm: 960,
    waistTenthsCm: 780,
    hipsTenthsCm: 1_040,
    lengthTenthsCm: 1_180,
  },
  condition: "excellent",
  colorTags: ["emerald"],
  styleTags: ["formal", "minimal"],
  rentalPriceCents: 7_800,
  depositDisplayCents: 4_000,
  serviceRadiusMiles: 20,
  locationBand: "west",
  unavailableRanges: [{ startDate: "2099-07-01", endDate: "2099-07-03" }],
} as const;

describe("createBriefCommandSchema", () => {
  it("accepts a normalized future event brief", () => {
    expect(createBriefCommandSchema.parse(validBrief)).toMatchObject(validBrief);
  });

  it("rejects an event date in the past", () => {
    expect(
      createBriefCommandSchema.safeParse({ ...validBrief, eventDate: "2000-01-01" }).success,
    ).toBe(false);
  });

  it("rejects a minimum budget above the maximum", () => {
    expect(
      createBriefCommandSchema.safeParse({
        ...validBrief,
        budgetMinCents: 13_000,
        budgetMaxCents: 12_000,
      }).success,
    ).toBe(false);
  });

  it("requires affirmative photo consent", () => {
    expect(
      createBriefCommandSchema.safeParse({ ...validBrief, photoConsent: false }).success,
    ).toBe(false);
  });

  it("rejects fractional tenths-centimeter measurements", () => {
    expect(
      createBriefCommandSchema.safeParse({
        ...validBrief,
        measurementProfile: { ...validBrief.measurementProfile, bustTenthsCm: 900.5 },
      }).success,
    ).toBe(false);
  });

  it("rejects an unsupported garment category", () => {
    expect(
      createBriefCommandSchema.safeParse({ ...validBrief, garmentCategory: "shoes" }).success,
    ).toBe(false);
  });

  it("requires at least one style tag", () => {
    expect(createBriefCommandSchema.safeParse({ ...validBrief, styleTags: [] }).success).toBe(
      false,
    );
  });
});

describe("createListingCommandSchema", () => {
  it("accepts a normalized listing", () => {
    expect(createListingCommandSchema.parse(validListing)).toMatchObject(validListing);
  });

  it("rejects a negative rental price", () => {
    expect(
      createListingCommandSchema.safeParse({ ...validListing, rentalPriceCents: -1 }).success,
    ).toBe(false);
  });

  it("rejects an unavailable range whose end precedes its start", () => {
    expect(
      createListingCommandSchema.safeParse({
        ...validListing,
        unavailableRanges: [{ startDate: "2099-07-03", endDate: "2099-07-01" }],
      }).success,
    ).toBe(false);
  });
});
