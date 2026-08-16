# Relay — Devpost draft copy

This copy is reflected in the live Devpost draft at https://devpost.com/software/relay-xr7byl.

## Title

Relay

## Tagline

The reliability layer for time-sensitive fashion.

## One-line summary

Relay turns one urgent occasionwear brief into a primary look, an independent backup, YouCam previews, provider deadlines, and a one-tap recovery path to **Event ready**.

## Problem

Discovery products are optimized to show options, not to protect an outcome. A shopper with an approaching wedding, interview, or celebration can find a promising garment and still lose the plan when one owner is unavailable or slow to respond. Meanwhile, suitable garments remain fragmented across peer closets and small rental boutiques. A virtual try-on widget can reduce visual uncertainty, but it does not coordinate supply, deadlines, provider confirmation, or failure recovery.

## Solution and consumer/retail value

**Relay is the reliability layer for time-sensitive fashion. Discovery apps show possibilities; Relay makes sure you have something to wear.**

The shopper submits one time-sensitive brief with an explicit America/Chicago event time, constraints, measurements, preferences, and a consented photo. Relay hard-filters local inventory and ranks at most three matches. The top match becomes the primary; the strongest remaining match from a different provider becomes the backup when supply permits. Each candidate gets a YouCam Clothes v3 preview and an explainable Event Readiness Score covering availability, measurement compatibility, proximity, style, and provider confirmation.

The shopper requests the primary while Relay preserves the backup. The owner receives a deadline based on event urgency. If the primary owner declines or the deadline expires, the shopper sees **Backup available** and can activate the already-rendered backup in one tap, without a new search or upload. If that independent provider accepts, the timeline reaches **Event ready**. This is an assurance workflow, not a delivery, fit, availability, or financial guarantee; the prototype collects no payment.

For providers, Relay turns passive listings into qualified, time-bounded demand without exposing the shopper's source photo or measurement profile. The current business-model hypothesis is an 18% commission on completed rentals. A future product could test an event-assurance fee. Retailer-return and local-deadstock routing are future expansion ideas, not current features.

## How it was built

Relay is a strict TypeScript/Next.js App Router application. PostgreSQL stores users, event briefs, listings, ranked matches, persisted try-on jobs, stable assurance roles, response deadlines, reservations, recovery links, and idempotency records. A private S3-compatible bucket stores consented shopper media, garment sources, and copied results. Validated server routes enforce signed demo sessions, role ownership, authorization, idempotency, and privacy boundaries.

The real YouCam adapter:

1. Registers shopper and garment files with `POST /s2s/v2.0/file/cloth-v3`.
2. Uploads bytes using the signed method, URL, and headers returned by YouCam.
3. Creates a Clothes v3 task with `POST /s2s/v2.0/task/cloth-v3`.
4. Polls `GET /s2s/v2.0/task/cloth-v3/{task_id}` through a persisted bounded-retry state machine.
5. Refreshes one expired result URL when necessary, then copies the result into private Relay storage.

Server-side assurance rules classify urgency, assign stable roles, calculate bounded readiness components, set response deadlines, reconcile expiry, and authorize exactly one idempotent backup activation. The browser renders those server decisions; it never decides eligibility or receives YouCam, database, or storage credentials.

## Key features

- Explicit event deadline with Tonight, Tomorrow, This week, or Planned urgency.
- Up to three deterministic and explainable matches.
- Primary and independent-provider backup assignment when eligible supply exists.
- Consented YouCam Clothes v3 previews with isolated per-offer failures.
- Component-level Event Readiness Scores that do not claim a probability or guarantee.
- Provider response windows of 15 minutes, 60 minutes, or 4 hours depending on urgency.
- Decline and timeout recovery through an authorized, idempotent **Activate backup look** action.
- Backup-provider acceptance ending in **Event ready** with a no-payment disclosure.
- Private media, short-lived authorized Relay URLs, and owner-triggered deletion.
- Responsive and keyboard-operable desktop/mobile flows covered by deterministic browser tests.

## Why the idea is additive

Relay does not add a try-on button to another catalog. It uses YouCam as visual confidence inside a new coordination mechanism: event demand arrives first, distributed one-of-one inventory is ranked into a resilient plan, two independent suppliers reduce correlated failure, and a preserved preview makes recovery immediate. The product is valuable precisely when the first choice fails.

Relay already routes demand across peer closets and boutique inventory. The same mechanism could later serve stylist networks, university formalwear closets, hotel or venue guest services, and retailer returns or local deadstock. Those additional channels are market-expansion hypotheses, not integrations in this prototype.

## Potential impact and business model

Relay begins with adults seeking occasionwear in one dense US metro and providers with underused local inventory. The measurable hypotheses are shorter search time, higher request-to-accept conversion, more completed rentals, and more provider earnings. The launch monetization hypothesis is an 18% commission on completed rentals. An optional event-assurance fee would be tested only after payment, policy, and operational guarantees exist. Relay makes no current claim about fit, delivery, lower returns, or environmental impact.

## Challenges and workarounds

The first technical wall was making an asynchronous image API behave like a reliable marketplace capability. Relay persists each YouCam job, advances only due work, isolates failures by offer, uses compare-and-set transitions and bounded jittered retries, and does not recreate a task after YouCam has returned an external task ID.

The second wall was safe recovery under concurrency. A provider response can race a deadline, a shopper can double-click activation, and multiple browser sessions can act at once. Relay uses server timestamps, database transactions, conditional updates, idempotency records, and bounded retries so one outcome wins and duplicate recovery returns the existing reservation.

The third wall was privacy across marketplace roles. Providers receive event and garment context but no shopper source media or measurements. Relay authorizes every media read, keeps upstream signed URLs server-only, and revokes application access before best-effort object cleanup.

## What surprised us about the API

YouCam file registration returns explicit signed upload instructions instead of accepting the image bytes in the authenticated JSON call. That separation encouraged a clean server-side adapter and made credential boundaries clear. The time-limited result URL also made private copying, refresh behavior, and deletion part of the product architecture rather than demo cleanup.

## Accomplishments and lessons

Relay proves a two-sided failure-and-recovery transaction instead of stopping at generated imagery. A deterministic browser journey creates the urgent brief, verifies different primary and backup providers, requests the primary, records a decline, activates the preserved backup, accepts as the second provider, and reaches **Event ready**. The lesson is that virtual try-on becomes harder to ignore when it is paired with availability, deadlines, explanations, ownership, and recovery.

## Next steps

- Replace seeded demo identity with production authentication and provider onboarding.
- Add payments, payouts, cancellation/refund policy, damage protection, and pickup logistics.
- Move persisted polling behind a durable queue or webhook boundary.
- Pilot one-city supply and demand to validate match weights and the 18% commission.
- Measure primary failure rate, backup activation, provider response time, request-to-accept conversion, completed rentals, and repeat briefs.
- Explore an event-assurance fee and retailer-return routing only after the core marketplace is validated.

## Explicitly deferred

Payments, deposits, payouts, shipping, delivery, identity verification, damage claims, insurance, messaging, notifications, reviews, fraud scoring, dynamic pricing, event-assurance charges, retailer-return feeds, and multi-city liquidity are not implemented. Seeded inventory is fictional. No legal, financial, delivery, availability, physical-fit, return-reduction, or environmental guarantee is claimed.

## Links and official fields

- Repository: https://github.com/marker2601/relay-youcam-marketplace
- Public demo: https://relay-youcam-marketplace.vercel.app
- Demo video: https://youtu.be/rtxc3_vG1a8 (public, 2:25, 1080p, copyright check passed).
- Project start date: August 14, 2026 (first repository commit).
- App status: existing Relay prototype with a major Relay Rescue update begun August 16, 2026.
- Submitter type: **TODO — user-only Devpost answer**
- Country of residence: **TODO — user-only Devpost answer**
- Required screenshots and thumbnail: uploaded to the Devpost draft from `docs/submission/assets/`.

Official deadline: August 17, 2026 at 15:45 UTC.
