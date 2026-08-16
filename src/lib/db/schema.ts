import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import type { GarmentMeasurements, MeasurementProfile } from "@/lib/domain/contracts";

export const demoRoleEnum = pgEnum("demo_role", ["shopper", "provider"]);
export const providerTypeEnum = pgEnum("provider_type", ["peer", "boutique"]);
export const eventTypeEnum = pgEnum("event_type", [
  "wedding_guest",
  "cocktail_party",
  "gala",
  "holiday_party",
]);
export const dressCodeEnum = pgEnum("dress_code", [
  "cocktail",
  "formal",
  "semi_formal",
  "festive",
]);
export const garmentCategoryEnum = pgEnum("garment_category", [
  "upper_body",
  "lower_body",
  "full_body",
]);
export const garmentConditionEnum = pgEnum("garment_condition", [
  "excellent",
  "good",
  "fair",
]);
export const locationBandEnum = pgEnum("location_band", ["loop", "west", "north"]);
export const briefStatusEnum = pgEnum("brief_status", [
  "matching",
  "active",
  "no_matches",
  "deleting",
  "deleted",
]);
export const listingStatusEnum = pgEnum("listing_status", ["active", "inactive"]);
export const tryOnJobStatusEnum = pgEnum("try_on_job_status", [
  "queued",
  "uploading",
  "processing",
  "succeeded",
  "failed",
]);
export const offerStatusEnum = pgEnum("offer_status", [
  "matched",
  "generating",
  "ready",
  "failed",
  "reservation_requested",
  "accepted",
  "declined",
  "expired",
]);
export const assuranceRoleEnum = pgEnum("assurance_role", [
  "primary",
  "backup",
  "alternative",
]);
export const reservationStatusEnum = pgEnum("reservation_status", [
  "requested",
  "confirmed",
  "ready_for_pickup",
  "in_use",
  "returned",
  "cancelled",
]);
export const mediaKindEnum = pgEnum("media_kind", [
  "brief_source",
  "listing_garment",
  "try_on_result",
]);
export const mediaDeletionStatusEnum = pgEnum("media_deletion_status", [
  "active",
  "deleting",
  "deleted",
  "delete_failed",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    demoRole: demoRoleEnum("demo_role").notNull(),
    displayName: varchar("display_name", { length: 100 }).notNull(),
    providerType: providerTypeEnum("provider_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "users_role_provider_type_check",
      sql`(${table.demoRole} = 'shopper' AND ${table.providerType} IS NULL) OR (${table.demoRole} = 'provider' AND ${table.providerType} IS NOT NULL)`,
    ),
  ],
);

export const mediaObjects = pgTable(
  "media_objects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: mediaKindEnum("kind").notNull(),
    objectKey: text("object_key").notNull().unique(),
    contentType: varchar("content_type", { length: 50 }).notNull(),
    byteSize: integer("byte_size").notNull(),
    briefId: uuid("brief_id"),
    listingId: uuid("listing_id"),
    jobId: uuid("job_id"),
    deletionStatus: mediaDeletionStatusEnum("deletion_status").notNull().default("active"),
    deletionErrorCode: varchar("deletion_error_code", { length: 80 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    check("media_objects_positive_size_check", sql`${table.byteSize} > 0`),
    check(
      "media_objects_one_resource_check",
      sql`num_nonnulls(${table.briefId}, ${table.listingId}, ${table.jobId}) = 1`,
    ),
    index("media_objects_owner_deleted_idx").on(table.ownerUserId, table.deletedAt),
  ],
);

export const eventBriefs = pgTable(
  "event_briefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopperId: uuid("shopper_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventType: eventTypeEnum("event_type").notNull(),
    eventDate: date("event_date", { mode: "string" }).notNull(),
    eventStartsAt: timestamp("event_starts_at", { withTimezone: true }).notNull(),
    dressCode: dressCodeEnum("dress_code").notNull(),
    budgetMinCents: integer("budget_min_cents").notNull(),
    budgetMaxCents: integer("budget_max_cents").notNull(),
    garmentCategory: garmentCategoryEnum("garment_category").notNull(),
    sizeLabel: varchar("size_label", { length: 20 }).notNull(),
    measurementProfile: jsonb("measurement_profile").$type<MeasurementProfile>().notNull(),
    locationBand: locationBandEnum("location_band").notNull(),
    radiusMiles: integer("radius_miles").notNull(),
    preferredColors: jsonb("preferred_colors").$type<string[]>().notNull(),
    styleTags: jsonb("style_tags").$type<string[]>().notNull(),
    exclusions: jsonb("exclusions").$type<string[]>().notNull(),
    shopperMediaId: uuid("shopper_media_id")
      .unique()
      .references(() => mediaObjects.id, { onDelete: "restrict" }),
    photoConsentAt: timestamp("photo_consent_at", { withTimezone: true }).notNull(),
    status: briefStatusEnum("status").notNull().default("matching"),
    matchingRevision: integer("matching_revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("event_briefs_nonnegative_budget_check", sql`${table.budgetMinCents} >= 0`),
    check("event_briefs_budget_order_check", sql`${table.budgetMinCents} <= ${table.budgetMaxCents}`),
    check("event_briefs_radius_check", sql`${table.radiusMiles} BETWEEN 1 AND 100`),
    check("event_briefs_revision_check", sql`${table.matchingRevision} > 0`),
    index("event_briefs_shopper_created_idx").on(table.shopperId, table.createdAt),
  ],
);

export const listings = pgTable(
  "listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 100 }).notNull(),
    garmentCategory: garmentCategoryEnum("garment_category").notNull(),
    sizeLabel: varchar("size_label", { length: 20 }).notNull(),
    measurements: jsonb("measurements").$type<GarmentMeasurements>().notNull(),
    condition: garmentConditionEnum("condition").notNull(),
    colorTags: jsonb("color_tags").$type<string[]>().notNull(),
    styleTags: jsonb("style_tags").$type<string[]>().notNull(),
    rentalPriceCents: integer("rental_price_cents").notNull(),
    depositDisplayCents: integer("deposit_display_cents").notNull(),
    serviceRadiusMiles: integer("service_radius_miles").notNull(),
    locationBand: locationBandEnum("location_band").notNull(),
    garmentMediaId: uuid("garment_media_id")
      .notNull()
      .unique()
      .references(() => mediaObjects.id, { onDelete: "restrict" }),
    unavailableRanges: jsonb("unavailable_ranges")
      .$type<Array<{ startDate: string; endDate: string }>>()
      .notNull(),
    reliabilityBasisPoints: integer("reliability_basis_points").notNull().default(8_000),
    status: listingStatusEnum("status").notNull().default("active"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("listings_nonnegative_rental_price_check", sql`${table.rentalPriceCents} >= 0`),
    check("listings_nonnegative_deposit_check", sql`${table.depositDisplayCents} >= 0`),
    check("listings_service_radius_check", sql`${table.serviceRadiusMiles} BETWEEN 1 AND 100`),
    check(
      "listings_reliability_check",
      sql`${table.reliabilityBasisPoints} BETWEEN 0 AND 10000`,
    ),
    check("listings_version_check", sql`${table.version} > 0`),
    index("listings_status_category_idx").on(table.status, table.garmentCategory),
  ],
);

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    briefId: uuid("brief_id")
      .notNull()
      .references(() => eventBriefs.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    briefRevision: integer("brief_revision").notNull(),
    listingVersion: integer("listing_version").notNull(),
    scoreBasisPoints: integer("score_basis_points").notNull(),
    scoreBreakdown: jsonb("score_breakdown").$type<Record<string, number>>().notNull(),
    explanation: jsonb("explanation").$type<string[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("matches_score_check", sql`${table.scoreBasisPoints} BETWEEN 0 AND 10000`),
    check("matches_brief_revision_check", sql`${table.briefRevision} > 0`),
    check("matches_listing_version_check", sql`${table.listingVersion} > 0`),
    uniqueIndex("matches_brief_revision_listing_version_unique").on(
      table.briefId,
      table.briefRevision,
      table.listingId,
      table.listingVersion,
    ),
  ],
);

export const tryOnJobs = pgTable(
  "try_on_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id")
      .notNull()
      .unique()
      .references(() => matches.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 30 }).notNull().default("youcam"),
    sourceFileId: text("source_file_id"),
    referenceFileId: text("reference_file_id"),
    externalTaskId: text("external_task_id").unique(),
    status: tryOnJobStatusEnum("status").notNull().default("queued"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextPollAt: timestamp("next_poll_at", { withTimezone: true }),
    normalizedErrorCode: varchar("normalized_error_code", { length: 80 }),
    resultMediaId: uuid("result_media_id")
      .unique()
      .references(() => mediaObjects.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    check("try_on_jobs_provider_check", sql`${table.provider} = 'youcam'`),
    check("try_on_jobs_attempt_count_check", sql`${table.attemptCount} >= 0`),
    index("try_on_jobs_status_next_poll_idx").on(table.status, table.nextPollAt),
  ],
);

export const offers = pgTable(
  "offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id")
      .notNull()
      .unique()
      .references(() => matches.id, { onDelete: "cascade" }),
    status: offerStatusEnum("status").notNull().default("matched"),
    assuranceRole: assuranceRoleEnum("assurance_role").notNull().default("alternative"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("offers_status_expires_idx").on(table.status, table.expiresAt)],
);

export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    offerId: uuid("offer_id")
      .notNull()
      .unique()
      .references(() => offers.id, { onDelete: "restrict" }),
    briefId: uuid("brief_id")
      .notNull()
      .references(() => eventBriefs.id, { onDelete: "restrict" }),
    shopperId: uuid("shopper_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    eventDate: timestamp("event_date", { withTimezone: true }).notNull(),
    pickupDate: timestamp("pickup_date", { withTimezone: true }).notNull(),
    returnDate: timestamp("return_date", { withTimezone: true }).notNull(),
    rentalPriceCents: integer("rental_price_cents").notNull(),
    depositDisplayCents: integer("deposit_display_cents").notNull(),
    status: reservationStatusEnum("status").notNull().default("requested"),
    responseDueAt: timestamp("response_due_at", { withTimezone: true }).notNull(),
    backupOfferId: uuid("backup_offer_id").references(() => offers.id, { onDelete: "restrict" }),
    supersedesReservationId: uuid("supersedes_reservation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("reservations_nonnegative_rental_price_check", sql`${table.rentalPriceCents} >= 0`),
    check("reservations_nonnegative_deposit_check", sql`${table.depositDisplayCents} >= 0`),
    check(
      "reservations_date_order_check",
      sql`${table.pickupDate} <= ${table.eventDate} AND ${table.eventDate} <= ${table.returnDate}`,
    ),
    uniqueIndex("reservations_one_active_per_brief_unique")
      .on(table.briefId)
      .where(sql`${table.status} <> 'cancelled'`),
    index("reservations_provider_status_idx").on(table.providerId, table.status),
    foreignKey({
      columns: [table.supersedesReservationId],
      foreignColumns: [table.id],
      name: "reservations_supersedes_reservation_id_reservations_id_fk",
    }).onDelete("restrict"),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: varchar("scope", { length: 80 }).notNull(),
    key: varchar("key", { length: 128 }).notNull(),
    responseResourceId: uuid("response_resource_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idempotency_keys_actor_scope_key_unique").on(
      table.actorId,
      table.scope,
      table.key,
    ),
    index("idempotency_keys_created_idx").on(table.createdAt),
  ],
);
