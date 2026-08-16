# Relay Rescue Design

## Product promise

**Relay is the reliability layer for time-sensitive fashion. Discovery apps show possibilities; Relay makes sure you have something to wear.**

Relay Rescue upgrades the existing reverse marketplace from occasionwear discovery into event assurance. A shopper provides an event deadline, location, budget, style, measurements, and a consented photo. Relay returns a deliberately small plan: one primary look and one independent backup look, both available nearby and rendered on the shopper through YouCam AI Clothes Virtual Try-On. Providers confirm against a response deadline. If the primary provider declines or times out, Relay promotes the backup without making the shopper restart.

The judged prototype demonstrates the assurance workflow but does not claim to provide a legal, financial, delivery, fit, or availability guarantee. Payments, deposits, delivery, insurance, and automatic provider penalties remain simulated or out of scope.

## Why this is the right wedge

Large fashion marketplaces already compete on catalog size and browsing. Relay should not attempt to win that contest. It should solve the high-consequence moment those catalogs do not resolve: a shopper has an event soon and needs a wearable option that is visually acceptable, locally obtainable, and provider-confirmed.

The upgrade uses the strongest parts of the current implementation instead of replacing them:

- The shopper brief already captures event, location, budget, style, category, measurements, and photo consent.
- The matching engine already applies hard constraints and explainable ranking.
- Relay already produces up to three independent YouCam previews.
- Providers already accept or decline reservation requests.
- Reservation state is already persisted, idempotent, authorized, and visible to the shopper.

The new value comes from composing those capabilities into a reliable outcome: a primary plan, a backup plan, and visible recovery.

## Users and jobs

### Shopper

When an important event is approaching, the shopper needs to secure an outfit without browsing hundreds of uncertain listings or depending on one owner. Success means the shopper sees two credible looks, understands why they are viable, and knows which provider action is required next.

### Provider

The provider needs qualified, time-bounded demand rather than passive listing views. Success means the provider can understand the event request without seeing the shopper's source photo, respond before a clear deadline, and convert idle inventory into a reservation.

### Marketplace operator

Relay needs to increase completed rentals while minimizing failed event outcomes. The long-term commercial model is an 18% commission on completed rentals plus an optional event-assurance fee once payments and operational guarantees exist.

## Core experience

### 1. Time-aware brief

The request form adds an explicit event date and time. The existing event description remains free text. The interface derives an urgency label without making unsupported delivery promises:

- `Tonight` for an event less than 12 hours away.
- `Tomorrow` for 12 to 36 hours.
- `This week` for more than 36 hours and no more than 7 days.
- `Planned` for more than 7 days.

Past deadlines are rejected. The prototype accepts dates up to 90 days ahead so the judged path remains focused on time-sensitive use.

### 2. Assured pair selection

The matching engine continues to rank eligible listings using hard filters and weighted explanations. A new assurance selector assigns:

- **Primary look:** the highest-scoring eligible listing.
- **Backup look:** the highest-scoring remaining listing owned by a different provider when possible.

Using a different provider reduces correlated failure. If no independent backup exists, Relay labels the result `Primary only` and explains that the event is not yet protected. The system never invents a backup or silently relaxes the shopper's hard constraints.

### 3. Event Readiness Score

Each candidate receives an explainable score from 0 to 100. It is a prioritization signal, not a guarantee or probability.

The score combines:

- 35 points: listing availability covers the event window.
- 25 points: measurement compatibility under the current matching rules.
- 20 points: pickup proximity.
- 10 points: style and category alignment.
- 10 points: provider confirmation state.

Before provider confirmation, the final component is zero and the UI states that confirmation is pending. Once accepted, it contributes all 10 points. The interface shows the component labels so judges can understand why one look is primary.

### 4. Provider response window

Every reservation request receives a deterministic response deadline based on event urgency:

- Tonight: 15 minutes.
- Tomorrow: 60 minutes.
- This week or Planned: 4 hours.

The prototype displays the deadline and countdown but does not require a background worker. Expiration is evaluated whenever the reservation is read or acted on. An accept action after expiration is rejected idempotently and the shopper view moves to recovery.

### 5. Automatic fallback

The shopper first requests the primary look. Relay associates the backup candidate with the reservation as the recovery option. If the primary is declined or expires, the shopper sees a prominent `Activate backup` action. Activating it creates an idempotent request for the backup provider without re-uploading the image or rerunning YouCam.

The button remains user-confirmed in the prototype to avoid creating a second provider obligation without explicit shopper action. The demo describes this as one-tap failover, not an automatic paid booking.

### 6. Assurance status

The shortlist and reservation timeline use five truthful states:

- `Building your plan`: matching or YouCam previews are still processing.
- `Primary ready, backup ready`: both candidates are previewable and eligible.
- `Awaiting owner confirmation`: a reservation request is active.
- `Backup available`: the primary failed and recovery can be activated.
- `Event ready`: a provider accepted the active reservation.

These states replace vague success language. Every state includes the next action and preserves the existing warning that appearance previews do not guarantee physical fit.

## Interface changes

### Landing page

The hero leads with the approved product promise. Supporting copy explains the mechanism in one sentence: `Get a primary look, a backup look, and owner confirmation before your event.` The two role entry points remain visible so judges can immediately test both sides.

### Shopper brief

Add the event date/time control near the event description and show the derived urgency label. Existing privacy and image guidance remain unchanged.

### Offer page

Replace the generic three-card emphasis with an assurance plan:

- A wide primary card.
- A clearly subordinate backup card.
- Event countdown and readiness score on both.
- Existing YouCam previews and matching explanations.
- A compact `Why this plan is resilient` explanation stating whether the two looks use independent providers.

A third ranked result may remain visible as `Another option`, but it is not part of the assured pair and receives less visual emphasis.

### Provider request

Add event timing, urgency, response deadline, and a statement that the shopper has a backup option. Do not expose the shopper's source image or measurement profile. Accept and decline retain their existing authorization and idempotency rules.

### Reservation timeline

Show primary versus backup role, response countdown, recovery state, and the `Activate backup` action when eligible. An accepted reservation ends at `Event ready`.

## Architecture and data model

The feature remains inside the existing Next.js application and PostgreSQL domain model. It adds no paid service and makes no new client-side calls to YouCam.

### Brief fields

- `event_starts_at`: required timestamp.
- `urgency`: derived on the server and returned in read models; it is not separately persisted.

### Offer fields

- `assurance_role`: `primary`, `backup`, or `alternative`.
- `readiness_score`: derived from persisted listing, brief, match, and reservation state.

The assurance role is persisted when offers are created so ordering stays stable across refreshes. Existing offers created before the migration default to `alternative`.

### Reservation fields

- `response_due_at`: required timestamp computed from the brief urgency when the request is created.
- `backup_offer_id`: nullable reference to an offer for the same brief.
- `supersedes_reservation_id`: nullable self-reference used when the backup is activated.

Provider decline and response timeout preserve the current reservation model: the reservation becomes `cancelled`, while its offer records the reason as `declined` or `expired`. Backup activation is permitted only when the original reservation is `cancelled`, its offer is `declined` or `expired`, the backup offer belongs to the same shopper brief, and no active backup reservation already exists.

### Server responsibilities

- Validate event timestamps and compute urgency.
- Assign stable assurance roles after matching.
- Compute readiness scores in the offer read model.
- Compute and persist provider response deadlines.
- Reconcile overdue requested reservations to `cancelled` and their offers to `expired` during authorized reads and mutations.
- Enforce backup activation invariants transactionally.
- Keep the designated backup offer ready when the primary is requested; expire only unselected alternatives.

The browser renders server-provided states and never decides authorization, expiration, or backup eligibility.

## Failure and privacy behavior

- If the primary YouCam render fails but the backup succeeds, Relay promotes the successful eligible look and seeks another backup from the remaining candidates.
- If all renders fail, existing retry guidance remains and no readiness claim is shown.
- If only one eligible provider exists, the UI states `Primary only` and recommends widening budget, radius, or category.
- If a provider responds at the same moment the deadline expires, the database transaction and server timestamp determine one outcome.
- Repeated backup activation returns the existing backup reservation instead of creating duplicates.
- Deleting the shopper's images retains the existing immediate application-level revocation behavior; the assurance workflow cannot restore deleted media.
- Providers continue to receive event and garment context only. The shopper's source image and measurements remain private.

## Testing strategy

### Unit tests

- Urgency boundaries and invalid dates.
- Primary and independent-provider backup selection.
- Readiness score components and bounds.
- Response-deadline calculation.
- Reservation transitions including expiration and backup activation.

### Integration tests

- Brief creation persists event time.
- Offer generation persists stable assurance roles.
- Expired requests reject acceptance.
- Declined and expired primary requests permit exactly one backup activation.
- Cross-brief, cross-shopper, and unauthorized backup activation are rejected.
- Existing privacy deletion and media authorization remain intact.

### End-to-end tests

- Shopper creates a time-sensitive brief and receives a primary/backup plan.
- Provider declines the primary request; shopper activates the backup; second provider accepts; timeline reaches `Event ready`.
- Mobile and desktop layouts show countdowns and roles without overflow.
- Reduced-motion and accessibility checks continue to pass.

## Demo and submission narrative

The 1–3 minute demo should show the product thesis through a failure-and-recovery story:

1. A shopper needs an outfit for an event tomorrow.
2. Relay converts one brief into a primary look and an independent backup.
3. YouCam renders both looks on the shopper, and Relay explains each readiness score.
4. The primary provider declines.
5. Relay exposes the already-rendered backup without another search or photo upload.
6. The backup provider accepts, and the shopper timeline reaches `Event ready`.

The closing business statement is: `Relay monetizes successful rentals today and can later become the demand-routing layer for boutique inventory, retailer returns, and local deadstock.` Return interception is presented as expansion potential, not as implemented functionality.

## Success criteria

The upgrade is complete when:

- A judge can understand the reliability promise from the landing page within five seconds.
- A shopper can create a brief with a future event deadline and see primary and backup roles.
- Both roles can display real or fake YouCam previews through the existing integration.
- A primary decline or expiration produces a safe, idempotent backup path.
- A second provider can accept the backup and produce an `Event ready` timeline.
- Privacy, authorization, build, lint, type-check, unit, integration, accessibility, and production smoke checks remain green.
- Submission copy and demo script describe only behavior that the deployed application demonstrates.

## Explicit non-goals

- Charging the event-assurance fee.
- Real payments, payouts, deposits, delivery, insurance, or identity verification.
- Claiming guaranteed fit, delivery, availability, return reduction, or environmental impact.
- Integrating retailer return feeds before submission.
- Adding chat, reviews, notifications, or multi-city operations.
- Replacing the current YouCam integration or private-media architecture.
