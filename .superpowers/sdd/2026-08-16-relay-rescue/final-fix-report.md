# Relay Rescue final-fix report

Date: 2026-08-16

Base commit: `50958be`

Scope: whole-branch final review blockers only; no deploy or push

## Outcome

All five Important review blockers are closed. The implementation now keeps historical reads safe, exposes a single truthful request action, protects the independent backup, rejects invalid Chicago wall times, caps response deadlines at the event, and validates production response shapes at repository and route boundaries.

## Blocker resolutions

### 1. Historical reads no longer apply create-time urgency validation

- Kept `classifyEventUrgency` strict for creation and reservation writes.
- Added a non-throwing presentation classifier for offer snapshots, shopper reservation history, provider lists, and provider detail.
- Added post-event coverage for offer snapshots plus accepted shopper and provider history.

### 2. One truthful Request action with a durable backup

- Offer snapshots project deterministic effective roles for existing/migrated rows, including the migration default that labelled every legacy offer `alternative`.
- The UI renders Request only on the effective primary. It does not open the action while an independent designated backup is still generating.
- The reservation transaction independently derives and locks the current plan, repairs persisted roles, rejects non-primary requests, and requires the independent backup to be ready before accepting the primary.
- The designated backup is persisted on the reservation and is excluded from alternative expiry, so the recovery path is not silently lost.
- E2E readiness waits on offer state rather than counting action buttons and now asserts exactly one primary Request action.

### 3. No same-provider backup

- Assurance assignment selects a backup only from a different provider.
- When no independent provider exists, the plan is `primary_only`; remaining offers stay alternatives.
- Domain, read-model, and UI regressions cover this classification.

### 4. Chicago time and response-deadline invariants

- Chicago wall-time conversion now round-trips candidate instants through `America/Chicago`.
- Nonexistent spring-forward times and ambiguous fall-back times are rejected; the form reports the error inline rather than throwing.
- Brief validation requires `eventDate` to equal the Chicago-local date of `eventStartsAt`.
- Reservation response deadlines are deterministically capped at the event instant; stale events are rejected as conflicts.
- Migration `0003_cap_response_deadlines` repairs existing rows whose response deadline is after the event.
- Added DST gap, DST fold, Chicago date mismatch, near-event deadline, and exact 7-day/90-day boundary coverage.

### 5. Canonical provider and reservation response contracts

- Replaced stale duplicate interfaces with types inferred from the canonical Zod schemas.
- Provider request schemas now match actual repository output, including `offerStatus` and `hasBackup`.
- Reservation detail schemas now include the real recovery projection: backup identity, activation capability, supersession, offer status, and simulation marker.
- Repository projections and all relevant route success responses parse through those schemas.
- Contract tests use actual handler/repository-shaped fixtures, and integration tests parse real repository results.

## TDD evidence

RED runs established the failures before implementation:

- Domain/schema assurance run: 6 expected failures covering same-provider fallback, historical urgency, deadline calculation, DST gap/fold, and Chicago date mismatch.
- Cross-layer offer/reservation/contract run: 13 expected failures covering action count, backup readiness, migrated roles, post-event reads, deadlines, and stale response contracts.
- Canonical contract integration initially rejected actual repository data because the old schema required `readiness` and rejected recovery fields.
- Brief form regression initially failed with one unhandled `RangeError` for `2027-03-14 02:30` Chicago time.

GREEN runs:

- Focused domain/schema assurance: 28/28 passed.
- Focused UI/read/reservation/contract assurance: 55/55 passed.
- Brief-form DST regression: 9/9 passed.
- `npm.cmd test`: 28 files, 255 tests passed.
- `npm.cmd run typecheck`: passed.
- `npm.cmd run lint`: exit 0; only 3 pre-existing unused-destructure warnings in the negative contract fixture.
- `npm.cmd run build`: passed with the Next.js 16 production build.
- `npm.cmd run test:e2e`: 16/16 passed across desktop Chromium and the mobile project.
- `git diff --check`: passed.

## Non-blocking output

- Playwright repeats the known `NO_COLOR`/`FORCE_COLOR` warning and harmless Drizzle “already exists, skipping” notices.
- Lint retains the three documented negative-fixture destructuring warnings; there are no lint errors.
- The protected untracked `.devpost-hackathon-state.json` was not opened, modified, staged, or committed.

## Remaining concerns

None for the reviewed scope. No blocker was deferred.

## Final scoped re-review: reservation-bound recovery

The re-review found one remaining action-state mismatch after a primary response timeout. Reconciliation correctly cancelled the reservation and expired its primary offer, but shortlist role normalization discarded the expired primary and promoted the designated backup. The client then exposed a new Request action that the reservation repository correctly rejected because an initial reservation already existed.

Resolution:

- Offer snapshots now project the shopper-owned current `reservationId` as canonical brief reservation state.
- Once an initial reservation exists, server role projection binds `primary` and `backup` to that reservation's selected offer and designated backup instead of re-ranking survivors.
- Client presentation normalization preserves those server-bound roles and never exposes an initial Request while `reservationId` is present.
- The shortlist links directly to the current reservation timeline for confirmation or backup recovery.
- Timeout detail continues to expose `canActivateBackup`, and the real repository activation path creates the superseding backup request.
- No-reservation shortlists still produce one requestable primary; provider-declined and timed-out primaries both remain recovery-bound.

Round-two TDD evidence:

- RED: focused integration/component/contract run produced 4 expected failures across 3 files. The snapshot lacked reservation state, the timed-out backup became primary, Request reopened, and the strict contract rejected the new state field.
- GREEN: focused recovery assurance passed 5 files and 71 tests.
- Full `npm.cmd test`: 28 files and 259 tests passed.
- `npm.cmd run typecheck`: passed.
- `npm.cmd run lint`: exit 0 with the same 3 documented negative-fixture warnings.
- `npm.cmd run build`: passed.
- `npm.cmd run test:e2e`: 16/16 passed across desktop Chromium and mobile.
- No deploy or push was performed; protected Devpost state remained untouched.
