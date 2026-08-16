# Relay Devpost submission worksheet

The project and submission draft are live at https://devpost.com/software/relay-xr7byl. The final irreversible submission has not been made.

## Core project fields

- **Project name:** Relay
- **Tagline:** The reliability layer for time-sensitive fashion.
- **Public repository:** https://github.com/marker2601/relay-youcam-marketplace
- **Public application:** https://relay-youcam-marketplace.vercel.app
- **Project start date:** August 14, 2026 — derived from the first repository commit (`d75d13d`).
- **App status:** Existing Relay prototype with a major Relay Rescue update begun August 16, 2026. Repository history contains the initial working marketplace before the Rescue assurance update.
- **Submitter type:** Individual
- **Country of residence:** United States
- **Public 1–3 minute video:** https://youtu.be/K_iLJKMcykg (2:21 master; YouTube displays 2:22, 1080p, public, copyright check passed).
- **Screenshots and thumbnail:** uploaded to the Devpost draft; project-owned source assets are in `docs/submission/assets/`.

## Product description

**Relay is the reliability layer for time-sensitive fashion. Discovery apps show possibilities; Relay makes sure you have something to wear.**

Relay is a two-sided marketplace for urgent circular occasionwear. A shopper submits one brief with an explicit America/Chicago event deadline, location, budget, measurements, style, and a consented photo. Relay filters local inventory and returns at most three explainable matches: a primary look, an independent-provider backup when eligible supply permits, and an alternative.

YouCam AI Clothes Virtual Try-On v3 renders each candidate. Relay adds an explainable Event Readiness Score for availability, measurement compatibility, proximity, style, and provider confirmation. When the shopper requests the primary, the backup remains ready and the owner receives a response deadline. If the primary owner declines or times out, the shopper activates the already-rendered backup without another upload or search. The second provider can accept and move the shopper to **Event ready**.

The prototype demonstrates provider-confirmed reservation intent. It collects no payment and does not guarantee fit, delivery, availability, return reduction, or environmental impact. Providers never receive the shopper's source photo or measurement profile.

The current business-model hypothesis is an 18% commission on completed rentals. Relay already routes demand across peer closets and boutique inventory. A future version could test an event-assurance fee and route retailer returns or local deadstock into urgent demand. Those future capabilities are not implemented.

## How YouCam is used

Relay integrates the YouCam Clothes v3 server API through a typed adapter. It registers the shopper and garment files, follows YouCam's signed upload instructions, creates independent try-on tasks, polls them through a persisted bounded-retry state machine, and copies successful time-limited results into private project storage. The API key, upstream signed URLs, database credentials, and storage object keys stay server-only. One preview can fail without blocking the other offers.

## What surprised us about the API

YouCam file registration returns the upload method, signed URL, and required headers rather than accepting the image bytes in the authenticated JSON request. That clean separation made the credential boundary explicit. The time-limited result URL also forced us to design private copying, one refresh attempt, authorization, and deletion as first-class product behavior.

## Underexplored industry or use case

Most virtual try-on experiences optimize a catalog page. Relay uses VTO inside a failure-tolerant demand-routing marketplace. The shopper's urgent outcome—not catalog browsing—is the organizing object. Independent suppliers, stable primary/backup roles, deadlines, and preserved previews make YouCam useful precisely when the first transaction path fails. Relay implements peer and boutique occasionwear supply today; the same mechanism could later serve stylist networks, university formalwear closets, venues, and retailer returns.

## Technical wall and workaround

The hardest wall was safe recovery across asynchronous image work and concurrent marketplace actions. A provider can respond while a deadline expires; the shopper can retry an activation; and two sessions can act simultaneously. Relay persists every YouCam job, uses compare-and-set transitions and bounded backoff, computes deadlines on the server, reconciles expiry during authorized reads/actions, and applies reservation changes inside retryable database transactions. Scoped idempotency keys ensure repeated backup activation returns the same reservation rather than creating duplicates.

## Suggested feature bullets

- Time-sensitive event briefs with Chicago-local date/time conversion and a 90-day horizon.
- Primary plus independent-provider backup selection from explainable top-three matching.
- Real YouCam Clothes v3 previews with private copying and isolated failures.
- Bounded, component-level readiness scores and provider response deadlines.
- Primary decline/timeout recovery without another search, upload, or generation.
- Authorized idempotent backup activation and an **Event ready** outcome.
- Private media and measurements across shopper/provider roles.
- Deterministic desktop, mobile, accessibility, and full recovery browser tests.

## Submission safety gate

- [x] Paste the final public video URL and verify its unauthenticated public page.
- [x] Upload the final screenshot set and thumbnail.
- [x] Supply submitter type and country of residence.
- [x] Confirm repository visibility or judge access.
- [x] Confirm the deployed commit passes production smoke and one real YouCam path.
- [ ] Obtain the user's final explicit `yes, submit` immediately before submission.
