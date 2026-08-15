# Relay — Devpost draft copy

This is a local draft. Nothing in this file has been sent to Devpost.

## Title

Relay

## Tagline

A demand-first circular occasionwear marketplace where explainable matching and YouCam virtual try-on turn idle local garments into confident reservation offers.

## One-line summary

Relay lets a shopper post one event brief, receive up to three explainable circular-fashion matches, preview them through YouCam Clothes v3, and request a provider-approved reservation.

## Problem

Occasionwear has a coordination problem. A shopper faces a date, dress code, budget, and fit uncertainty, while suitable garments sit idle across peer closets and small rental boutiques. Conventional resale and rental catalogs make the shopper repeat the search; fragmented local suppliers struggle to surface the right inventory at the right moment. A virtual try-on widget alone does not solve discovery, availability, or provider approval.

## Solution and consumer/retail value

Relay reverses the marketplace. The shopper posts the need once. Relay filters active inventory for availability, category, budget, radius, and measurement constraints; calculates a deterministic score; explains the strongest factors; and sends no more than three candidates through YouCam AI Clothes Virtual Try-On v3. The shopper compares the source garment and generated appearance before requesting a reservation. The owning provider reviews a qualified request without seeing the shopper's source image and accepts or declines it. Both sides then see the same reservation state and pickup/return window.

For shoppers, Relay compresses a fragmented search into a short, relevant shortlist with transparent tradeoffs. For peer closet owners and boutiques, it converts idle inventory into high-intent local demand. The launch business hypothesis is an 18% commission on completed rentals; the prototype collects no payment.

## How it was built

Relay is a strict TypeScript/Next.js App Router application. PostgreSQL stores users, briefs, listings, matches, persisted try-on jobs, offers, reservations, and idempotency records. A private S3-compatible bucket stores source garments, consented shopper images, and copied results. Pure domain modules own hard filters, weighted ranking, explanations, and state transitions. Validated server routes enforce a signed demo session, ownership, idempotency, and privacy boundaries.

The real YouCam adapter:

1. Registers the shopper and garment files with `POST /s2s/v2.0/file/cloth-v3`.
2. Uploads bytes to the signed `PUT` instructions returned by YouCam.
3. Creates a task with `POST /s2s/v2.0/task/cloth-v3`.
4. Polls `GET /s2s/v2.0/task/cloth-v3/{task_id}` through a persisted, bounded retry state machine.
5. Refreshes an expired result URL once and copies the successful result into private Relay storage.

Independent jobs let two offers succeed even if a third image fails. HTTP/rate-limit/engine errors are normalized into safe user guidance without exposing credentials or upstream URLs.

## Key features

- One demand brief for both sides of the market.
- At most three deterministic, explainable matches.
- Real Clothes v3 integration behind a typed adapter plus a deterministic fake adapter for tests.
- Side-by-side source garment and generated-result comparison.
- Visible prices, measurements, distance, condition, provider type, and non-fit disclaimer.
- Private provider review with owner-only accept/decline.
- Idempotent reservation handshake and shared confirmed timeline.
- Invalid-photo recovery, no-match widening, partial failure, rate-limit retry, and expired-result handling.
- Short-lived authorized media URLs and owner-triggered source/result deletion.
- Responsive, keyboard-operable interface tested at desktop, mobile, and 320px.

## Why the idea is additive

Relay does not wrap an API call around a product page. It uses YouCam as the trust layer inside a new marketplace mechanism: demand arrives first, fragmented one-of-one supply is ranked for that demand, and the supplier still controls fulfillment. This creates a compounding product loop among matching quality, try-on confidence, local inventory utilization, provider acceptance, and repeat briefs.

The concept is also extensible beyond fashion retail catalogs: theatre and film costume libraries, hotel/venue guest services, university formalwear closets, stylist inventory networks, and brand take-back programs all contain distributed garments that can be activated by an event-specific demand brief.

## Potential impact

Relay targets a real, bounded audience first: adults seeking wedding-guest and comparable special-event outfits in one dense US metro. Its measurable hypotheses are increased utilization of existing inventory, reduced shopper search time, new provider earnings, and higher request-to-accept conversion when a preview is available. Return reduction, physical fit, and environmental benefit remain future measurements, not current claims.

## Challenges and workarounds

The hardest technical boundary was making an asynchronous image API behave like a reliable marketplace capability without introducing a queue for a short hackathon. Relay persists each job, advances at most three due jobs per request, uses compare-and-set state transitions and bounded jittered backoff, and never recreates a task after YouCam has returned an external task ID.

A second challenge was privacy across two marketplace roles. Relay stores media separately from briefs/listings, authorizes every read, gives providers no route to shopper media, revokes database access before deleting objects, and keeps deletion retryable if storage cleanup fails.

## What surprised us about the API

YouCam's file-registration response returns the upload method, signed URL, and required headers instead of requiring image bytes in the authenticated JSON request. That separation was a useful surprise: it made direct object upload explicit and encouraged a clean server-side adapter. The time-limited result URL also forced Relay to treat copied private storage, refresh, and deletion as first-class product concerns rather than demo cleanup.

## Accomplishments and lessons

Relay proves an end-to-end two-sided transaction instead of stopping at generated imagery. The automated suite covers the entire shopper/provider handshake, state-machine invariants, authorization, privacy deletion, partial failures, duplicate commands, accessibility, and responsive behavior. The central lesson is that useful VTO products need surrounding trust infrastructure: selection logic, explanations, availability, ownership, failure isolation, retention messaging, and an honest fit boundary.

## Next steps

- Replace the signed demo identity with production authentication and provider onboarding.
- Add payments, payouts, cancellation/refund policy, damage protection, and pickup logistics.
- Move persisted polling behind a durable queue/webhook boundary.
- Validate match weights and commission with one-city supply/demand pilots.
- Measure preview-to-request lift, provider acceptance, completed rentals, repeat usage, and stated displacement of a new purchase.

## Explicitly deferred

Payments, deposits, payouts, shipping, courier routing, identity verification, damage claims, insurance, messaging, notifications, reviews, fraud scoring, dynamic pricing, and multi-city liquidity are not implemented. Seeded inventory is fictional. No guaranteed fit, return reduction, environmental reduction, or live marketplace supply is claimed.

## Repository and testing

- Repository: https://github.com/marker2601/relay-youcam-marketplace
- Public demo: **TODO after production data/storage and live YouCam variables are configured**
- Demo video: **TODO public YouTube/Vimeo/Youku URL**
- Setup: follow `README.md`, then run `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration`, `npm run build`, and `npm run test:e2e`.

## Screenshot shot list

1. Desktop shortlist with three resolved offers, prices, scores, and explanations.
2. Mobile source-versus-real-result comparison with the fit disclaimer.
3. Provider request showing decision context without the shopper photo.
4. Confirmed shopper timeline with pickup, event, and return states.
5. Privacy deletion control and exact retention copy.

## Official form fields (fetched August 15, 2026)

- Submitter type: **TODO — Individual / Team of individuals / Organization**
- Country of residence: **TODO**
- App status: **New**
- Project start date: **08-14-26**
- Existing-project update: **Not applicable**
- Required description: use **Solution and consumer/retail value** plus **How it was built** above.
- Repository URL: https://github.com/marker2601/relay-youcam-marketplace
- API surprise: use **What surprised us about the API** above; update after the real smoke test if the observed behavior differs.
- Under-discussed industry/use case: use **Why the idea is additive** above.
- Technical wall/workaround: use **Challenges and workarounds** above.
- Social post URL: **Optional TODO**
- Required screenshots: **TODO capture after real result**
- Required public 1–3 minute video: **TODO**

Official deadline: August 17, 2026 at 11:45 AM Eastern Time. The account is registered for the event. Participation in an exit interview and inclusion in a blog article are required if selected as a winner.
