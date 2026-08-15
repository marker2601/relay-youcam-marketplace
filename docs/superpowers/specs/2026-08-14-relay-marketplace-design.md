# Relay Marketplace Design

**Status:** Approved for implementation planning
**Date:** August 14, 2026  
**Working product name:** Relay  
**Tagline:** Post the event. See yourself in the options. Rent the winner.

## 1. Product Thesis

Relay is a reverse marketplace for circular occasionwear. Instead of asking shoppers to browse thousands of disconnected listings, Relay begins with a time-bound demand brief: the event date, dress code, budget, measurements, location, style preferences, and a consented full-body photograph. The marketplace matches that brief against available garments from peer closets and independent rental boutiques. It then uses Perfect Corp.'s YouCam AI Clothes Virtual Try-On API to render the strongest candidates on the shopper before a reservation request is made.

The business is additive because YouCam is not presented as a product-page novelty. It becomes the trust layer that makes fragmented, one-of-one circular inventory easier to discover and transact. Relay supplies marketplace coordination, availability, matching, seller approval, reservation state, and trust copy around the generated result.

The hackathon product will prove the complete transaction loop with real YouCam output and realistic marketplace state. It will not pretend to operate payments, delivery, damage protection, or identity verification that have not actually been implemented.

## 2. Market Decision

Three two-sided models were compared:

1. A circular occasionwear demand network.
2. A reverse-bid event marketplace supplied by conventional retailers.
3. An outcome-verified skincare marketplace.

Relay was selected because it combines a large and growing secondhand market, explicit consumer pressure around one-time formalwear, a coherent use of Apparel VTO, a credible marketplace liquidity wedge, and a demo that can be understood within three minutes. The retailer-bid model has a more difficult merchant cold start and overlaps heavily with existing AI shopping assistants. The skincare model has strong demand signals but adds health-claim, privacy, attribution, and consumer-trust risks that are disproportionate for the deadline.

The directional United States wedding-guest sizing model produces a $0.5B-$4.9B annual gross merchandise value range and a $1.8B base case. Wedding count and average guest count are source-backed. Adult share, target-shopper share, circular adoption, average order value, and marketplace take rate are explicit assumptions, so this range is a market-entry model rather than a forecast.

Primary research sources:

- [YouCam API Skin AI & Apparel VTO Hackathon](https://youcam-api.devpost.com/)
- [Bank of America Institute: Weddings--Putting a price on love](https://institute.bankofamerica.com/content/dam/economic-insights/wedding-spending.pdf)
- [ThredUp 2025 Resale Report](https://cf-assets-tup.thredup.com/resale_report/2025/ThredUp_Resale_Report_2025.pdf)
- [NRF 2025 Retail Returns Landscape](https://nrf.com/research/2025-retail-returns-landscape)
- [McKinsey State of Fashion 2025](https://www.mckinsey.com/industries/retail/our-insights/state-of-fashion-2025)
- [Perfect Corp. AI Clothes API documentation](https://docs.perfectcorp.com/reference/ai_clothes/section/overview)

## 3. Target Market and Marketplace Sides

### Demand side

The initial shopper is an adult attending a wedding or comparable special event who needs an outfit by a fixed date, cares about appearance and budget, and is open to renting or borrowing instead of buying new. The initial product supports wedding-guest, cocktail, formal, semi-formal, and festive event briefs. Bridal-party coordination, prom, graduation, workwear, everyday fashion, and children's apparel are excluded from the hackathon scope.

### Supply side

Supply comes from two compatible provider types:

- Peer closet owners with underused occasionwear.
- Independent local rental boutiques with available inventory.

Both provider types use the same listing, availability, offer-approval, and reservation interfaces. The interface identifies the provider type, but the matching engine does not create separate product behavior for each one.

### Launch geography

The production business launches in one dense United States metro area so that inventory, pickup, and event demand can become liquid within a bounded radius. The hackathon demo uses a fictional launch market and seeded providers; it does not claim live local coverage.

## 4. Core User Experience

### Shopper journey

1. The shopper lands on a concise explanation of the reverse marketplace.
2. The shopper creates an event brief with event type, event date, dress code, budget range, garment category, size label, body and garment measurements, search radius, color preferences, and optional exclusions.
3. The shopper uploads one consented full-body image that meets YouCam's image requirements.
4. Relay validates the brief and image before saving the request.
5. The matching engine filters unavailable or incompatible inventory, calculates a deterministic score, and selects at most three candidates for preview.
6. Relay creates a YouCam try-on task for each selected candidate and displays progress without blocking the rest of the page.
7. The shopper receives offer cards containing the generated image, garment measurements, size label, condition, rental price, deposit display, provider type, distance band, pickup method, and fit disclaimer.
8. The shopper opens an offer, compares it with the original garment image, and requests a reservation.
9. The shopper sees the reservation status and a simple pickup/return timeline after the provider accepts.

### Provider journey

1. The provider enters the supplier workspace using a seeded demo identity.
2. The provider creates or edits a listing with garment images, category, size label, measurements, condition, color, style tags, rental price, deposit display, pickup radius, and unavailable dates.
3. Relay surfaces matched event briefs without exposing the shopper's original photograph or unnecessary personal details.
4. The provider reviews a qualified request and accepts or declines it.
5. An accepted request becomes a reservation; competing offers remain independent until the shopper selects one.
6. The provider sees the handoff and expected-return dates.

### Demo journey

The recorded demo follows one shopper and one provider. It begins with the shopper posting a wedding-guest brief, shows the matching and YouCam generation, compares three offers, switches to the supplier workspace to accept the selected request, and returns to the shopper reservation timeline. The demo ends with the business model and market impact in one concise screen.

## 5. Product Rules

### Matching

The hackathon matching engine is deterministic and explainable. It applies hard filters first, then a weighted rank.

Hard filters:

- Listing is active.
- Garment is available for the event window.
- Garment category matches the brief.
- Rental price is within the shopper's maximum budget.
- Provider service radius covers the brief's location band.
- Required garment measurements are present.

Ranking factors:

- Measurement compatibility: 35%.
- Dress-code and event-tag compatibility: 25%.
- Color/style preference overlap: 15%.
- Price position within budget: 10%.
- Provider reliability seed score: 10%.
- Distance band: 5%.

The score ranks candidates; it does not claim physical fit. A result can be excluded when measurements violate the shopper's declared minimums or maximums. The algorithm returns at most three candidates to control latency and API consumption.

### Offer and reservation states

An offer uses `matched`, `generating`, `ready`, `failed`, `reservation_requested`, `accepted`, `declined`, or `expired`.

A reservation uses `requested`, `confirmed`, `ready_for_pickup`, `in_use`, `returned`, or `cancelled`.

The hackathon UI demonstrates `requested` and `confirmed`. Later operational states remain modeled so the design does not require a destructive schema change, but the demo does not expose controls that imply unsupported logistics.

### Marketplace economics

Relay's launch hypothesis is an 18% commission on completed rentals. A damage-protection fee and boutique subscription are post-hackathon hypotheses and are not displayed as active charges. The hackathon checkout is explicitly labeled a reservation simulation and does not collect payment data.

## 6. YouCam Integration

Relay uses YouCam AI Clothes Virtual Try-On v3.

- File endpoint: `POST /s2s/v2.0/file/cloth-v3`
- Task endpoint: `POST /s2s/v2.0/task/cloth-v3`
- Result endpoint: `GET /s2s/v2.0/task/cloth-v3/{task_id}`
- Authentication: server-side bearer token only

The user image and reference garment image are uploaded or supplied by public signed URL. The task payload includes exactly one shopper source and one garment reference plus the appropriate `garment_category`. The application stores the task identifier, status, normalized error, and copied result location. It never exposes the YouCam API key to the browser.

The hackathon implementation polls from a server endpoint using bounded exponential backoff. Production can adopt YouCam's signed webhook flow after the prototype. Generated download links are copied promptly because result URLs are time-limited. The application treats YouCam's 30-day upstream retention as a maximum, not Relay's privacy policy.

Input validation enforces JPEG or PNG, less than 10 MB, minimum 512x384 pixels, maximum side 4096 pixels, a single forward-facing person, and a photo composition appropriate to the selected garment category. The capture guidance explains that the person should occupy most of the frame and that obstructed garments or bodies can fail generation.

## 7. System Architecture

Relay is a single responsive TypeScript web application with server-rendered marketplace pages and server-only integration endpoints.

Logical components:

- **Web client:** shopper brief, provider inventory, offer comparison, and reservation timeline.
- **Application server:** validation, authorization boundary, marketplace commands, and read models.
- **Relational database:** demo users, event briefs, listings, availability, match scores, try-on jobs, offers, and reservations.
- **Private object storage:** original shopper images, garment images, and copied try-on results.
- **Matching service:** deterministic filtering, scoring, explanations, and top-three selection.
- **YouCam adapter:** file preparation, task creation, bounded polling, result normalization, and error translation.
- **Background job boundary:** a small persisted job record processed through server requests during the hackathon; replaceable by a durable queue after the event.

Each component exposes a narrow interface. Marketplace domain code does not call YouCam directly; it requests a try-on through the adapter. UI code does not query storage or mutate reservation state directly; it calls validated server commands. The matching service consumes normalized briefs and listings and returns ranked match explanations without database or network access.

## 8. Data Model

### User

- `id`
- `demo_role`: `shopper` or `provider`
- `display_name`
- `provider_type`: `peer`, `boutique`, or null
- `created_at`

### EventBrief

- `id`
- `shopper_id`
- `event_type`
- `event_date`
- `dress_code`
- `budget_min_cents`
- `budget_max_cents`
- `garment_category`
- `size_label`
- `measurement_profile`
- `location_band`
- `radius_miles`
- `preferred_colors`
- `style_tags`
- `exclusions`
- `shopper_image_key`
- `photo_consent_at`
- `status`
- `created_at`

### Listing

- `id`
- `provider_id`
- `title`
- `garment_category`
- `size_label`
- `measurements`
- `condition`
- `color_tags`
- `style_tags`
- `rental_price_cents`
- `deposit_display_cents`
- `service_radius_miles`
- `location_band`
- `garment_image_key`
- `unavailable_ranges`
- `reliability_score`
- `status`

### Match

- `id`
- `brief_id`
- `listing_id`
- `score`
- `score_breakdown`
- `explanation`
- `created_at`

### TryOnJob

- `id`
- `match_id`
- `provider`: `youcam`
- `external_task_id`
- `status`: `queued`, `uploading`, `processing`, `succeeded`, or `failed`
- `attempt_count`
- `next_poll_at`
- `normalized_error_code`
- `result_image_key`
- `created_at`
- `completed_at`

### Offer

- `id`
- `match_id`
- `status`
- `expires_at`
- `created_at`

### Reservation

- `id`
- `offer_id`
- `shopper_id`
- `provider_id`
- `event_date`
- `pickup_date`
- `return_date`
- `rental_price_cents`
- `deposit_display_cents`
- `status`
- `created_at`

Money is stored as integer cents. Measurement fields use a documented unit and are normalized before scoring. Date windows are compared in one configured application timezone for the demo and stored as ISO timestamps.

## 9. Privacy, Trust, and Safety

- Photo upload requires affirmative consent adjacent to the upload control.
- Original shopper photos and generated images are private objects served through short-lived signed URLs.
- Providers never receive the shopper's source photograph.
- The browser never receives YouCam credentials or raw private object keys.
- A deletion action removes Relay's stored original and generated images and disconnects them from the brief. The UI explains that Perfect Corp. may retain API files for up to 30 days under its documented retention policy.
- Logs contain task identifiers and normalized errors, not bearer tokens, signed upload URLs, photographs, or measurement profiles.
- VTO copy says: `Preview shows appearance and styling, not guaranteed physical fit. Check the garment measurements before reserving.`
- The app does not infer protected attributes, diagnose health conditions, or score a person's attractiveness or body.
- Seeded garment images must be owned, permissively licensed, supplied by the developer, or provided by Perfect Corp. samples. Their provenance is recorded in the repository.

## 10. Error Handling

### Invalid shopper image

Reject before task creation when file type, byte size, or dimensions are invalid. When YouCam rejects composition or detection, translate the error into actionable capture guidance and preserve the brief so the shopper can replace only the image.

### Invalid garment reference

Mark only that match as failed, remove it from the ready offer count, and give the provider listing-specific image guidance. Other matches continue processing.

### Rate limits and transient failures

Respect the documented limit of 250 requests per 300 seconds per IP and token. Poll no faster than required, cap attempts, apply exponential backoff with jitter, and translate HTTP 429 or 5xx responses into a retryable job state. A single task is never recreated automatically after a task identifier has been received.

### Permanent YouCam failure

Store the normalized engine error, show the shopper that one preview could not be generated, and keep the original garment card available without a generated preview. A failed preview never produces a reservation-blocking global error.

### Expired result URL

Use the stored external task identifier to retrieve a fresh download URL, then copy the result into private Relay storage.

### Duplicate actions

Task creation, polling, reservation requests, and provider acceptance use idempotency guards. Repeated browser submissions return the existing resource rather than creating duplicate jobs or reservations.

### No matches

Explain which hard constraint eliminated inventory and allow the shopper to widen radius, budget, color, or category without re-entering the rest of the brief.

## 11. Testing Strategy

### Unit tests

- Brief and listing validation.
- Measurement normalization.
- Hard filtering and weighted ranking.
- Match explanations.
- State-transition guards.
- YouCam response and error normalization.
- Retry and polling schedule calculations.
- Photo-retention deletion orchestration.

### Contract tests

- File, task-create, task-status, success, rate-limit, invalid-image, and engine-error YouCam fixtures.
- Server command schemas and serialized domain responses.
- Database uniqueness and reservation idempotency constraints.

### Integration tests

- Creating a brief produces no more than three ranked matches and queued jobs.
- Successful job polling creates a ready offer with a private result object.
- One failed job does not prevent other offers from becoming ready.
- A reservation request can be accepted once and cannot be accepted by the wrong provider.
- Deleting a photo revokes the application reference and makes the signed URL unavailable.

### End-to-end tests

- Shopper completes the seeded brief-to-reservation flow.
- Provider lists a garment and accepts a request.
- Invalid photo guidance preserves form state.
- No-match recovery widens constraints and produces offers.
- Mobile and desktop layouts keep the primary call to action visible and usable.

The final verification run includes type checking, linting, the full automated test suite, a production build, and a manual run of the recorded demo path using real YouCam output.

## 12. Success Metrics

### Hackathon acceptance metrics

- At least one real `cloth-v3` result is generated and displayed end to end.
- A shopper can submit one valid brief and receive up to three ranked offers.
- A provider can accept the selected reservation request.
- The reservation timeline reflects the accepted state.
- API, photo, and matching failures have usable fallback states.
- The full judging flow is understandable within a 1-3 minute video.

### Business validation metrics

- Brief completion rate.
- Valid-photo rate.
- Successful VTO rate.
- Median time from brief submission to first ready offer.
- Offer-view to reservation-request conversion.
- Provider acceptance rate.
- Completed reservation rate.
- Repeat event-brief rate.
- Share of transactions that replace a stated new-apparel purchase.
- Contribution margin per completed reservation after API, payment, support, and protection costs.

No reduction in physical returns or environmental impact is claimed until Relay has observed transaction and counterfactual data.

## 13. Hackathon Scope Boundary

### Required for submission

- Responsive shopper and supplier interfaces.
- Seeded demo identities and inventory.
- Event brief creation and edit recovery.
- Deterministic matching with visible explanations.
- Real YouCam AI Clothes v3 generation.
- Offer comparison with original and generated images.
- Reservation request and provider acceptance.
- Privacy consent, deletion, fit disclaimer, and image guidance.
- Loading, empty, partial-failure, and success states.
- Source repository, setup instructions, screenshots, and a 1-3 minute demo video.

### Explicitly deferred

- Payment collection, payouts, tax, refunds, and deposits.
- Shipping labels, courier dispatch, and routing.
- Damage claims, insurance underwriting, and dispute resolution.
- Government-ID verification and background checks.
- Reviews, chat, notifications, and fraud scoring.
- Multi-city search and dynamic pricing.
- Skin AI, cosmetics, accessories, and multi-garment outfit generation.
- Native mobile applications.

## 14. Submission Story

The submission opens with a concrete problem: special-event garments sit idle while another shopper buys a new outfit under deadline pressure. Relay reverses the marketplace. The shopper posts the need; circular inventory comes to the shopper; YouCam lets the shopper see the strongest candidates before committing.

The demo emphasizes all four judging criteria:

- **Technological implementation:** real YouCam file, task, polling, and result handling inside a non-trivial marketplace workflow.
- **Design:** a coherent buyer-to-provider transaction journey with clear failure and trust states.
- **Potential impact:** increased utilization of existing occasionwear, lower shopping friction, and new earnings for closet owners and boutiques.
- **Quality of idea:** VTO as the transaction trust layer for a demand-first circular market, not a product-page wrapper.

The final pitch does not promise verified fit, reduced returns, or environmental benefit without evidence. It demonstrates a credible mechanism and identifies those claims as post-launch measurements.
