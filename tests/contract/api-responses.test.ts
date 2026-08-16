import { describe, expect, it } from "vitest";

import type {
  OfferCard,
  TenthsCm,
} from "@/lib/domain/contracts";
import {
  offerCardSchema,
  offerSnapshotSchema,
  providerRequestSchema,
  reservationDetailSchema,
  type ProviderReservationRequest,
  type ReservationDetail,
} from "@/lib/domain/schemas";
import {
  ConflictHttpError,
  NotFoundHttpError,
  PayloadTooLargeHttpError,
  RateLimitedHttpError,
  UnauthenticatedHttpError,
  ValidationHttpError,
  toHttpErrorResponse,
} from "@/lib/http/errors";

const ids = {
  brief: "10000000-0000-4000-8000-000000000001",
  offer: "10000000-0000-4000-8000-000000000002",
  listing: "10000000-0000-4000-8000-000000000003",
  provider: "10000000-0000-4000-8000-000000000004",
  reservation: "10000000-0000-4000-8000-000000000005",
  backupOffer: "10000000-0000-4000-8000-000000000006",
} as const;

const cm = (value: number) => value as TenthsCm;

const offer = {
  id: ids.offer,
  briefId: ids.brief,
  listingId: ids.listing,
  status: "ready",
  title: "Emerald satin midi",
  garmentCategory: "full_body",
  sizeLabel: "M",
  measurements: {
    bustTenthsCm: cm(960),
    waistTenthsCm: cm(780),
    hipsTenthsCm: cm(1_040),
    lengthTenthsCm: cm(1_180),
  },
  condition: "excellent",
  rentalPriceCents: 7_800,
  depositDisplayCents: 4_000,
  provider: {
    id: ids.provider,
    displayName: "West Loop Wardrobe",
    providerType: "boutique",
  },
  distanceBand: "3–5 miles",
  pickupMethod: "Local pickup",
  scoreBasisPoints: 8_725,
  explanations: ["Measurements allow 4–8 cm ease", "Matches formal dress code"],
  originalImageUrl: "https://media.relay.test/original?signature=signed",
  resultImageUrl: "https://media.relay.test/result?signature=signed",
  expiresAt: "2099-06-10T18:00:00.000Z",
  assuranceRole: "primary",
  eventStartsAt: "2099-06-12T00:00:00.000Z",
  urgency: "planned",
  readiness: {
    availability: 35,
    measurements: 25,
    proximity: 20,
    style: 10,
    confirmation: 10,
    total: 100,
  },
  responseDueAt: "2099-06-10T22:00:00.000Z",
} satisfies OfferCard;

const offerSnapshot = {
  briefId: ids.brief,
  reservationId: null,
  matchingRevision: 1,
  briefStatus: "active",
  eventStartsAt: "2099-06-12T00:00:00.000Z",
  urgency: "planned",
  assuranceCoverage: "primary_and_backup",
  sourcePhotoNeedsReplacement: false,
  offers: [
    {
      id: ids.offer,
      listingId: ids.listing,
      status: "ready",
      assuranceRole: "primary",
      title: "Emerald satin midi",
      garmentCategory: "full_body",
      sizeLabel: "M",
      measurements: {
        bustTenthsCm: cm(960),
        waistTenthsCm: cm(780),
        hipsTenthsCm: cm(1_040),
        lengthTenthsCm: cm(1_180),
      },
      condition: "excellent",
      rentalPriceCents: 7_800,
      depositDisplayCents: 4_000,
      provider: {
        id: ids.provider,
        displayName: "West Loop Wardrobe",
        providerType: "boutique",
      },
      distanceBand: "west Chicago",
      pickupMethod: "Local pickup",
      scoreBasisPoints: 8_725,
      explanations: ["Measurements allow 4â€“8 cm ease", "Matches formal dress code"],
      readiness: {
        availability: 35,
        measurements: 25,
        proximity: 20,
        style: 10,
        confirmation: 10,
        total: 100,
      },
      originalImageUrl: "https://media.relay.test/original?signature=signed",
      resultImageUrl: "https://media.relay.test/result?signature=signed",
      failureGuidance: null,
      expiresAt: "2099-06-10T18:00:00.000Z",
    },
  ],
};

describe("public API response contracts", () => {
  it("parses the complete authorized offer snapshot projection", () => {
    expect(offerSnapshotSchema.parse(offerSnapshot)).toEqual(offerSnapshot);
  });

  it("rejects missing and extra assurance-readiness snapshot fields", () => {
    const { assuranceCoverage: _assuranceCoverage, ...withoutCoverage } = offerSnapshot;
    const { assuranceRole: _assuranceRole, ...withoutRole } = offerSnapshot.offers[0]!;
    const { readiness: _readiness, ...withoutReadiness } = offerSnapshot.offers[0]!;

    expect(offerSnapshotSchema.safeParse(withoutCoverage).success).toBe(false);
    expect(
      offerSnapshotSchema.safeParse({ ...offerSnapshot, reservationId: undefined }).success,
    ).toBe(false);
    expect(
      offerSnapshotSchema.safeParse({ ...offerSnapshot, hiddenAssuranceState: "unreviewed" })
        .success,
    ).toBe(false);
    expect(
      offerSnapshotSchema.safeParse({ ...offerSnapshot, offers: [withoutRole] }).success,
    ).toBe(false);
    expect(
      offerSnapshotSchema.safeParse({ ...offerSnapshot, offers: [withoutReadiness] }).success,
    ).toBe(false);
    expect(
      offerSnapshotSchema.safeParse({
        ...offerSnapshot,
        offers: [
          {
            ...offerSnapshot.offers[0]!,
            readiness: { ...offerSnapshot.offers[0]!.readiness, internalScore: 100 },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("serializes signed offer image URLs without private object keys", () => {
    const parsed = offerCardSchema.parse(offer);

    expect(parsed.resultImageUrl).toContain("signature=");
    expect(parsed).not.toHaveProperty("resultImageKey");
    expect(parsed).not.toHaveProperty("originalImageKey");
  });

  it("rejects an offer response containing a private object key", () => {
    expect(
      offerCardSchema.safeParse({ ...offer, resultImageKey: "jobs/private/result.jpg" }).success,
    ).toBe(false);
  });

  it("keeps the provider request free of shopper media and measurements", () => {
    const request = {
      id: ids.offer,
      reservationId: ids.reservation,
      status: "reservation_requested",
      offerStatus: "reservation_requested",
      assuranceRole: "primary",
      eventType: "wedding_guest",
      eventDate: "2099-06-12",
      eventStartsAt: "2099-06-12T00:00:00.000Z",
      urgency: "planned",
      dressCode: "formal",
      sizeLabel: "M",
      listingId: ids.listing,
      listingTitle: "Emerald satin midi",
      rentalPriceCents: 7_800,
      pickupDate: "2099-06-11T05:00:00.000Z",
      returnDate: "2099-06-14T05:00:00.000Z",
      responseDueAt: "2099-06-10T22:00:00.000Z",
      hasBackup: true,
    } satisfies ProviderReservationRequest;

    const parsed = providerRequestSchema.parse(request);
    expect(parsed).not.toHaveProperty("shopperMediaId");
    expect(parsed).not.toHaveProperty("measurementProfile");
  });

  it("marks reservation detail as a simulation", () => {
    const reservation = {
      id: ids.reservation,
      offerId: ids.offer,
      offerStatus: "accepted",
      assuranceRole: "primary",
      status: "confirmed",
      garmentTitle: "Emerald satin midi",
      providerDisplayName: "West Loop Wardrobe",
      providerType: "boutique",
      eventDate: "2099-06-12",
      eventStartsAt: "2099-06-12T00:00:00.000Z",
      urgency: "planned",
      pickupDate: "2099-06-11T05:00:00.000Z",
      returnDate: "2099-06-14T05:00:00.000Z",
      rentalPriceCents: 7_800,
      depositDisplayCents: 4_000,
      responseDueAt: "2099-06-10T22:00:00.000Z",
      backupOfferId: ids.backupOffer,
      backup: {
        offerId: ids.backupOffer,
        title: "Midnight tailored jumpsuit",
        providerDisplayName: "Jordan Lee",
      },
      canActivateBackup: false,
      supersedesReservationId: null,
      simulation: true,
    } satisfies ReservationDetail;

    const parsed = reservationDetailSchema.parse(reservation);
    expect(parsed.simulation).toBe(true);
    expect(parsed.backup?.offerId).toBe(ids.backupOffer);
  });

  it.each([
    [new ValidationHttpError("invalid_command"), 400, "invalid_command"],
    [new UnauthenticatedHttpError(), 401, "unauthenticated"],
    [new NotFoundHttpError(), 404, "not_found"],
    [new ConflictHttpError("reservation_conflict"), 409, "reservation_conflict"],
    [new PayloadTooLargeHttpError(), 413, "payload_too_large"],
    [new RateLimitedHttpError(), 429, "rate_limited"],
    [new Error("secret upstream body and stack"), 500, "internal_error"],
  ])("maps a safe HTTP error contract", async (error, status, code) => {
    const response = toHttpErrorResponse(error, "request-safe-123");
    expect(response.status).toBe(status);
    expect(response.headers.get("x-request-id")).toBe("request-safe-123");
    const body = await response.json();
    expect(body).toEqual({ code, requestId: "request-safe-123" });
    expect(JSON.stringify(body)).not.toContain("secret upstream body");
    expect(JSON.stringify(body)).not.toContain("stack");
  });
});
