CREATE TYPE "public"."brief_status" AS ENUM('matching', 'active', 'no_matches', 'deleting', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."demo_role" AS ENUM('shopper', 'provider');--> statement-breakpoint
CREATE TYPE "public"."dress_code" AS ENUM('cocktail', 'formal', 'semi_formal', 'festive');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('wedding_guest', 'cocktail_party', 'gala', 'holiday_party');--> statement-breakpoint
CREATE TYPE "public"."garment_category" AS ENUM('upper_body', 'lower_body', 'full_body');--> statement-breakpoint
CREATE TYPE "public"."garment_condition" AS ENUM('excellent', 'good', 'fair');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."location_band" AS ENUM('loop', 'west', 'north');--> statement-breakpoint
CREATE TYPE "public"."media_deletion_status" AS ENUM('active', 'deleting', 'deleted', 'delete_failed');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('brief_source', 'listing_garment', 'try_on_result');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('matched', 'generating', 'ready', 'failed', 'reservation_requested', 'accepted', 'declined', 'expired');--> statement-breakpoint
CREATE TYPE "public"."provider_type" AS ENUM('peer', 'boutique');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('requested', 'confirmed', 'ready_for_pickup', 'in_use', 'returned', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."try_on_job_status" AS ENUM('queued', 'uploading', 'processing', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "event_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shopper_id" uuid NOT NULL,
	"event_type" "event_type" NOT NULL,
	"event_date" date NOT NULL,
	"dress_code" "dress_code" NOT NULL,
	"budget_min_cents" integer NOT NULL,
	"budget_max_cents" integer NOT NULL,
	"garment_category" "garment_category" NOT NULL,
	"size_label" varchar(20) NOT NULL,
	"measurement_profile" jsonb NOT NULL,
	"location_band" "location_band" NOT NULL,
	"radius_miles" integer NOT NULL,
	"preferred_colors" jsonb NOT NULL,
	"style_tags" jsonb NOT NULL,
	"exclusions" jsonb NOT NULL,
	"shopper_media_id" uuid NOT NULL,
	"photo_consent_at" timestamp with time zone NOT NULL,
	"status" "brief_status" DEFAULT 'matching' NOT NULL,
	"matching_revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_briefs_shopper_media_id_unique" UNIQUE("shopper_media_id"),
	CONSTRAINT "event_briefs_nonnegative_budget_check" CHECK ("event_briefs"."budget_min_cents" >= 0),
	CONSTRAINT "event_briefs_budget_order_check" CHECK ("event_briefs"."budget_min_cents" <= "event_briefs"."budget_max_cents"),
	CONSTRAINT "event_briefs_radius_check" CHECK ("event_briefs"."radius_miles" BETWEEN 1 AND 100),
	CONSTRAINT "event_briefs_revision_check" CHECK ("event_briefs"."matching_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"scope" varchar(80) NOT NULL,
	"key" varchar(128) NOT NULL,
	"response_resource_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"title" varchar(100) NOT NULL,
	"garment_category" "garment_category" NOT NULL,
	"size_label" varchar(20) NOT NULL,
	"measurements" jsonb NOT NULL,
	"condition" "garment_condition" NOT NULL,
	"color_tags" jsonb NOT NULL,
	"style_tags" jsonb NOT NULL,
	"rental_price_cents" integer NOT NULL,
	"deposit_display_cents" integer NOT NULL,
	"service_radius_miles" integer NOT NULL,
	"location_band" "location_band" NOT NULL,
	"garment_media_id" uuid NOT NULL,
	"unavailable_ranges" jsonb NOT NULL,
	"reliability_basis_points" integer DEFAULT 8000 NOT NULL,
	"status" "listing_status" DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listings_garment_media_id_unique" UNIQUE("garment_media_id"),
	CONSTRAINT "listings_nonnegative_rental_price_check" CHECK ("listings"."rental_price_cents" >= 0),
	CONSTRAINT "listings_nonnegative_deposit_check" CHECK ("listings"."deposit_display_cents" >= 0),
	CONSTRAINT "listings_service_radius_check" CHECK ("listings"."service_radius_miles" BETWEEN 1 AND 100),
	CONSTRAINT "listings_reliability_check" CHECK ("listings"."reliability_basis_points" BETWEEN 0 AND 10000),
	CONSTRAINT "listings_version_check" CHECK ("listings"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brief_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"brief_revision" integer NOT NULL,
	"listing_version" integer NOT NULL,
	"score_basis_points" integer NOT NULL,
	"score_breakdown" jsonb NOT NULL,
	"explanation" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matches_score_check" CHECK ("matches"."score_basis_points" BETWEEN 0 AND 10000),
	CONSTRAINT "matches_brief_revision_check" CHECK ("matches"."brief_revision" > 0),
	CONSTRAINT "matches_listing_version_check" CHECK ("matches"."listing_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "media_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"kind" "media_kind" NOT NULL,
	"object_key" text NOT NULL,
	"content_type" varchar(50) NOT NULL,
	"byte_size" integer NOT NULL,
	"brief_id" uuid,
	"listing_id" uuid,
	"job_id" uuid,
	"deletion_status" "media_deletion_status" DEFAULT 'active' NOT NULL,
	"deletion_error_code" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "media_objects_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "media_objects_positive_size_check" CHECK ("media_objects"."byte_size" > 0),
	CONSTRAINT "media_objects_one_resource_check" CHECK (num_nonnulls("media_objects"."brief_id", "media_objects"."listing_id", "media_objects"."job_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"status" "offer_status" DEFAULT 'matched' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offers_match_id_unique" UNIQUE("match_id")
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"brief_id" uuid NOT NULL,
	"shopper_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"event_date" timestamp with time zone NOT NULL,
	"pickup_date" timestamp with time zone NOT NULL,
	"return_date" timestamp with time zone NOT NULL,
	"rental_price_cents" integer NOT NULL,
	"deposit_display_cents" integer NOT NULL,
	"status" "reservation_status" DEFAULT 'requested' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_offer_id_unique" UNIQUE("offer_id"),
	CONSTRAINT "reservations_nonnegative_rental_price_check" CHECK ("reservations"."rental_price_cents" >= 0),
	CONSTRAINT "reservations_nonnegative_deposit_check" CHECK ("reservations"."deposit_display_cents" >= 0),
	CONSTRAINT "reservations_date_order_check" CHECK ("reservations"."pickup_date" <= "reservations"."event_date" AND "reservations"."event_date" <= "reservations"."return_date")
);
--> statement-breakpoint
CREATE TABLE "try_on_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"provider" varchar(30) DEFAULT 'youcam' NOT NULL,
	"source_file_id" text,
	"reference_file_id" text,
	"external_task_id" text,
	"status" "try_on_job_status" DEFAULT 'queued' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_poll_at" timestamp with time zone,
	"normalized_error_code" varchar(80),
	"result_media_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "try_on_jobs_match_id_unique" UNIQUE("match_id"),
	CONSTRAINT "try_on_jobs_external_task_id_unique" UNIQUE("external_task_id"),
	CONSTRAINT "try_on_jobs_result_media_id_unique" UNIQUE("result_media_id"),
	CONSTRAINT "try_on_jobs_provider_check" CHECK ("try_on_jobs"."provider" = 'youcam'),
	CONSTRAINT "try_on_jobs_attempt_count_check" CHECK ("try_on_jobs"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"demo_role" "demo_role" NOT NULL,
	"display_name" varchar(100) NOT NULL,
	"provider_type" "provider_type",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_role_provider_type_check" CHECK (("users"."demo_role" = 'shopper' AND "users"."provider_type" IS NULL) OR ("users"."demo_role" = 'provider' AND "users"."provider_type" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "event_briefs" ADD CONSTRAINT "event_briefs_shopper_id_users_id_fk" FOREIGN KEY ("shopper_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_briefs" ADD CONSTRAINT "event_briefs_shopper_media_id_media_objects_id_fk" FOREIGN KEY ("shopper_media_id") REFERENCES "public"."media_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_provider_id_users_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_garment_media_id_media_objects_id_fk" FOREIGN KEY ("garment_media_id") REFERENCES "public"."media_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_brief_id_event_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."event_briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_brief_id_event_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."event_briefs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_shopper_id_users_id_fk" FOREIGN KEY ("shopper_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_provider_id_users_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "try_on_jobs" ADD CONSTRAINT "try_on_jobs_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "try_on_jobs" ADD CONSTRAINT "try_on_jobs_result_media_id_media_objects_id_fk" FOREIGN KEY ("result_media_id") REFERENCES "public"."media_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_briefs_shopper_created_idx" ON "event_briefs" USING btree ("shopper_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_actor_scope_key_unique" ON "idempotency_keys" USING btree ("actor_id","scope","key");--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_idx" ON "idempotency_keys" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "listings_status_category_idx" ON "listings" USING btree ("status","garment_category");--> statement-breakpoint
CREATE UNIQUE INDEX "matches_brief_revision_listing_version_unique" ON "matches" USING btree ("brief_id","brief_revision","listing_id","listing_version");--> statement-breakpoint
CREATE INDEX "media_objects_owner_deleted_idx" ON "media_objects" USING btree ("owner_user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "offers_status_expires_idx" ON "offers" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_one_active_per_brief_unique" ON "reservations" USING btree ("brief_id") WHERE "reservations"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "reservations_provider_status_idx" ON "reservations" USING btree ("provider_id","status");--> statement-breakpoint
CREATE INDEX "try_on_jobs_status_next_poll_idx" ON "try_on_jobs" USING btree ("status","next_poll_at");