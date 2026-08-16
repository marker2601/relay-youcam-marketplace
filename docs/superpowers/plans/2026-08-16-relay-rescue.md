# Relay Rescue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Relay into a time-sensitive fashion assurance marketplace that presents a primary look, an independent backup, provider response deadlines, and a safe one-tap fallback.

**Architecture:** Keep the existing Next.js/PostgreSQL/YouCam architecture and add one pure assurance domain module. Persist event timing, stable offer roles, and reservation recovery links; keep all expiry, authorization, and failover decisions on the server. Extend the existing read models and UI without adding a paid dependency or changing private-media handling.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript 6, Drizzle ORM, PostgreSQL, Vitest, Testing Library, Playwright, YouCam AI Clothes Virtual Try-On v3, private S3-compatible storage.

## Global Constraints

- Preserve the exact product promise: **Relay is the reliability layer for time-sensitive fashion. Discovery apps show possibilities; Relay makes sure you have something to wear.**
- The judged prototype demonstrates assurance; it must not claim a legal, financial, delivery, fit, or availability guarantee.
- Keep the existing warning that virtual try-on shows appearance and styling, not guaranteed physical fit.
- Use no new paid services and no additional client-side YouCam calls.
- Keep YouCam credentials, database credentials, object keys, and signed upstream URLs server-only.
- Providers must never receive the shopper's source image or measurement profile.
- Tonight is less than 12 hours, Tomorrow is 12–36 hours, This week is more than 36 hours through 7 days, and Planned is more than 7 days through 90 days.
- Provider response windows are 15 minutes for Tonight, 60 minutes for Tomorrow, and 4 hours for This week or Planned.
- Backup activation is user-confirmed and idempotent; it is not an automatic paid booking.
- Keep Node.js 20 compatibility and read the repository's relevant Next.js 16 docs before changing route handlers or client/server component boundaries.
- Use test-driven development and commit after every independently reviewable task.

## File map

- `src/lib/domain/assurance.ts`: pure urgency, role assignment, response-window, and readiness-score rules.
- `src/lib/domain/contracts.ts`: shared assurance types included in read models.
- `src/lib/domain/schemas.ts`: request and response validation for event timing and backup activation.
- `src/lib/db/schema.ts`: persisted event timestamp, assurance role, response deadline, and reservation recovery references.
- `drizzle/0002_relay_rescue.sql`: forward-only PostgreSQL migration and backfill.
- `src/lib/repositories/marketplace.ts`: stable assurance-role assignment and role rebalancing after preview failure.
- `src/lib/repositories/offer-read.ts`: authorized assurance plan and readiness-score projection.
- `src/lib/repositories/reservations.ts`: deadlines, expiry reconciliation, preserved backup, and backup activation.
- `src/app/api/briefs/route.ts`: persist the validated event timestamp.
- `src/app/api/reservations/[reservationId]/backup/route.ts`: authenticated backup-activation command.
- `src/components/assurance/deadline-countdown.tsx`: accessible client-side event/provider countdown.
- `src/components/brief/brief-form.tsx`: collect event time and submit an ISO timestamp.
- `src/components/offers/offer-grid.tsx`, `offer-card.tsx`, `offer-progress.tsx`: render the primary/backup assurance plan.
- `src/components/provider/request-card.tsx`, `provider-decision-panel.tsx`: show urgency and response deadline.
- `src/components/reservation/reservation-timeline.tsx`: show recovery and activate the backup.
- `src/app/page.tsx`, `src/app/globals.css`: product promise and visual hierarchy.
- `tests/unit/assurance.test.ts`: pure assurance rules.
- Existing unit, integration, contract, and E2E tests: schema, repository, UI, privacy, and full recovery journey coverage.

---

### Task 1: Pure assurance rules and contracts

**Files:**
- Create: `src/lib/domain/assurance.ts`
- Create: `tests/unit/assurance.test.ts`
- Modify: `src/lib/domain/contracts.ts:5-110`

**Interfaces:**
- Consumes: existing match score breakdowns where measurement max is 3,500, distance max is 500, and event/style max is 4,000 combined.
- Produces: `EventUrgency`, `AssuranceRole`, `AssuranceCoverage`, `ReadinessBreakdown`, `classifyEventUrgency()`, `responseWindowMs()`, `assignAssuranceRoles()`, `calculateReadiness()`, and `chicagoLocalDateTimeToIso()`.

- [ ] **Step 1: Write failing assurance-rule tests**

```ts
import { describe, expect, it } from "vitest";
import {
  assignAssuranceRoles,
  calculateReadiness,
  chicagoLocalDateTimeToIso,
  classifyEventUrgency,
  responseWindowMs,
} from "@/lib/domain/assurance";

describe("Relay Rescue assurance rules", () => {
  const now = new Date("2026-08-16T12:00:00.000Z");

  it.each([
    [11, "tonight", 15 * 60_000],
    [12, "tomorrow", 60 * 60_000],
    [36, "this_week", 4 * 60 * 60_000],
    [8 * 24, "planned", 4 * 60 * 60_000],
  ] as const)("classifies %s hours", (hours, urgency, window) => {
    const event = new Date(now.getTime() + hours * 60 * 60_000);
    expect(classifyEventUrgency(event, now)).toBe(urgency);
    expect(responseWindowMs(urgency)).toBe(window);
  });

  it("chooses the top match as primary and a different provider as backup", () => {
    expect(assignAssuranceRoles([
      { id: "one", providerId: "provider-a" },
      { id: "two", providerId: "provider-a" },
      { id: "three", providerId: "provider-b" },
    ])).toEqual(new Map([
      ["one", "primary"],
      ["three", "backup"],
      ["two", "alternative"],
    ]));
  });

  it("returns a bounded explainable readiness score", () => {
    expect(calculateReadiness({
      available: true,
      measurementBasisPoints: 3_500,
      distanceBasisPoints: 500,
      styleBasisPoints: 4_000,
      providerConfirmed: false,
    })).toEqual({ availability: 35, measurements: 25, proximity: 20, style: 10, confirmation: 0, total: 90 });
  });

  it("converts Chicago wall time independently of the browser time zone", () => {
    expect(chicagoLocalDateTimeToIso("2026-08-17", "19:00")).toBe("2026-08-18T00:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run the test and verify the module is missing**

Run: `npm test -- tests/unit/assurance.test.ts`

Expected: FAIL because `@/lib/domain/assurance` does not exist.

- [ ] **Step 3: Implement the minimal pure domain module**

```ts
export type EventUrgency = "tonight" | "tomorrow" | "this_week" | "planned";
export type AssuranceRole = "primary" | "backup" | "alternative";
export type AssuranceCoverage = "primary_and_backup" | "primary_only";

export interface ReadinessBreakdown {
  availability: number;
  measurements: number;
  proximity: number;
  style: number;
  confirmation: number;
  total: number;
}

export function classifyEventUrgency(eventStartsAt: Date, now: Date): EventUrgency {
  const hours = (eventStartsAt.getTime() - now.getTime()) / 3_600_000;
  if (hours <= 0 || hours > 90 * 24) throw new RangeError("Event must be within the next 90 days");
  if (hours < 12) return "tonight";
  if (hours <= 36) return "tomorrow";
  if (hours <= 7 * 24) return "this_week";
  return "planned";
}

export function responseWindowMs(urgency: EventUrgency): number {
  return urgency === "tonight" ? 15 * 60_000 : urgency === "tomorrow" ? 60 * 60_000 : 4 * 60 * 60_000;
}

export function chicagoLocalDateTimeToIso(date: string, time: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallClockAsUtc = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const offsetAt = (instant: Date) => {
    const parts = formatter.formatToParts(instant);
    const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)!.value);
    return Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second")) - instant.getTime();
  };
  const first = new Date(wallClockAsUtc - offsetAt(new Date(wallClockAsUtc)));
  return new Date(wallClockAsUtc - offsetAt(first)).toISOString();
}

export function assignAssuranceRoles<T extends { id: string; providerId: string }>(rows: readonly T[]): Map<string, AssuranceRole> {
  const roles = new Map<string, AssuranceRole>();
  const primary = rows[0];
  if (!primary) return roles;
  roles.set(primary.id, "primary");
  const backup = rows.slice(1).find((row) => row.providerId !== primary.providerId) ?? rows[1];
  if (backup) roles.set(backup.id, "backup");
  for (const row of rows.slice(1)) if (!roles.has(row.id)) roles.set(row.id, "alternative");
  return roles;
}
```

Implement `calculateReadiness()` by scaling each bounded component explicitly:

```ts
function scale(value: number, sourceMaximum: number, targetMaximum: number): number {
  return Math.round(Math.min(1, Math.max(0, value / sourceMaximum)) * targetMaximum);
}

export function calculateReadiness(input: {
  available: boolean;
  measurementBasisPoints: number;
  distanceBasisPoints: number;
  styleBasisPoints: number;
  providerConfirmed: boolean;
}): ReadinessBreakdown {
  const result = {
    availability: input.available ? 35 : 0,
    measurements: scale(input.measurementBasisPoints, 3_500, 25),
    proximity: scale(input.distanceBasisPoints, 500, 20),
    style: scale(input.styleBasisPoints, 4_000, 10),
    confirmation: input.providerConfirmed ? 10 : 0,
  };
  return { ...result, total: Object.values(result).reduce((sum, value) => sum + value, 0) };
}
```

- [ ] **Step 4: Add the shared contract fields**

Add `EventUrgency`, `AssuranceRole`, `AssuranceCoverage`, and `ReadinessBreakdown` imports or re-exports to `contracts.ts`. Extend offer, provider-request, and reservation contracts with these exact fields:

```ts
assuranceRole: AssuranceRole;
eventStartsAt: string;
urgency: EventUrgency;
readiness: ReadinessBreakdown;
responseDueAt: string | null;
```

- [ ] **Step 5: Run unit tests and type-check**

Run: `npm test -- tests/unit/assurance.test.ts tests/unit/matching.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the domain rules**

```bash
git add src/lib/domain/assurance.ts src/lib/domain/contracts.ts tests/unit/assurance.test.ts
git commit -m "feat: add Relay Rescue assurance rules"
```

---

### Task 2: Persist event timing, assurance roles, and recovery links

**Files:**
- Modify: `src/lib/db/schema.ts:1-350`
- Create: `drizzle/0002_relay_rescue.sql`
- Modify: `src/lib/repositories/marketplace.ts:1-260`
- Modify: every integration fixture that inserts `eventBriefs`
- Modify: `tests/integration/brief-flow.test.ts`
- Modify: `tests/integration/offer-read-model.test.ts`

**Interfaces:**
- Consumes: `assignAssuranceRoles()` from Task 1.
- Produces: `eventBriefs.eventStartsAt`, `offers.assuranceRole`, `reservations.responseDueAt`, `reservations.backupOfferId`, and `reservations.supersedesReservationId`.

- [ ] **Step 1: Write failing persistence tests**

Add an integration assertion after `createMatchesAndJobs()`:

```ts
const persisted = await testDb
  .select({ role: offers.assuranceRole, providerId: listings.providerId })
  .from(offers)
  .innerJoin(matches, eq(matches.id, offers.matchId))
  .innerJoin(listings, eq(listings.id, matches.listingId))
  .where(eq(matches.briefId, briefId))
  .orderBy(desc(matches.scoreBasisPoints));

expect(persisted[0]!.role).toBe("primary");
expect(persisted.filter((row) => row.role === "backup")).toHaveLength(1);
expect(persisted.find((row) => row.role === "backup")!.providerId)
  .not.toBe(persisted[0]!.providerId);
```

- [ ] **Step 2: Run the test and verify the schema field is missing**

Run: `npm test -- tests/integration/brief-flow.test.ts`

Expected: FAIL because `offers.assuranceRole` does not exist.

- [ ] **Step 3: Extend the Drizzle schema**

Add:

```ts
export const assuranceRoleEnum = pgEnum("assurance_role", ["primary", "backup", "alternative"]);

// eventBriefs
eventStartsAt: timestamp("event_starts_at", { withTimezone: true }).notNull(),

// offers
assuranceRole: assuranceRoleEnum("assurance_role").notNull().default("alternative"),

// reservations
responseDueAt: timestamp("response_due_at", { withTimezone: true }).notNull(),
backupOfferId: uuid("backup_offer_id").references(() => offers.id, { onDelete: "restrict" }),
supersedesReservationId: uuid("supersedes_reservation_id"),
```

Import `foreignKey` from `drizzle-orm/pg-core`, leave `supersedesReservationId` as a UUID without an inline reference, and add the self-reference in the existing `reservations` table callback:

```ts
foreignKey({
  columns: [table.supersedesReservationId],
  foreignColumns: [table.id],
  name: "reservations_supersedes_reservation_id_reservations_id_fk",
}).onDelete("restrict"),
```

Preserve the existing one-active-reservation-per-brief partial unique index.

- [ ] **Step 4: Create the forward migration with safe backfills**

```sql
CREATE TYPE "public"."assurance_role" AS ENUM('primary', 'backup', 'alternative');
ALTER TABLE "event_briefs" ADD COLUMN "event_starts_at" timestamp with time zone;
UPDATE "event_briefs"
SET "event_starts_at" = ("event_date"::timestamp + interval '19 hours') AT TIME ZONE 'America/Chicago';
ALTER TABLE "event_briefs" ALTER COLUMN "event_starts_at" SET NOT NULL;
ALTER TABLE "offers" ADD COLUMN "assurance_role" "assurance_role" DEFAULT 'alternative' NOT NULL;
ALTER TABLE "reservations" ADD COLUMN "response_due_at" timestamp with time zone;
UPDATE "reservations" SET "response_due_at" = "created_at" + interval '4 hours';
ALTER TABLE "reservations" ALTER COLUMN "response_due_at" SET NOT NULL;
ALTER TABLE "reservations" ADD COLUMN "backup_offer_id" uuid;
ALTER TABLE "reservations" ADD COLUMN "supersedes_reservation_id" uuid;
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_backup_offer_id_offers_id_fk" FOREIGN KEY ("backup_offer_id") REFERENCES "public"."offers"("id") ON DELETE restrict;
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_supersedes_reservation_id_reservations_id_fk" FOREIGN KEY ("supersedes_reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict;
```

- [ ] **Step 5: Assign roles while creating offers**

Build role candidates from ranked listings before the insert loop:

```ts
const roles = assignAssuranceRoles(ranked.map((item) => ({
  id: item.listingId,
  providerId: candidates.find((candidate) => candidate.id === item.listingId)!.providerId,
})));
```

Persist `assuranceRole: roles.get(rankedMatch.listingId) ?? "alternative"` with each offer.

- [ ] **Step 6: Rebalance roles after a terminal preview failure**

Add a private transaction helper that orders non-failed current-revision offers by match score, assigns the top surviving offer primary and an independent-provider survivor backup, and updates the remaining survivors to alternative. Call it from `failJob()` after setting the failed offer to `failed`; do not revive failed or expired offers.

- [ ] **Step 7: Add `eventStartsAt` to all direct event-brief inserts**

Use explicit deterministic values such as:

```ts
eventDate: "2026-09-20",
eventStartsAt: new Date("2026-09-21T00:00:00.000Z"),
```

Update the brief POST route in Task 3 rather than adding a database default.

- [ ] **Step 8: Run migrations and persistence tests**

Run: `npm run db:migrate && npm test -- tests/integration/brief-flow.test.ts tests/integration/offer-read-model.test.ts tests/integration/database-invariants.test.ts`

Expected: PASS, with one primary and one independent-provider backup for a three-match brief.

- [ ] **Step 9: Commit persistence**

```bash
git add src/lib/db/schema.ts drizzle/0002_relay_rescue.sql src/lib/repositories/marketplace.ts tests/integration
git commit -m "feat: persist Relay Rescue assurance plans"
```

---

### Task 3: Capture and validate the event deadline

**Files:**
- Modify: `src/lib/domain/schemas.ts:60-205`
- Modify: `src/components/brief/brief-form.tsx:217-390`
- Modify: `src/app/api/briefs/route.ts:180-250`
- Modify: `tests/unit/schemas.test.ts`
- Modify: `tests/unit/brief-form.test.tsx`
- Modify: `tests/integration/brief-api.test.ts`

**Interfaces:**
- Consumes: `classifyEventUrgency()` from Task 1 and `eventBriefs.eventStartsAt` from Task 2.
- Produces: `CreateBriefCommand.eventStartsAt` as an ISO timestamp with an offset and a validated 90-day horizon.

- [ ] **Step 1: Read the bundled Next.js route-handler and client-component guidance**

Run:

```powershell
Get-Content -Raw node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
Get-Content -Raw node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md
```

Expected: confirm route handlers use Web `Request`/`Response` APIs and browser event handling stays in the existing client form.

- [ ] **Step 2: Write failing schema and form tests**

Add `eventStartsAt: "2099-06-13T00:00:00.000Z"` to the valid brief. Assert rejection of a past timestamp and a timestamp beyond 90 days using fake timers. In the form test, fill `Event time (Chicago)` with `19:00` and assert the JSON command contains an ISO `eventStartsAt`.

```ts
expect(JSON.parse(String(payload.get("command")))).toMatchObject({
  eventDate: "2099-06-12",
  eventStartsAt: expect.stringMatching(/^2099-06-1[23]T/),
});
```

- [ ] **Step 3: Run focused tests and verify failure**

Run: `npm test -- tests/unit/schemas.test.ts tests/unit/brief-form.test.tsx tests/integration/brief-api.test.ts`

Expected: FAIL because the form and command schema do not expose `eventStartsAt`.

- [ ] **Step 4: Validate the timestamp in the command schema**

Add `eventStartsAt: z.iso.datetime({ offset: true })` and a `superRefine` check that calls `classifyEventUrgency(new Date(value.eventStartsAt), new Date())`. Report `Event must be within the next 90 days` on `eventStartsAt` when the pure rule throws.

- [ ] **Step 5: Add the event-time control and submit ISO time**

Add a required time input beside Event date:

```tsx
<label>
  Event time (Chicago)
  <input name="eventTime" type="time" defaultValue="19:00" required />
</label>
```

Validate `eventTime`, create `eventStartsAt` with `chicagoLocalDateTimeToIso(eventDate, eventTime)`, include it in the command, and show the derived urgency label after both fields have values. Keep the date and time field values when photo validation fails.

- [ ] **Step 6: Persist the timestamp in the brief POST transaction**

```ts
eventDate: command.data.eventDate,
eventStartsAt: new Date(command.data.eventStartsAt),
```

- [ ] **Step 7: Run focused tests**

Run: `npm test -- tests/unit/schemas.test.ts tests/unit/brief-form.test.tsx tests/integration/brief-api.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit event capture**

```bash
git add src/lib/domain/schemas.ts src/components/brief/brief-form.tsx src/app/api/briefs/route.ts tests/unit/schemas.test.ts tests/unit/brief-form.test.tsx tests/integration/brief-api.test.ts
git commit -m "feat: capture time-sensitive event deadlines"
```

---

### Task 4: Project the assurance plan and readiness scores

**Files:**
- Modify: `src/lib/repositories/offer-read.ts:20-130`
- Modify: `src/lib/domain/schemas.ts:125-205`
- Modify: `tests/integration/offer-read-model.test.ts`
- Modify: `tests/contract/api-responses.test.ts`

**Interfaces:**
- Consumes: persisted `assuranceRole`, event timestamp, match `scoreBreakdown`, and offer status.
- Produces: authorized `OfferSnapshot` with `eventStartsAt`, `urgency`, `assuranceCoverage`, `assuranceRole`, and `readiness`.

- [ ] **Step 1: Write failing read-model assertions**

```ts
expect(snapshot).toMatchObject({
  eventStartsAt: "2026-09-21T00:00:00.000Z",
  urgency: "planned",
  assuranceCoverage: "primary_and_backup",
});
expect(snapshot.offers.map((offer) => offer.assuranceRole)).toEqual([
  "primary",
  "backup",
  "alternative",
]);
expect(snapshot.offers[0]!.readiness.total).toBeGreaterThanOrEqual(0);
expect(snapshot.offers[0]!.readiness.total).toBeLessThanOrEqual(100);
```

- [ ] **Step 2: Run read-model and contract tests**

Run: `npm test -- tests/integration/offer-read-model.test.ts tests/contract/api-responses.test.ts`

Expected: FAIL on missing assurance fields.

- [ ] **Step 3: Extend the authorized query and projection**

Select `eventBriefs.eventStartsAt`, `offers.assuranceRole`, and `matches.scoreBreakdown`. Compute:

```ts
const readiness = calculateReadiness({
  available: row.status !== "expired" && row.status !== "failed",
  measurementBasisPoints: row.scoreBreakdown.measurement,
  distanceBasisPoints: row.scoreBreakdown.distance,
  styleBasisPoints: row.scoreBreakdown.eventDress + row.scoreBreakdown.styleColor,
  providerConfirmed: row.status === "accepted",
});
```

Return `assuranceCoverage: "primary_and_backup"` only when both roles exist on non-failed offers; otherwise return `"primary_only"`. Order by role (`primary`, `backup`, `alternative`) and then match score.

- [ ] **Step 4: Extend Zod response schemas**

Add strict schemas for urgency, assurance role, and readiness breakdown. Include every returned field so contract tests reject accidental omissions or extra fields.

- [ ] **Step 5: Run read-model, contract, privacy, and authorization tests**

Run: `npm test -- tests/integration/offer-read-model.test.ts tests/contract/api-responses.test.ts tests/integration/privacy.test.ts tests/integration/authorization.test.ts`

Expected: PASS and no source-image URL in provider-facing data.

- [ ] **Step 6: Commit the read model**

```bash
git add src/lib/repositories/offer-read.ts src/lib/domain/schemas.ts tests/integration/offer-read-model.test.ts tests/contract/api-responses.test.ts
git commit -m "feat: expose explainable event readiness"
```

---

### Task 5: Preserve the backup and implement safe failover

**Files:**
- Modify: `src/lib/repositories/reservations.ts:1-360`
- Create: `src/app/api/reservations/[reservationId]/backup/route.ts`
- Modify: `src/lib/domain/schemas.ts`
- Modify: `tests/integration/reservation-flow.test.ts`
- Modify: `tests/integration/authorization.test.ts`
- Modify: `tests/unit/state-machines.test.ts`

**Interfaces:**
- Consumes: `responseWindowMs()`, `classifyEventUrgency()`, persisted assurance roles, and the current offer/reservation state machines.
- Produces: `ReservationRepository.activateBackup(actor, reservationId, idempotencyKey, now)` and `POST /api/reservations/:reservationId/backup`.

- [ ] **Step 1: Replace the old competing-offer test with failing assurance tests**

Cover these exact invariants:

```ts
it("preserves the designated backup while expiring only alternatives", async () => {
  const selected = await repository.request(shopper, primaryOfferId, "primary-request-001", now);
  expect(selected.backupOfferId).toBe(backupOfferId);
  expect(await statusOf(backupOfferId)).toBe("ready");
  expect(await statusOf(alternativeOfferId)).toBe("expired");
});

it("activates one backup only after primary decline", async () => {
  const primary = await repository.request(shopper, primaryOfferId, "primary-request-002", now);
  await repository.decide(primaryProvider, primary.id, "decline", "decline-primary-002", now);
  const backup = await repository.activateBackup(shopper, primary.id, "activate-backup-002", now);
  const repeated = await repository.activateBackup(shopper, primary.id, "activate-backup-002", now);
  expect(repeated.id).toBe(backup.id);
  expect(backup.supersedesReservationId).toBe(primary.id);
});

it("expires an overdue provider request before acceptance", async () => {
  const primary = await repository.request(shopper, primaryOfferId, "primary-request-003", now);
  await expect(repository.decide(primaryProvider, primary.id, "accept", "late-accept-003", new Date(primary.responseDueAt))).rejects.toBeInstanceOf(ReservationConflictError);
});
```

Also reject backup activation by another shopper, before decline/expiry, for a cross-brief offer, and after an existing active backup.

- [ ] **Step 2: Run the reservation tests and verify failure**

Run: `npm test -- tests/integration/reservation-flow.test.ts tests/integration/authorization.test.ts`

Expected: FAIL because backup persistence and activation do not exist.

- [ ] **Step 3: Compute response deadlines on request**

In `request()`, derive urgency from `eventStartsAt`, set `responseDueAt = new Date(now.getTime() + responseWindowMs(urgency))`, find the ready same-brief offer with role `backup`, and persist its ID. Require the initial selected offer to have role `primary`.

- [ ] **Step 4: Preserve backup work**

Change the competing-offer update so only `assuranceRole = 'alternative'` rows become expired/superseded. Leave the designated backup offer and completed preview untouched.

- [ ] **Step 5: Reconcile timeout before every reservation read or decision**

Within the same transaction that locks the reservation, if status is `requested` and `responseDueAt <= now`, transition the reservation to `cancelled` and the offer to `expired`. Reject a provider decision after reconciliation. Keep provider decline mapped to cancelled reservation plus declined offer.

- [ ] **Step 6: Implement transactional backup activation**

`activateBackup()` must:

1. Require a shopper actor who owns the original reservation.
2. Lock the original reservation and backup offer.
3. Require original reservation `cancelled` and original offer `declined` or `expired`.
4. Require backup offer `ready`, same brief, and role `backup`.
5. Return the prior response for the same idempotency key.
6. Insert one requested reservation with `supersedesReservationId` pointing to the original and no second backup.
7. Set the backup offer to `reservation_requested`.

- [ ] **Step 7: Add the authenticated route**

Implement the route with the complete UUID, signed-session, and idempotency checks:

```ts
export async function POST(
  request: Request,
  context: { params: Promise<{ reservationId: string }> },
) {
  const env = getServerEnv();
  const now = new Date();
  const actor = actorFromRequest(request, env.SESSION_SECRET, now.getTime());
  if (!actor) return Response.json({ code: "unauthenticated" }, { status: 401 });
  const id = z.uuid().safeParse((await context.params).reservationId);
  if (!id.success || actor.role !== "shopper") {
    return Response.json({ code: "not_found" }, { status: 404 });
  }
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key || key.length < 8 || key.length > 128) {
    return Response.json({ code: "invalid_idempotency_key" }, { status: 400 });
  }
  connection ??= createDatabaseConnection(env.DATABASE_URL);
  try {
    return Response.json(
      await new ReservationRepository(connection.db).activateBackup(actor, id.data, key, now),
    );
  } catch (error) {
    if (error instanceof NotFoundError) {
      return Response.json({ code: "not_found" }, { status: 404 });
    }
    if (error instanceof ReservationConflictError) {
      return Response.json({ code: "reservation_conflict" }, { status: 409 });
    }
    throw error;
  }
}
```

Map `NotFoundError` to 404 and `ReservationConflictError` to 409.

- [ ] **Step 8: Run repository, authorization, and state-machine tests**

Run: `npm test -- tests/integration/reservation-flow.test.ts tests/integration/authorization.test.ts tests/unit/state-machines.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit the failover transaction**

```bash
git add src/lib/repositories/reservations.ts src/app/api/reservations/[reservationId]/backup/route.ts src/lib/domain/schemas.ts tests/integration/reservation-flow.test.ts tests/integration/authorization.test.ts tests/unit/state-machines.test.ts
git commit -m "feat: add idempotent backup activation"
```

---

### Task 6: Render the Relay Rescue experience

**Files:**
- Create: `src/components/assurance/deadline-countdown.tsx`
- Create: `tests/unit/deadline-countdown.test.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/components/offers/offer-grid.tsx`
- Modify: `src/components/offers/offer-card.tsx`
- Modify: `src/components/offers/offer-progress.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/unit/home-page.test.tsx`
- Modify: `tests/unit/offer-grid.test.tsx`

**Interfaces:**
- Consumes: Task 4's `OfferSnapshot` assurance fields.
- Produces: accessible primary/backup hierarchy, readiness explanation, event countdown, and truthful primary-only fallback.

- [ ] **Step 1: Read bundled Next.js image and CSS guidance**

Run:

```powershell
Get-Content -Raw node_modules/next/dist/docs/01-app/01-getting-started/12-images.md
Get-Content -Raw node_modules/next/dist/docs/01-app/01-getting-started/11-css.md
```

- [ ] **Step 2: Write failing landing-page, plan, and countdown tests**

Assert the exact hero promise, the mechanism sentence, primary and backup badges, readiness score component labels, `Primary only` copy when no backup exists, and an `aria-live="polite"` countdown that reaches `Response window ended` at zero.

```ts
expect(screen.getByRole("heading", {
  name: "Relay is the reliability layer for time-sensitive fashion.",
})).toBeVisible();
expect(screen.getByText("Primary look")).toBeVisible();
expect(screen.getByText("Backup look")).toBeVisible();
expect(screen.getAllByText(/Event readiness/)).toHaveLength(2);
```

- [ ] **Step 3: Run UI tests and verify failure**

Run: `npm test -- tests/unit/home-page.test.tsx tests/unit/offer-grid.test.tsx tests/unit/deadline-countdown.test.tsx`

Expected: FAIL on missing Rescue copy and components.

- [ ] **Step 4: Implement the countdown as an isolated client component**

```tsx
"use client";

import { useEffect, useState } from "react";

export function DeadlineCountdown({
  target,
  completeLabel,
  prefix,
}: {
  target: string;
  completeLabel: string;
  prefix: string;
}) {
  const remaining = () => Math.max(0, new Date(target).getTime() - Date.now());
  const [remainingMs, setRemainingMs] = useState(remaining);
  useEffect(() => {
    const timer = window.setInterval(() => setRemainingMs(remaining()), 1_000);
    return () => window.clearInterval(timer);
  }, [target]);
  const minutes = Math.floor(remainingMs / 60_000);
  const seconds = Math.floor((remainingMs % 60_000) / 1_000);
  return (
    <span aria-live="polite">
      {remainingMs === 0 ? completeLabel : `${prefix} ${minutes}m ${seconds}s`}
    </span>
  );
}
```

This component displays time only; the server remains authoritative for expiry.

- [ ] **Step 5: Update the landing promise**

Use:

```tsx
<p className="eyebrow">Event assurance, powered by local closets</p>
<h1>Relay is the reliability layer for time-sensitive fashion.</h1>
<p className="lede">Discovery apps show possibilities. Relay builds a primary look, a backup look, and an owner-confirmed path to your event.</p>
```

- [ ] **Step 6: Render the assurance plan**

Order cards primary, backup, alternative. Give the primary a wide visual treatment, the backup a subordinate but obvious treatment, and alternatives a compact treatment. Show:

- `Primary look`, `Backup look`, or `Another option`.
- Event urgency and countdown.
- Readiness total plus Availability, Measurements, Proximity, Style, and Confirmation components.
- `Independent providers reduce the chance that one cancellation leaves you without a plan` when provider IDs differ.
- `Primary only—widen budget, radius, or category to add protection` when no backup exists.

Keep existing YouCam imagery, partial-failure recovery, signed-URL refresh, and fit disclaimer unchanged.

- [ ] **Step 7: Add focused responsive styles**

Use the existing design tokens. Add role modifier classes, a two-column assurance-plan layout above 900px, one column below 900px, score-meter styles, and countdown styles. Preserve `prefers-reduced-motion` behavior and 320px overflow safety.

- [ ] **Step 8: Run UI and accessibility-focused tests**

Run: `npm test -- tests/unit/home-page.test.tsx tests/unit/offer-grid.test.tsx tests/unit/deadline-countdown.test.tsx tests/unit/brief-form.test.tsx`

Expected: PASS.

- [ ] **Step 9: Commit the assurance interface**

```bash
git add src/app/page.tsx src/app/globals.css src/components/assurance src/components/offers tests/unit
git commit -m "feat: present primary and backup event plans"
```

---

### Task 7: Add provider urgency and shopper recovery controls

**Files:**
- Modify: `src/lib/repositories/reservations.ts`
- Modify: `src/components/provider/request-card.tsx`
- Modify: `src/components/provider/provider-decision-panel.tsx`
- Modify: `src/components/reservation/reservation-timeline.tsx`
- Modify: `src/app/provider/requests/[offerId]/page.tsx`
- Modify: `src/app/reservations/[reservationId]/page.tsx`
- Modify: `tests/unit/reservation-timeline.test.tsx`
- Create: `tests/unit/provider-decision-panel.test.tsx`

**Interfaces:**
- Consumes: reservation details containing offer status, assurance role, urgency, response deadline, backup summary, and `canActivateBackup`.
- Produces: provider deadline UI, `Event ready` accepted state, and shopper `Activate backup` control.

- [ ] **Step 1: Write failing shopper and provider component tests**

```ts
it("offers one-tap recovery after a declined primary", async () => {
  const activate = vi.fn().mockResolvedValue({ id: "backup-reservation" });
  render(<ReservationTimeline reservation={cancelledPrimaryWithBackup} activateBackup={activate} />);
  await userEvent.click(screen.getByRole("button", { name: "Activate backup look" }));
  expect(activate).toHaveBeenCalledWith(cancelledPrimaryWithBackup.id);
});

it("shows the provider response deadline without shopper private data", () => {
  render(<ProviderDecisionPanel reservationId="reservation" terminal={false} responseDueAt="2099-06-12T20:00:00.000Z" urgency="tomorrow" />);
  expect(screen.getByText(/Respond within 60 minutes/)).toBeVisible();
  expect(screen.queryByText(/bust|waist|hips/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- tests/unit/reservation-timeline.test.tsx tests/unit/provider-decision-panel.test.tsx`

Expected: FAIL because the new props and recovery action do not exist.

- [ ] **Step 3: Extend reservation read models**

Return these exact fields from authorized shopper/provider reads:

```ts
offerStatus: OfferStatus;
assuranceRole: AssuranceRole;
eventStartsAt: string;
urgency: EventUrgency;
responseDueAt: string;
backup: { offerId: string; title: string; providerDisplayName: string } | null;
canActivateBackup: boolean;
supersedesReservationId: string | null;
```

Do not return source-media IDs, source URLs, or the measurement profile.

- [ ] **Step 4: Add the shopper backup command**

The timeline's default client command posts to `/api/reservations/${reservationId}/backup` with a fresh idempotency key, parses the returned reservation ID, and navigates to `/reservations/${id}`. Disable double clicks with the same ref pattern used by `ReserveOfferButton`.

- [ ] **Step 5: Update truthful status copy**

- Requested primary: `Awaiting owner confirmation`.
- Confirmed active reservation: `Event ready`.
- Cancelled primary with backup: `Backup available` plus the activation button.
- Cancelled request without backup: `Plan interrupted` plus widening guidance.
- Superseding reservation: label it `Backup request`.

- [ ] **Step 6: Add provider urgency and deadline**

Show event start, urgency, response window, and live countdown on request cards and the decision page. Disable the decision panel when the server-projected request is terminal or expired. State `The shopper has a backup option` without revealing which provider owns it.

- [ ] **Step 7: Run UI, authorization, and privacy tests**

Run: `npm test -- tests/unit/reservation-timeline.test.tsx tests/unit/provider-decision-panel.test.tsx tests/integration/authorization.test.ts tests/integration/privacy.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit recovery UI**

```bash
git add src/lib/repositories/reservations.ts src/components/provider src/components/reservation src/app/provider/requests src/app/reservations tests/unit tests/integration/authorization.test.ts tests/integration/privacy.test.ts
git commit -m "feat: show provider deadlines and shopper recovery"
```

---

### Task 8: Verify the full decline-to-backup journey

**Files:**
- Modify: `tests/e2e/helpers/journey.ts`
- Modify: `tests/e2e/relay-flow.spec.ts`
- Modify: `tests/e2e/accessibility.spec.ts`
- Modify: `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: the complete shopper and provider workflows from Tasks 1–7.
- Produces: deterministic browser proof that Relay recovers from a provider decline and ends at `Event ready`.

- [ ] **Step 1: Add deterministic demo-session helpers**

Add a helper that posts to `/api/demo/session` with one of the exported seed user IDs and follows the 303 redirect. Extend `fillBrief()` to fill `Event time (Chicago)` with `19:00`.

- [ ] **Step 2: Write the failing E2E recovery story**

```ts
test("a declined primary activates an independent backup and reaches Event ready", async ({ browser }) => {
  const shopperContext = await browser.newContext();
  const shopper = await shopperContext.newPage();
  await enterAsShopper(shopper);
  await createBrief(shopper);
  await waitForReadyOffers(shopper);

  const primary = shopper.locator('article[data-assurance-role="primary"]');
  const backup = shopper.locator('article[data-assurance-role="backup"]');
  const primaryProviderId = await primary.getAttribute("data-provider-id");
  const backupProviderId = await backup.getAttribute("data-provider-id");
  expect(primaryProviderId).toBeTruthy();
  expect(backupProviderId).toBeTruthy();
  expect(primaryProviderId).not.toBe(backupProviderId);

  await primary.getByRole("button", { name: /^Request / }).click();
  await expect(shopper).toHaveURL(/\/reservations\/[0-9a-f-]+$/);

  const primaryContext = await browser.newContext();
  const primaryProvider = await primaryContext.newPage();
  await enterAsProvider(primaryProvider, primaryProviderId!);
  await primaryProvider.getByRole("link", { name: "Review request" }).click();
  await primaryProvider.getByLabel(/Type DECLINE/).fill("DECLINE");
  await primaryProvider.getByRole("button", { name: "Decline request" }).click();

  await shopper.reload();
  await shopper.getByRole("button", { name: "Activate backup look" }).click();
  await expect(shopper).toHaveURL(/\/reservations\/[0-9a-f-]+$/);

  const backupContext = await browser.newContext();
  const backupProvider = await backupContext.newPage();
  await enterAsProvider(backupProvider, backupProviderId!);
  await backupProvider.getByRole("link", { name: "Review request" }).click();
  await backupProvider.getByLabel(/Type ACCEPT/).fill("ACCEPT");
  await backupProvider.getByRole("button", { name: "Accept request" }).click();

  await shopper.reload();
  await expect(shopper.getByRole("heading", { name: "Event ready" })).toBeVisible();
  await expect(shopper.getByText(/no payment has been collected/i)).toBeVisible();
  await shopperContext.close();
  await primaryContext.close();
  await backupContext.close();
});
```

Add `data-assurance-role` and `data-provider-id` to the offer article as non-sensitive test hooks. `enterAsProvider()` posts `{ userId }` to `/api/demo/session` through the provider browser context, verifies the 303/200 followed response, then opens `/provider`.

- [ ] **Step 3: Run the new E2E and verify failure**

Run: `npx playwright test tests/e2e/relay-flow.spec.ts --project=chromium --grep "declined primary"`

Expected: FAIL before the new flow is wired end to end.

- [ ] **Step 4: Complete the browser wiring required by the E2E**

Ensure backup activation calls `router.push()` with the returned reservation ID, provider decisions call `router.refresh()`, offer cards expose the two test attributes, and every action has the accessible name used in the test. Do not bypass the signed demo-session endpoint.

- [ ] **Step 5: Run all E2E scenarios**

Run: `npm run test:e2e`

Expected: PASS on desktop, mobile, accessibility, reduced-motion, no-match, partial-failure, privacy deletion, and the Rescue recovery story.

- [ ] **Step 6: Commit E2E proof**

```bash
git add tests/e2e src
git commit -m "test: prove Relay Rescue recovery end to end"
```

---

### Task 9: Update submission story, verify, deploy, and capture assets

**Files:**
- Modify: `README.md`
- Modify: `docs/submission/devpost-copy.md`
- Modify: `docs/submission/demo-script.md`
- Modify: `docs/submission/release-checklist.md`
- Create: `docs/submission/relay-rescue-shot-list.md`

**Interfaces:**
- Consumes: verified production behavior only.
- Produces: accurate Devpost copy, a 1–3 minute demo script, production screenshots, and a submission-ready deployment.

- [ ] **Step 1: Update product and business copy**

Lead with the approved promise. Describe the shopper brief, primary/backup plan, YouCam preview, provider deadline, one-tap recovery, `Event ready` outcome, 18% rental commission hypothesis, and future event-assurance fee. Describe retailer-return routing only as a future expansion.

- [ ] **Step 2: Rewrite the demo as a failure-and-recovery story**

Use this timing:

```text
0:00–0:15  The problem and Relay's reliability promise
0:15–0:40  Time-sensitive shopper brief and consented photo
0:40–1:10  Primary and independent backup YouCam previews
1:10–1:35  Primary provider declines before the deadline
1:35–2:00  Shopper activates the existing backup without a new upload
2:00–2:20  Backup provider accepts; shopper reaches Event ready
2:20–2:40  Business model, privacy, and retailer-return expansion
```

- [ ] **Step 3: Run the complete local verification suite**

Run:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

Expected: every command exits 0 with no unexpected console errors.

- [ ] **Step 4: Run a targeted secret and artifact check**

Run:

```powershell
git status --short
git ls-files | rg "(^|/)\.env($|\.)|\.vercel/|node_modules/|test-results/|playwright-report/"
rg -n --hidden -g '!node_modules/**' -g '!.git/**' "YOUCAM_API_KEY=|S3_SECRET_ACCESS_KEY=|SESSION_SECRET=" .
```

Expected: no tracked secret files, no literal production secret values, and only documented variable names or safe test fixtures.

- [ ] **Step 5: Commit submission materials**

```bash
git add README.md docs/submission
git commit -m "docs: prepare Relay Rescue submission story"
```

- [ ] **Step 6: Deploy without adding a paid service**

Push the branch, deploy through the existing Vercel project, run the existing production smoke command against `https://relay-youcam-marketplace.vercel.app`, and confirm the homepage, shopper brief, real YouCam path, provider decision, and backup activation produce no runtime errors.

- [ ] **Step 7: Capture the required visual assets**

Capture at least:

1. Hero with the reliability promise.
2. Primary and backup YouCam previews with readiness scores.
3. Primary decline and visible Backup available state.
4. Backup provider acceptance and Event ready timeline.

Use only project-owned garment images and the existing synthetic, consent-safe shopper image.

- [ ] **Step 8: Record and publish the mandatory demo video**

Record the verified production flow at 1080p, keep the final cut between 1 and 3 minutes, avoid copyrighted music, explain the YouCam Clothes v3 integration, and publish it publicly on YouTube or Vimeo. Verify the public URL in a signed-out browser.

- [ ] **Step 9: Hand off to the Devpost submission workflow**

Use the official Devpost submission requirements already audited, populate every required custom field with truthful answers, upload the thumbnail/screenshots through supported Devpost mechanisms, attach the public repository, production URL, and public video, then request the final explicit `yes, submit` confirmation immediately before calling the irreversible submit action.

---

## Final verification gate

Before claiming completion, verify all of the following:

- The product promise is visible within five seconds of opening production.
- A new brief has a future event timestamp no more than 90 days away.
- A three-match plan has one primary and one independent-provider backup.
- Readiness totals are bounded and component labels are visible.
- The primary request preserves the backup preview and expires only alternatives.
- Decline and timeout both permit exactly one authorized backup activation.
- The backup provider can accept and the shopper sees `Event ready`.
- Providers never receive shopper source media or measurements.
- Photo deletion still revokes source and generated media.
- Type-check, lint, all Vitest suites, build, and Playwright suites pass.
- Production smoke and one real YouCam success path pass within the approved credit budget.
- Repository, write-up, screenshots, thumbnail, and public 1–3 minute video are ready.
- Nothing is submitted to Devpost until the user gives the final explicit `yes, submit` confirmation.
