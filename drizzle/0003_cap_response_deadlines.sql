UPDATE "reservations" AS "reservation"
SET "response_due_at" = "brief"."event_starts_at"
FROM "event_briefs" AS "brief"
WHERE "reservation"."brief_id" = "brief"."id"
  AND "reservation"."response_due_at" > "brief"."event_starts_at";
