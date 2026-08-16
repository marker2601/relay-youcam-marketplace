import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createBriefCommandSchema,
  createListingCommandSchema,
} from "@/lib/domain/schemas";

const validBrief = {
  eventType: "wedding_guest",
  eventDate: "2099-06-12",
  eventStartsAt: "2099-06-13T00:00:00.000Z",
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
  afterEach(() => vi.useRealTimers());

  it("accepts a normalized future event brief", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-06-11T00:00:00.000Z"));

    expect(createBriefCommandSchema.parse(validBrief)).toMatchObject(validBrief);
  });

  it("rejects an event date in the past", () => {
    expect(
      createBriefCommandSchema.safeParse({ ...validBrief, eventDate: "2000-01-01" }).success,
    ).toBe(false);
  });

  it("accepts a future event time later today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-06-11T12:00:00.000Z"));

    expect(
      createBriefCommandSchema.parse({
        ...validBrief,
        eventDate: "2099-06-11",
        eventStartsAt: "2099-06-11T19:00:00.000Z",
      }),
    ).toMatchObject({ eventDate: "2099-06-11" });
  });

  it("rejects a past event time today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-06-11T12:00:00.000Z"));

    const result = createBriefCommandSchema.safeParse({
      ...validBrief,
      eventDate: "2099-06-11",
      eventStartsAt: "2099-06-11T11:00:00.000Z",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({
        path: ["eventStartsAt"],
        message: "Event must be within the next 90 days",
      }),
    );
  });

  it("rejects an event date that does not match the timestamp's Chicago date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-06-11T00:00:00.000Z"));

    const result = createBriefCommandSchema.safeParse({
      ...validBrief,
      eventDate: "2099-06-13",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({
        path: ["eventDate"],
        message: "Event date must match the event time in America/Chicago",
      }),
    );
  });

  it("rejects an event timestamp beyond 90 days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-06-11T00:00:00.000Z"));

    const result = createBriefCommandSchema.safeParse({
      ...validBrief,
      eventStartsAt: "2099-09-10T00:00:01.000Z",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({
        path: ["eventStartsAt"],
        message: "Event must be within the next 90 days",
      }),
    );
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
