/** Measurements cross domain boundaries as integer tenths of one centimeter. */
import type {
  AssuranceCoverage,
  AssuranceRole,
  EventUrgency,
  ReadinessBreakdown,
} from "./assurance";

export type {
  AssuranceCoverage,
  AssuranceRole,
  EventUrgency,
  ReadinessBreakdown,
} from "./assurance";

export type TenthsCm = number & { readonly __unit: "tenths_cm" };
export type MoneyCents = number;

export type DemoRole = "shopper" | "provider";
export type ProviderType = "peer" | "boutique";
export type EventType = "wedding_guest" | "cocktail_party" | "gala" | "holiday_party";
export type DressCode = "cocktail" | "formal" | "semi_formal" | "festive";
export type GarmentCategory = "upper_body" | "lower_body" | "full_body";
export type GarmentCondition = "excellent" | "good" | "fair";

export type OfferStatus =
  | "matched"
  | "generating"
  | "ready"
  | "failed"
  | "reservation_requested"
  | "accepted"
  | "declined"
  | "expired";

export type ReservationStatus =
  | "requested"
  | "confirmed"
  | "ready_for_pickup"
  | "in_use"
  | "returned"
  | "cancelled";

export type TryOnJobStatus = "queued" | "uploading" | "processing" | "succeeded" | "failed";

export interface MeasurementProfile {
  bustTenthsCm: TenthsCm;
  waistTenthsCm: TenthsCm;
  hipsTenthsCm: TenthsCm;
  desiredEaseMinTenthsCm: TenthsCm;
  desiredEaseMaxTenthsCm: TenthsCm;
}

export interface GarmentMeasurements {
  bustTenthsCm: TenthsCm;
  waistTenthsCm: TenthsCm;
  hipsTenthsCm: TenthsCm;
  lengthTenthsCm: TenthsCm;
}

export interface OfferCard {
  id: string;
  briefId: string;
  listingId: string;
  status: OfferStatus;
  title: string;
  garmentCategory: GarmentCategory;
  sizeLabel: string;
  measurements: GarmentMeasurements;
  condition: GarmentCondition;
  rentalPriceCents: MoneyCents;
  depositDisplayCents: MoneyCents;
  provider: {
    id: string;
    displayName: string;
    providerType: ProviderType;
  };
  distanceBand: string;
  pickupMethod: string;
  scoreBasisPoints: number;
  explanations: string[];
  originalImageUrl: string;
  resultImageUrl: string | null;
  expiresAt: string;
  assuranceRole: AssuranceRole;
  eventStartsAt: string;
  urgency: EventUrgency;
  readiness: ReadinessBreakdown;
  responseDueAt: string | null;
}

export interface ProviderRequest {
  id: string;
  reservationId: string | null;
  status: OfferStatus;
  eventType: EventType;
  eventDate: string;
  dressCode: DressCode;
  sizeLabel: string;
  listingId: string;
  listingTitle: string;
  rentalPriceCents: MoneyCents;
  pickupDate: string;
  returnDate: string;
  assuranceRole: AssuranceRole;
  eventStartsAt: string;
  urgency: EventUrgency;
  readiness: ReadinessBreakdown;
  responseDueAt: string | null;
}

export interface ReservationDetail {
  id: string;
  offerId: string;
  status: ReservationStatus;
  garmentTitle: string;
  providerDisplayName: string;
  providerType: ProviderType;
  eventDate: string;
  pickupDate: string;
  returnDate: string;
  rentalPriceCents: MoneyCents;
  depositDisplayCents: MoneyCents;
  simulation: true;
  assuranceRole: AssuranceRole;
  eventStartsAt: string;
  urgency: EventUrgency;
  readiness: ReadinessBreakdown;
  responseDueAt: string | null;
}

export interface BriefDetail {
  id: string;
  eventType: EventType;
  eventDate: string;
  dressCode: DressCode;
  garmentCategory: GarmentCategory;
  sizeLabel: string;
  budgetMinCents: MoneyCents;
  budgetMaxCents: MoneyCents;
  matchingRevision: number;
}
