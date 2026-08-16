import { z } from "zod";

import type { TenthsCm } from "@/lib/domain/contracts";
import { chicagoDateForInstant, classifyEventUrgency } from "@/lib/domain/assurance";

const tagSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, "Use lowercase snake_case tags");
const centsSchema = z.number().int().nonnegative();
const tenthsCmSchema = z
  .number()
  .int()
  .positive()
  .transform((value) => value as TenthsCm);
const dateSchema = z.iso.date();
const dateTimeSchema = z.iso.datetime({ offset: true });

const eventTypeSchema = z.enum([
  "wedding_guest",
  "cocktail_party",
  "gala",
  "holiday_party",
]);
const dressCodeSchema = z.enum(["cocktail", "formal", "semi_formal", "festive"]);
const garmentCategorySchema = z.enum(["upper_body", "lower_body", "full_body"]);
const conditionSchema = z.enum(["excellent", "good", "fair"]);
const providerTypeSchema = z.enum(["peer", "boutique"]);
const briefStatusSchema = z.enum([
  "matching",
  "active",
  "no_matches",
  "deleting",
  "deleted",
]);
const offerStatusSchema = z.enum([
  "matched",
  "generating",
  "ready",
  "failed",
  "reservation_requested",
  "accepted",
  "declined",
  "expired",
]);
const reservationStatusSchema = z.enum([
  "requested",
  "confirmed",
  "ready_for_pickup",
  "in_use",
  "returned",
  "cancelled",
]);
const assuranceRoleSchema = z.enum(["primary", "backup", "alternative"]);
const eventUrgencySchema = z.enum(["tonight", "tomorrow", "this_week", "planned"]);
const readinessBreakdownSchema = z.strictObject({
  availability: z.number().int().min(0).max(35),
  measurements: z.number().int().min(0).max(25),
  proximity: z.number().int().min(0).max(20),
  style: z.number().int().min(0).max(10),
  confirmation: z.number().int().min(0).max(10),
  total: z.number().int().min(0).max(100),
});

const measurementProfileSchema = z.strictObject({
  bustTenthsCm: tenthsCmSchema,
  waistTenthsCm: tenthsCmSchema,
  hipsTenthsCm: tenthsCmSchema,
  desiredEaseMinTenthsCm: tenthsCmSchema,
  desiredEaseMaxTenthsCm: tenthsCmSchema,
});

const garmentMeasurementsSchema = z.strictObject({
  bustTenthsCm: tenthsCmSchema,
  waistTenthsCm: tenthsCmSchema,
  hipsTenthsCm: tenthsCmSchema,
  lengthTenthsCm: tenthsCmSchema,
});

function todayInChicago(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export const createBriefCommandSchema = z
  .strictObject({
    eventType: eventTypeSchema,
    eventDate: dateSchema.refine((value) => value >= todayInChicago(), "Event date cannot be past"),
    eventStartsAt: dateTimeSchema,
    dressCode: dressCodeSchema,
    budgetMinCents: centsSchema,
    budgetMaxCents: centsSchema,
    garmentCategory: garmentCategorySchema,
    sizeLabel: z.string().trim().min(1).max(20),
    measurementProfile: measurementProfileSchema,
    locationBand: z.enum(["loop", "west", "north"]),
    radiusMiles: z.number().int().min(1).max(100),
    preferredColors: z.array(tagSchema).max(10),
    styleTags: z.array(tagSchema).min(1).max(10),
    exclusions: z.array(tagSchema).max(10).default([]),
    photoConsent: z.literal(true),
  })
  .superRefine((value, context) => {
    const eventStartsAt = new Date(value.eventStartsAt);
    if (chicagoDateForInstant(eventStartsAt) !== value.eventDate) {
      context.addIssue({
        code: "custom",
        path: ["eventDate"],
        message: "Event date must match the event time in America/Chicago",
      });
    }
    try {
      classifyEventUrgency(eventStartsAt, new Date());
    } catch (error) {
      if (error instanceof RangeError) {
        context.addIssue({
          code: "custom",
          path: ["eventStartsAt"],
          message: error.message,
        });
      }
    }
    if (value.budgetMinCents > value.budgetMaxCents) {
      context.addIssue({
        code: "custom",
        path: ["budgetMinCents"],
        message: "Minimum budget cannot exceed maximum budget",
      });
    }
    if (
      value.measurementProfile.desiredEaseMinTenthsCm >
      value.measurementProfile.desiredEaseMaxTenthsCm
    ) {
      context.addIssue({
        code: "custom",
        path: ["measurementProfile", "desiredEaseMinTenthsCm"],
        message: "Minimum ease cannot exceed maximum ease",
      });
    }
  });

const unavailableRangeSchema = z
  .strictObject({
    startDate: dateSchema,
    endDate: dateSchema,
  })
  .refine((value) => value.startDate <= value.endDate, {
    path: ["endDate"],
    message: "Unavailable range end must be on or after its start",
  });

export const createListingCommandSchema = z.strictObject({
  title: z.string().trim().min(3).max(100),
  garmentCategory: garmentCategorySchema,
  sizeLabel: z.string().trim().min(1).max(20),
  measurements: garmentMeasurementsSchema,
  condition: conditionSchema,
  colorTags: z.array(tagSchema).min(1).max(10),
  styleTags: z.array(tagSchema).min(1).max(10),
  rentalPriceCents: centsSchema.positive(),
  depositDisplayCents: centsSchema,
  serviceRadiusMiles: z.number().int().min(1).max(100),
  locationBand: z.enum(["loop", "west", "north"]),
  unavailableRanges: z.array(unavailableRangeSchema).max(50),
});

export const requestReservationCommandSchema = z.strictObject({
  offerId: z.uuid(),
  idempotencyKey: z.string().trim().min(8).max(128),
});

export const acceptReservationCommandSchema = z.strictObject({
  reservationId: z.uuid(),
  idempotencyKey: z.string().trim().min(8).max(128),
});

export const activateBackupCommandSchema = z.strictObject({
  reservationId: z.uuid(),
  idempotencyKey: z.string().trim().min(8).max(128),
});

export const offerSnapshotItemSchema = z.strictObject({
  id: z.uuid(),
  listingId: z.uuid(),
  status: offerStatusSchema,
  assuranceRole: assuranceRoleSchema,
  title: z.string().min(1),
  garmentCategory: garmentCategorySchema,
  sizeLabel: z.string().min(1),
  measurements: garmentMeasurementsSchema,
  condition: conditionSchema,
  rentalPriceCents: centsSchema,
  depositDisplayCents: centsSchema,
  provider: z.strictObject({
    id: z.uuid(),
    displayName: z.string().min(1),
    providerType: providerTypeSchema,
  }),
  distanceBand: z.string().min(1),
  pickupMethod: z.string().min(1),
  scoreBasisPoints: z.number().int().min(0).max(10_000),
  explanations: z.array(z.string().min(1)).min(1),
  readiness: readinessBreakdownSchema,
  originalImageUrl: z.url(),
  resultImageUrl: z.url().nullable(),
  failureGuidance: z.enum(["listing_image", "preview"]).nullable(),
  expiresAt: dateTimeSchema,
});

export const offerSnapshotSchema = z.strictObject({
  briefId: z.uuid(),
  reservationId: z.uuid().nullable(),
  matchingRevision: z.number().int().positive(),
  briefStatus: briefStatusSchema,
  eventStartsAt: dateTimeSchema,
  urgency: eventUrgencySchema,
  assuranceCoverage: z.enum(["primary_and_backup", "primary_only"]),
  sourcePhotoNeedsReplacement: z.boolean(),
  offers: z.array(offerSnapshotItemSchema).max(3),
});

export const offerCardSchema = z.strictObject({
  id: z.uuid(),
  briefId: z.uuid(),
  listingId: z.uuid(),
  status: offerStatusSchema,
  title: z.string().min(1),
  garmentCategory: garmentCategorySchema,
  sizeLabel: z.string().min(1),
  measurements: garmentMeasurementsSchema,
  condition: conditionSchema,
  rentalPriceCents: centsSchema,
  depositDisplayCents: centsSchema,
  provider: z.strictObject({
    id: z.uuid(),
    displayName: z.string().min(1),
    providerType: providerTypeSchema,
  }),
  distanceBand: z.string().min(1),
  pickupMethod: z.string().min(1),
  scoreBasisPoints: z.number().int().min(0).max(10_000),
  explanations: z.array(z.string().min(1)).min(1),
  originalImageUrl: z.url(),
  resultImageUrl: z.url().nullable(),
  expiresAt: dateTimeSchema,
  assuranceRole: assuranceRoleSchema,
  eventStartsAt: dateTimeSchema,
  urgency: eventUrgencySchema,
  readiness: readinessBreakdownSchema,
  responseDueAt: dateTimeSchema.nullable(),
});

export const providerRequestSchema = z.strictObject({
  id: z.uuid(),
  reservationId: z.uuid(),
  status: z.enum(["reservation_requested", "accepted", "declined", "expired"]),
  offerStatus: offerStatusSchema,
  assuranceRole: assuranceRoleSchema,
  eventType: eventTypeSchema,
  eventDate: dateSchema,
  eventStartsAt: dateTimeSchema,
  urgency: eventUrgencySchema,
  dressCode: dressCodeSchema,
  sizeLabel: z.string().min(1),
  listingId: z.uuid(),
  listingTitle: z.string().min(1),
  rentalPriceCents: centsSchema,
  pickupDate: dateTimeSchema,
  returnDate: dateTimeSchema,
  responseDueAt: dateTimeSchema,
  hasBackup: z.boolean(),
});

export const reservationDetailSchema = z.strictObject({
  id: z.uuid(),
  offerId: z.uuid(),
  offerStatus: offerStatusSchema,
  assuranceRole: assuranceRoleSchema,
  status: reservationStatusSchema,
  garmentTitle: z.string().min(1),
  providerDisplayName: z.string().min(1),
  providerType: providerTypeSchema,
  eventDate: dateSchema,
  eventStartsAt: dateTimeSchema,
  urgency: eventUrgencySchema,
  pickupDate: dateTimeSchema,
  returnDate: dateTimeSchema,
  rentalPriceCents: centsSchema,
  depositDisplayCents: centsSchema,
  responseDueAt: dateTimeSchema,
  backupOfferId: z.uuid().nullable(),
  backup: z.strictObject({
    offerId: z.uuid(),
    title: z.string().min(1),
    providerDisplayName: z.string().min(1),
  }).nullable(),
  canActivateBackup: z.boolean(),
  supersedesReservationId: z.uuid().nullable(),
  simulation: z.literal(true),
});

export type CreateBriefCommand = z.infer<typeof createBriefCommandSchema>;
export type CreateListingCommand = z.infer<typeof createListingCommandSchema>;
export type RequestReservationCommand = z.infer<typeof requestReservationCommandSchema>;
export type AcceptReservationCommand = z.infer<typeof acceptReservationCommandSchema>;
export type ActivateBackupCommand = z.infer<typeof activateBackupCommandSchema>;
export type OfferSnapshotResponse = z.infer<typeof offerSnapshotSchema>;
export type OfferCardResponse = z.infer<typeof offerCardSchema>;
export type ProviderReservationRequest = z.infer<typeof providerRequestSchema>;
export type ReservationDetail = z.infer<typeof reservationDetailSchema>;
export type ProviderRequestResponse = ProviderReservationRequest;
export type ReservationDetailResponse = ReservationDetail;
