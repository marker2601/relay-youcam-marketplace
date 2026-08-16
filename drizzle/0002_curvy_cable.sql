CREATE TYPE "public"."assurance_role" AS ENUM('primary', 'backup', 'alternative');--> statement-breakpoint
ALTER TABLE "event_briefs" ADD COLUMN "event_starts_at" timestamp with time zone;--> statement-breakpoint
UPDATE "event_briefs"
SET "event_starts_at" = ("event_date"::timestamp + interval '19 hours') AT TIME ZONE 'America/Chicago';--> statement-breakpoint
ALTER TABLE "event_briefs" ALTER COLUMN "event_starts_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "assurance_role" "assurance_role" DEFAULT 'alternative' NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "response_due_at" timestamp with time zone;--> statement-breakpoint
UPDATE "reservations" SET "response_due_at" = "created_at" + interval '4 hours';--> statement-breakpoint
ALTER TABLE "reservations" ALTER COLUMN "response_due_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "backup_offer_id" uuid;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "supersedes_reservation_id" uuid;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_backup_offer_id_offers_id_fk" FOREIGN KEY ("backup_offer_id") REFERENCES "public"."offers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_supersedes_reservation_id_reservations_id_fk" FOREIGN KEY ("supersedes_reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;
