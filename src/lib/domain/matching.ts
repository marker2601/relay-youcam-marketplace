import type {
  DressCode,
  EventType,
  GarmentCategory,
  MeasurementProfile,
  MoneyCents,
  TenthsCm,
} from "@/lib/domain/contracts";

export interface MatchBrief {
  eventType: EventType;
  eventWindow: DateRange;
  dressCode: DressCode;
  garmentCategory: GarmentCategory;
  budgetMinCents: MoneyCents;
  budgetMaxCents: MoneyCents;
  measurementProfile: MeasurementProfile;
  radiusMiles: number;
  preferredColors: string[];
  styleTags: string[];
}

export interface DateRange {
  startDate: string;
  endDate: string;
}

export interface MatchListing {
  listingId: string;
  status: "active" | "inactive";
  garmentCategory: GarmentCategory;
  measurements: Partial<{
    bustTenthsCm: TenthsCm;
    waistTenthsCm: TenthsCm;
    hipsTenthsCm: TenthsCm;
    lengthTenthsCm: TenthsCm;
  }>;
  unavailableRanges: DateRange[];
  rentalPriceCents: MoneyCents;
  serviceRadiusMiles: number;
  distanceMiles: number;
  colorTags: string[];
  styleTags: string[];
  reliabilityBasisPoints: number;
}

export interface ScoreBreakdown {
  measurement: number;
  eventDress: number;
  styleColor: number;
  price: number;
  reliability: number;
  distance: number;
}

export interface RankedMatch {
  listingId: string;
  score: number;
  breakdown: ScoreBreakdown;
  explanations: string[];
}

export interface MatchInput {
  brief: MatchBrief;
  listings: MatchListing[];
}

const weights = {
  measurement: 3_500,
  eventDress: 2_500,
  styleColor: 1_500,
  price: 1_000,
  reliability: 1_000,
  distance: 500,
} as const;

const compatibleDressTags: Record<DressCode, readonly string[]> = {
  cocktail: ["cocktail", "polished"],
  formal: ["formal", "black_tie"],
  semi_formal: ["semi_formal", "polished"],
  festive: ["festive", "statement"],
};

const eventTags: Record<EventType, string> = {
  wedding_guest: "wedding_guest",
  cocktail_party: "cocktail_party",
  gala: "gala",
  holiday_party: "holiday_party",
};

type CircumferenceKey = "bustTenthsCm" | "waistTenthsCm" | "hipsTenthsCm";
type MeasurementKey = CircumferenceKey | "lengthTenthsCm";

const circumferenceKeys: Record<GarmentCategory, readonly CircumferenceKey[]> = {
  upper_body: ["bustTenthsCm", "waistTenthsCm"],
  lower_body: ["waistTenthsCm", "hipsTenthsCm"],
  full_body: ["bustTenthsCm", "waistTenthsCm", "hipsTenthsCm"],
};

const requiredMeasurementKeys: Record<GarmentCategory, readonly MeasurementKey[]> = {
  upper_body: ["bustTenthsCm", "waistTenthsCm", "lengthTenthsCm"],
  lower_body: ["waistTenthsCm", "hipsTenthsCm", "lengthTenthsCm"],
  full_body: ["bustTenthsCm", "waistTenthsCm", "hipsTenthsCm", "lengthTenthsCm"],
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function rangesOverlap(left: DateRange, right: DateRange): boolean {
  return left.startDate <= right.endDate && right.startDate <= left.endDate;
}

function preferenceCoverage(preferences: readonly string[], candidateTags: readonly string[]): number {
  if (preferences.length === 0) {
    return 1;
  }

  const available = new Set(candidateTags);
  return preferences.filter((tag) => available.has(tag)).length / preferences.length;
}

function bodyMeasurement(brief: MatchBrief, key: CircumferenceKey): TenthsCm {
  return brief.measurementProfile[key];
}

function compatibleEaseValues(brief: MatchBrief, listing: MatchListing): number[] | null {
  const keys = circumferenceKeys[brief.garmentCategory];
  const easeValues: number[] = [];

  for (const key of keys) {
    const garmentValue = listing.measurements[key];
    if (garmentValue === undefined) {
      return null;
    }

    easeValues.push(garmentValue - bodyMeasurement(brief, key));
  }

  return easeValues;
}

export function passesHardFilters(brief: MatchBrief, listing: MatchListing): boolean {
  if (listing.status !== "active" || listing.garmentCategory !== brief.garmentCategory) {
    return false;
  }
  if (listing.rentalPriceCents > brief.budgetMaxCents) {
    return false;
  }

  const effectiveRadius = Math.min(brief.radiusMiles, listing.serviceRadiusMiles);
  if (effectiveRadius <= 0 || listing.distanceMiles < 0 || listing.distanceMiles > effectiveRadius) {
    return false;
  }
  if (listing.unavailableRanges.some((range) => rangesOverlap(brief.eventWindow, range))) {
    return false;
  }
  if (
    requiredMeasurementKeys[brief.garmentCategory].some(
      (key) => listing.measurements[key] === undefined,
    )
  ) {
    return false;
  }

  const easeValues = compatibleEaseValues(brief, listing);
  return easeValues !== null && easeValues.every((ease) => ease >= 20 && ease <= 120);
}

export function measurementScore(brief: MatchBrief, listing: MatchListing): number {
  const easeValues = compatibleEaseValues(brief, listing);
  if (!easeValues || easeValues.length === 0) {
    return 0;
  }

  return (
    easeValues.reduce((sum, ease) => sum + clamp01(1 - Math.abs(ease - 60) / 60), 0) /
    easeValues.length
  );
}

export function tagScore(
  brief: MatchBrief,
  listing: MatchListing,
): { eventDress: number; styleColor: number } {
  const dressCoverage = preferenceCoverage(compatibleDressTags[brief.dressCode], listing.styleTags);
  const eventCoverage = listing.styleTags.includes(eventTags[brief.eventType]) ? 1 : 0;
  const colorCoverage = preferenceCoverage(brief.preferredColors, listing.colorTags);
  const styleCoverage = preferenceCoverage(brief.styleTags, listing.styleTags);

  return {
    eventDress: 0.7 * dressCoverage + 0.3 * eventCoverage,
    styleColor: (colorCoverage + styleCoverage) / 2,
  };
}

export function priceScore(brief: MatchBrief, listing: MatchListing): number {
  const budgetRange = Math.max(1, brief.budgetMaxCents - brief.budgetMinCents);
  return clamp01(1 - (listing.rentalPriceCents - brief.budgetMinCents) / budgetRange);
}

export function distanceScore(brief: MatchBrief, listing: MatchListing): number {
  const effectiveRadius = Math.min(brief.radiusMiles, listing.serviceRadiusMiles);
  if (effectiveRadius <= 0) {
    return 0;
  }

  return clamp01(1 - listing.distanceMiles / effectiveRadius);
}

function weightedScore(value: number, maximum: number): number {
  return Math.round(clamp01(value) * maximum);
}

function formatCentimeters(tenthsCm: number): string {
  const centimeters = tenthsCm / 10;
  return Number.isInteger(centimeters) ? String(centimeters) : centimeters.toFixed(1);
}

function formatMoney(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

function buildExplanations(brief: MatchBrief, listing: MatchListing): string[] {
  const explanations: string[] = [];
  const easeValues = compatibleEaseValues(brief, listing) ?? [];

  if (easeValues.length > 0) {
    const minimumEase = Math.min(...easeValues);
    const maximumEase = Math.max(...easeValues);
    explanations.push(
      `Measurements allow ${formatCentimeters(minimumEase)}-${formatCentimeters(maximumEase)} cm ease`,
    );
  }

  if (compatibleDressTags[brief.dressCode].some((tag) => listing.styleTags.includes(tag))) {
    explanations.push(`Matches ${brief.dressCode.replaceAll("_", " ")} dress code`);
  }

  const belowMaximum = brief.budgetMaxCents - listing.rentalPriceCents;
  if (belowMaximum > 0) {
    explanations.push(`${formatMoney(belowMaximum)} below your maximum`);
  } else {
    explanations.push("At your maximum budget");
  }

  return explanations;
}

function scoreListing(brief: MatchBrief, listing: MatchListing): RankedMatch {
  const tags = tagScore(brief, listing);
  const breakdown: ScoreBreakdown = {
    measurement: weightedScore(measurementScore(brief, listing), weights.measurement),
    eventDress: weightedScore(tags.eventDress, weights.eventDress),
    styleColor: weightedScore(tags.styleColor, weights.styleColor),
    price: weightedScore(priceScore(brief, listing), weights.price),
    reliability: weightedScore(listing.reliabilityBasisPoints / 10_000, weights.reliability),
    distance: weightedScore(distanceScore(brief, listing), weights.distance),
  };

  return {
    listingId: listing.listingId,
    score: Object.values(breakdown).reduce((total, component) => total + component, 0),
    breakdown,
    explanations: buildExplanations(brief, listing),
  };
}

export function rankMatches(input: MatchInput): RankedMatch[] {
  return input.listings
    .filter((listing) => passesHardFilters(input.brief, listing))
    .map((listing) => scoreListing(input.brief, listing))
    .sort((left, right) => right.score - left.score || left.listingId.localeCompare(right.listingId))
    .slice(0, 3);
}
