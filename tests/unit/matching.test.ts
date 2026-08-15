import { describe, expect, it } from "vitest";

import type { TenthsCm } from "@/lib/domain/contracts";
import {
  distanceScore,
  measurementScore,
  passesHardFilters,
  priceScore,
  rankMatches,
  tagScore,
  type MatchBrief,
  type MatchListing,
} from "@/lib/domain/matching";

const cm = (value: number) => value as TenthsCm;

const baseBrief: MatchBrief = {
  eventType: "wedding_guest",
  eventWindow: { startDate: "2026-09-11", endDate: "2026-09-13" },
  dressCode: "formal",
  garmentCategory: "full_body",
  budgetMinCents: 5_000,
  budgetMaxCents: 10_000,
  measurementProfile: {
    bustTenthsCm: cm(900),
    waistTenthsCm: cm(700),
    hipsTenthsCm: cm(980),
    desiredEaseMinTenthsCm: cm(20),
    desiredEaseMaxTenthsCm: cm(120),
  },
  radiusMiles: 10,
  preferredColors: ["emerald", "navy"],
  styleTags: ["minimal", "polished"],
};

const baseListing: MatchListing = {
  listingId: "00000000-0000-4000-8000-000000000001",
  status: "active",
  garmentCategory: "full_body",
  measurements: {
    bustTenthsCm: cm(960),
    waistTenthsCm: cm(760),
    hipsTenthsCm: cm(1_040),
    lengthTenthsCm: cm(1_200),
  },
  unavailableRanges: [],
  rentalPriceCents: 5_000,
  serviceRadiusMiles: 8,
  distanceMiles: 0,
  colorTags: ["emerald", "navy"],
  styleTags: ["formal", "black_tie", "wedding_guest", "minimal", "polished"],
  reliabilityBasisPoints: 10_000,
};

function listing(overrides: Partial<MatchListing> = {}): MatchListing {
  return {
    ...baseListing,
    ...overrides,
    measurements: overrides.measurements ?? { ...baseListing.measurements },
    unavailableRanges: overrides.unavailableRanges ?? [],
    colorTags: overrides.colorTags ?? [...baseListing.colorTags],
    styleTags: overrides.styleTags ?? [...baseListing.styleTags],
  };
}

describe("passesHardFilters", () => {
  it.each([
    ["inactive listing", { status: "inactive" }],
    [
      "unavailable event window",
      { unavailableRanges: [{ startDate: "2026-09-12", endDate: "2026-09-14" }] },
    ],
    ["category mismatch", { garmentCategory: "upper_body" }],
    ["over-budget price", { rentalPriceCents: 10_001 }],
    ["outside the provider radius", { distanceMiles: 8.01 }],
    [
      "missing required garment measurement",
      {
        measurements: {
          bustTenthsCm: cm(960),
          hipsTenthsCm: cm(1_040),
          lengthTenthsCm: cm(1_200),
        },
      },
    ],
  ] satisfies Array<[string, Partial<MatchListing>]>)('rejects an %s', (_name, overrides) => {
    expect(passesHardFilters(baseBrief, listing(overrides))).toBe(false);
  });

  it("rejects incompatible circumference ease outside the inclusive 2-12 cm range", () => {
    expect(
      passesHardFilters(
        baseBrief,
        listing({
          measurements: { ...baseListing.measurements, waistTenthsCm: cm(710) },
        }),
      ),
    ).toBe(false);
    expect(
      passesHardFilters(
        baseBrief,
        listing({
          measurements: { ...baseListing.measurements, hipsTenthsCm: cm(1_110) },
        }),
      ),
    ).toBe(false);
  });

  it("accepts an active, available, compatible listing on all hard-filter boundaries", () => {
    expect(
      passesHardFilters(
        baseBrief,
        listing({
          rentalPriceCents: 10_000,
          distanceMiles: 8,
          measurements: {
            bustTenthsCm: cm(920),
            waistTenthsCm: cm(820),
            hipsTenthsCm: cm(1_040),
            lengthTenthsCm: cm(1_200),
          },
        }),
      ),
    ).toBe(true);
  });
});

describe("normalized component formulas", () => {
  it("scores measurement proximity to 6 cm ease", () => {
    expect(measurementScore(baseBrief, baseListing)).toBe(1);
    expect(
      measurementScore(
        baseBrief,
        listing({
          measurements: {
            bustTenthsCm: cm(930),
            waistTenthsCm: cm(760),
            hipsTenthsCm: cm(1_070),
            lengthTenthsCm: cm(1_200),
          },
        }),
      ),
    ).toBeCloseTo(2 / 3);
  });

  it("combines dress coverage at 70% and the exact event tag at 30%", () => {
    expect(tagScore(baseBrief, baseListing).eventDress).toBe(1);
    expect(
      tagScore(baseBrief, listing({ styleTags: ["formal", "wedding_guest"] })).eventDress,
    ).toBeCloseTo(0.65);
    expect(tagScore(baseBrief, listing({ styleTags: ["unknown_tag"] })).eventDress).toBe(0);
  });

  it("averages color and style preference coverage and defaults an empty list to one", () => {
    expect(
      tagScore(
        { ...baseBrief, preferredColors: [], styleTags: ["minimal", "polished"] },
        listing({ colorTags: [], styleTags: ["minimal"] }),
      ).styleColor,
    ).toBe(0.75);
  });

  it("normalizes price and distance to their configured bounds", () => {
    expect(priceScore(baseBrief, listing({ rentalPriceCents: 5_000 }))).toBe(1);
    expect(priceScore(baseBrief, listing({ rentalPriceCents: 7_500 }))).toBe(0.5);
    expect(priceScore(baseBrief, listing({ rentalPriceCents: 10_000 }))).toBe(0);
    expect(distanceScore(baseBrief, listing({ distanceMiles: 4 }))).toBe(0.5);
  });
});

describe("rankMatches", () => {
  it("locks the six basis-point weights and total", () => {
    const match = rankMatches({ brief: baseBrief, listings: [baseListing] })[0]!;

    expect(match.breakdown).toEqual({
      measurement: 3_500,
      eventDress: 2_500,
      styleColor: 1_500,
      price: 1_000,
      reliability: 1_000,
      distance: 500,
    });
    expect(match.score).toBe(10_000);
  });

  it("uses stable listing-ID order for ties and returns at most three results", () => {
    const ids = ["e", "b", "d", "a", "c"];
    const results = rankMatches({
      brief: baseBrief,
      listings: ids.map((listingId) => listing({ listingId })),
    });

    expect(results.map((result) => result.listingId)).toEqual(["a", "b", "c"]);
  });

  it("orders explanations from measurement evidence through price evidence without fit claims", () => {
    const match = rankMatches({
      brief: baseBrief,
      listings: [
        listing({
          rentalPriceCents: 8_200,
          measurements: {
            bustTenthsCm: cm(940),
            waistTenthsCm: cm(760),
            hipsTenthsCm: cm(1_060),
            lengthTenthsCm: cm(1_200),
          },
        }),
      ],
    })[0]!;

    expect(match.explanations.slice(0, 3)).toEqual([
      "Measurements allow 4-8 cm ease",
      "Matches formal dress code",
      "$18 below your maximum",
    ]);
    expect(match.explanations.join(" ").toLowerCase()).not.toContain("perfect fit");
    expect(match.explanations.join(" ").toLowerCase()).not.toContain("body type");
  });

  it("keeps scores bounded and output invariant for 100 generated candidates", () => {
    const generated = Array.from({ length: 100 }, (_, index) =>
      listing({
        listingId: `listing-${String(index).padStart(3, "0")}`,
        rentalPriceCents: 5_000 + ((index * 137) % 5_001),
        distanceMiles: (index * 0.079) % 8,
        reliabilityBasisPoints: (index * 997) % 10_001,
        measurements: {
          bustTenthsCm: cm(920 + ((index * 7) % 101)),
          waistTenthsCm: cm(720 + ((index * 11) % 101)),
          hipsTenthsCm: cm(1_000 + ((index * 13) % 101)),
          lengthTenthsCm: cm(1_100 + index),
        },
      }),
    );

    const forward = rankMatches({ brief: baseBrief, listings: generated });
    const reversed = rankMatches({ brief: baseBrief, listings: [...generated].reverse() });

    expect(forward).toHaveLength(3);
    expect(forward.map(({ listingId }) => listingId)).toEqual(
      reversed.map(({ listingId }) => listingId),
    );
    for (const result of forward) {
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(10_000);
    }
  });

  it("never increases the reliability component when reliability is lowered", () => {
    for (let index = 0; index < 100; index += 1) {
      const high = 10_000 - index;
      const low = Math.max(0, high - 1_000);
      const higherMatch = rankMatches({
        brief: baseBrief,
        listings: [listing({ reliabilityBasisPoints: high })],
      })[0]!;
      const lowerMatch = rankMatches({
        brief: baseBrief,
        listings: [listing({ reliabilityBasisPoints: low })],
      })[0]!;

      expect(lowerMatch.breakdown.reliability).toBeLessThanOrEqual(
        higherMatch.breakdown.reliability,
      );
    }
  });
});
