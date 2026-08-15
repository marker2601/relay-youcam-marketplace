# Relay Marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy Relay, a responsive two-sided circular occasionwear marketplace that turns a shopper's event brief into at most three explainable matches, generates real YouCam Clothes v3 previews, and completes a simulated reservation that a provider can accept.

**Architecture:** Use one Next.js App Router application for server-rendered pages and validated Route Handlers. Keep matching and state transitions as pure domain modules; access PostgreSQL, private S3-compatible storage, and YouCam only through typed adapters. Persist each try-on job and advance it through bounded browser-triggered polling so the hackathon works without a separate queue while retaining a clean production queue boundary.

**Tech Stack:** Node.js 20+, Next.js App Router, React, strict TypeScript, Tailwind CSS, Zod, Drizzle ORM with PostgreSQL, AWS SDK v3 against S3-compatible storage, Sharp, Vitest, Testing Library, MSW, Playwright, Docker Compose for local PostgreSQL/MinIO, and Vercel-compatible deployment.

## Global Constraints

- Treat the approved design at `docs/superpowers/specs/2026-08-14-relay-marketplace-design.md` as the source of product truth. A scope change requires updating that document before changing this plan.
- Use test-driven development: add one focused failing test, run it and see the expected failure, implement the minimum behavior, rerun the focused test, then commit.
- Keep `YOUCAM_API_KEY`, database credentials, object-store credentials, private object keys, signed URLs, measurements, and image bytes out of browser bundles and logs.
- Use real YouCam Clothes v3 for the recorded success path. The fake adapter is allowed only in automated tests and an explicitly labeled local demo mode.
- The virtual try-on disclaimer is always visible beside a generated result: `Preview shows appearance and styling, not guaranteed physical fit. Check the garment measurements before reserving.`
- Store money as integer US cents, measurements as integer tenths of a centimeter, and timestamps as UTC. Use `America/Chicago` only when deriving demo pickup and return dates for the fictional launch market.
- Keep the hackathon transaction honest: the UI says `Reservation simulation`; it contains no card fields and performs no payment, payout, shipping, identity, damage, or review workflow.
- Every state-changing command is authenticated by the signed demo session, Zod-validated, authorized against the resource owner, and idempotent.
- Do not log request bodies. Structured logs may contain internal resource IDs, YouCam task IDs, state names, attempt counts, durations, and normalized error codes.
- Before each commit, run the focused test named in the task. Before final completion, run every command in the release gate in Task 16.

---

## Target Repository Map

```text
.
├── .env.example
├── .github/workflows/ci.yml
├── docker-compose.yml
├── drizzle.config.ts
├── eslint.config.mjs
├── next.config.ts
├── package.json
├── package-lock.json
├── playwright.config.ts
├── postcss.config.mjs
├── tsconfig.json
├── vitest.config.ts
├── public/
│   └── demo/garments/{emerald-midi.png,midnight-jumpsuit.png,burgundy-maxi.png}
├── drizzle/                         # generated, committed SQL migrations
├── docs/
│   ├── assets/attribution.md
│   ├── submission/{demo-script.md,devpost-copy.md,release-checklist.md}
│   └── superpowers/{specs,plans}/
├── scripts/seed.ts
├── scripts/create-test-db.sql
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── demo/session/route.ts
│   │   │   ├── briefs/route.ts
│   │   │   ├── briefs/[briefId]/{route.ts,offers/route.ts,process/route.ts}
│   │   │   ├── listings/route.ts
│   │   │   ├── listings/[listingId]/route.ts
│   │   │   ├── offers/[offerId]/reserve/route.ts
│   │   │   ├── reservations/[reservationId]/accept/route.ts
│   │   │   ├── reservations/[reservationId]/decline/route.ts
│   │   │   └── media/[mediaId]/route.ts
│   │   ├── briefs/[briefId]/page.tsx
│   │   ├── provider/{page.tsx,listings/new/page.tsx,requests/[offerId]/page.tsx}
│   │   ├── request/new/page.tsx
│   │   ├── reservations/[reservationId]/page.tsx
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── brief/{brief-form.tsx,image-guidance.tsx}
│   │   ├── offers/{offer-card.tsx,offer-grid.tsx,offer-progress.tsx}
│   │   ├── provider/{listing-form.tsx,request-card.tsx}
│   │   ├── reservation/{reservation-timeline.tsx}
│   │   └── ui/{button.tsx,field.tsx,status-pill.tsx}
│   └── lib/
│       ├── auth/demo-session.ts
│       ├── config/env.ts
│       ├── db/{client.ts,schema.ts}
│       ├── domain/{contracts.ts,matching.ts,schemas.ts,state-machines.ts}
│       ├── images/validate-image.ts
│       ├── http/errors.ts
│       ├── repositories/{briefs.ts,listings.ts,marketplace.ts}
│       ├── storage/{object-store.ts,s3-object-store.ts}
│       ├── try-on/{orchestrator.ts,retry-policy.ts}
│       └── youcam/{client.ts,errors.ts,schemas.ts}
└── tests/
    ├── contract/{api-responses.test.ts,youcam-client.test.ts}
    ├── e2e/{accessibility.spec.ts,relay-flow.spec.ts}
    ├── fixtures/{images,youcam}/
    ├── helpers/test-db.ts
    ├── integration/{authorization.test.ts,brief-api.test.ts,brief-flow.test.ts,database-invariants.test.ts,failure-recovery.test.ts,offer-read-model.test.ts,privacy.test.ts,reservation-flow.test.ts,seed.test.ts}
    ├── unit/{brief-form.test.tsx,demo-session.test.ts,env.test.ts,matching.test.ts,offer-grid.test.tsx,reservation-timeline.test.tsx,retry-policy.test.ts,schemas.test.ts,state-machines.test.ts,validate-image.test.ts}
    └── setup.ts
```

## Dependency Direction

```text
React pages/components -> Route Handlers -> repositories -> PostgreSQL
                                      |             |
                                      |             +-> private object store
                                      +-> try-on orchestrator -> YouCam adapter
                                      |
                                      +-> pure domain services
```

Domain modules import only domain contracts and Zod. Repositories may import domain and database modules. Route Handlers may import repositories, auth, storage, and the orchestrator. UI modules never import database, storage, or YouCam modules.

## Canonical Commands

```bash
npm run dev
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test
npm run build
npm run db:generate
npm run db:migrate
npm run db:seed
```

## Task 1: Bootstrap the strict full-stack test harness

**Files:**

- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `postcss.config.mjs`
- Create: `eslint.config.mjs`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `tests/setup.ts`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/globals.css`
- Create: `.env.example`
- Test: `tests/unit/env.test.ts`

- [x] Initialize and install runtime dependencies:

  ```bash
  npm init -y
  npm install next react react-dom zod drizzle-orm postgres @aws-sdk/client-s3 @aws-sdk/s3-request-presigner sharp
  npm install -D typescript @types/node @types/react @types/react-dom tailwindcss @tailwindcss/postcss eslint eslint-config-next vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event msw playwright @playwright/test drizzle-kit tsx dotenv
  ```

- [x] Add these exact scripts to `package.json`:

  ```json
  {
    "scripts": {
      "dev": "next dev",
      "build": "next build",
      "start": "next start",
      "typecheck": "tsc --noEmit",
      "lint": "eslint .",
      "test:unit": "vitest run --exclude tests/integration/** --exclude tests/e2e/**",
      "test:integration": "vitest run tests/integration --maxWorkers=1",
      "test:e2e": "playwright test",
      "test": "vitest run --exclude tests/e2e/**",
      "db:generate": "drizzle-kit generate",
      "db:migrate": "drizzle-kit migrate",
      "db:seed": "tsx scripts/seed.ts"
    }
  }
  ```
- [x] Write `tests/unit/env.test.ts` to prove that missing `DATABASE_URL`, `SESSION_SECRET`, storage settings, and—when `YOUCAM_MODE=live`—`YOUCAM_API_KEY` produce field-specific validation errors.
- [x] Run `npm run test:unit -- tests/unit/env.test.ts` and confirm it fails because `src/lib/config/env.ts` does not exist.
- [x] Create `src/lib/config/env.ts` with separate `serverEnvSchema` and `publicEnvSchema`; export a lazy `getServerEnv(source = process.env)` so importing UI modules never evaluates secrets during build.

  ```ts
  const base = z.object({
    DATABASE_URL: z.string().min(1),
    SESSION_SECRET: z.string().min(32),
    S3_ENDPOINT: z.string().url(),
    S3_REGION: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("false"),
    APP_TIME_ZONE: z.literal("America/Chicago"),
    DEMO_MODE: z.enum(["true", "false"]),
    YOUCAM_BASE_URL: z.string().url().default("https://yce-api-01.makeupar.com"),
  });

  export const serverEnvSchema = z.discriminatedUnion("YOUCAM_MODE", [
    base.extend({ YOUCAM_MODE: z.literal("fake") }),
    base.extend({ YOUCAM_MODE: z.literal("live"), YOUCAM_API_KEY: z.string().min(20) }),
  ]);

  export function getServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
    return serverEnvSchema.parse(source);
  }
  ```

- [x] Configure strict TypeScript (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Vitest aliases/setup, Playwright `webServer`, Tailwind, and a minimal accessible home page with `Shop as a guest` and `Supply your closet` links.
- [x] Copy every required variable—with safe example values and comments—into `.env.example`; include separate `DATABASE_URL` and `TEST_DATABASE_URL` values, `APP_TIME_ZONE=America/Chicago`, `DEMO_MODE=true`, `YOUCAM_MODE=fake`, and no usable secret.
- [x] Run `npm run typecheck`, `npm run lint`, and the focused env test; confirm all pass.
- [x] Commit: `chore: bootstrap Relay application and test harness`

## Task 2: Define the domain contracts and command validation

**Files:**

- Create: `src/lib/domain/contracts.ts`
- Create: `src/lib/domain/schemas.ts`
- Test: `tests/unit/schemas.test.ts`
- Test: `tests/contract/api-responses.test.ts`

- [x] In `contracts.ts`, define string unions for `DemoRole`, `ProviderType`, `GarmentCategory`, `OfferStatus`, `ReservationStatus`, and `TryOnJobStatus`; define integer-tenths measurement types and the public read models `BriefDetail`, `OfferCard`, `ProviderRequest`, and `ReservationDetail`.

  ```ts
  export type EventType = "wedding_guest" | "cocktail_party" | "gala" | "holiday_party";
  export type DressCode = "cocktail" | "formal" | "semi_formal" | "festive";
  export type GarmentCategory = "upper_body" | "lower_body" | "full_body";
  export type OfferStatus =
    | "matched" | "generating" | "ready" | "failed"
    | "reservation_requested" | "accepted" | "declined" | "expired";
  export type ReservationStatus =
    | "requested" | "confirmed" | "ready_for_pickup"
    | "in_use" | "returned" | "cancelled";
  export type TenthsCm = number & { readonly __unit: "tenths_cm" };
  ```

- [x] Write failing schema tests for an event in the past, inverted budget, missing consent, non-integer measurements, unsupported category, empty required tags, invalid price, and an unavailable date range whose end precedes its start.
- [x] Run `npm run test:unit -- tests/unit/schemas.test.ts` and confirm the cases fail.
- [x] Implement Zod schemas `createBriefCommandSchema`, `createListingCommandSchema`, `requestReservationCommandSchema`, and `acceptReservationCommandSchema`. Use ISO `YYYY-MM-DD` strings at the HTTP boundary and convert to UTC only inside repositories.
- [x] Add a response-contract test that parses a complete `OfferCard`, verifies that it contains a signed `imageUrl` but no object key, and verifies that provider read models contain no shopper image field or measurement profile.
- [x] Implement `offerCardSchema`, `providerRequestSchema`, and `reservationDetailSchema`; export inferred types and use `satisfies` in fixtures so compile-time and runtime contracts stay aligned.
- [x] Run the focused unit and contract tests plus `npm run typecheck`; confirm all pass.
- [x] Commit: `feat: define Relay domain and API contracts`

## Task 3: Add PostgreSQL, migrations, and database invariants

**Files:**

- Create: `docker-compose.yml`
- Create: `drizzle.config.ts`
- Create: `src/lib/db/client.ts`
- Create: `src/lib/db/schema.ts`
- Create: `drizzle/0000_relay_core.sql` via Drizzle
- Test: `tests/integration/database-invariants.test.ts`

- [x] Add PostgreSQL and MinIO services to `docker-compose.yml`, with named volumes, health checks, explicit local-only credentials, PostgreSQL port `54329`, MinIO API host port `59000`, and MinIO console host port `59001`. Mount `scripts/create-test-db.sql` into PostgreSQL initialization to create a separate `relay_test` database, and use a one-shot MinIO initializer to create a non-public `relay-media` bucket.
- [x] Define Drizzle enums and tables for `users`, `event_briefs`, `listings`, `matches`, `try_on_jobs`, `offers`, `reservations`, `media_objects`, and `idempotency_keys`. Use UUID primary keys, JSONB only for measurement/tag/breakdown structures, `integer` cents/tenths, and `timestamp with time zone` timestamps. Store `shopper_media_id`, `garment_media_id`, and `result_media_id` foreign keys instead of exposing storage keys from core records. A try-on job also stores nullable `source_file_id` and `reference_file_id` so every external upload phase can resume without duplication. Store `brief_id` on reservations for transaction-level uniqueness.
- [x] Add `matching_revision integer default 1` to briefs, `version integer default 1` to listings, and both `brief_revision` and `listing_version` to matches. Add database constraints: non-negative cents; min budget <= max; scores 0–10000 basis points; reliability 0–10000; one match per brief/revision/listing-version; one try-on job per match; one offer per match; one reservation per offer; one non-cancelled reservation per brief; unique non-null YouCam `external_task_id`; one idempotency value per actor/scope/key; and exactly one owning resource for each media record.
- [x] Start local services and generate the migration:

  ```bash
  docker compose up -d db minio
  npm run db:generate
  npm run db:migrate
  ```

- [x] Create `tests/helpers/test-db.ts` to require a `TEST_DATABASE_URL` whose database name ends in `_test`, run committed migrations, and truncate only the allowlisted Relay tables between tests. Write integration tests that insert a valid graph, then prove duplicate matches, duplicate active brief reservations, negative prices, and invalid scores are rejected by PostgreSQL.
- [x] Run `npm run test:integration -- tests/integration/database-invariants.test.ts` and confirm it fails until every constraint is present.
- [x] Finish schema constraints and add indexes on `event_briefs(shopper_id, created_at)`, `listings(status, garment_category)`, `try_on_jobs(status, next_poll_at)`, `reservations(provider_id, status)`, `media_objects(owner_user_id, deleted_at)`, and `idempotency_keys(created_at)`.
- [x] Rerun the focused test, inspect `drizzle/0000_relay_core.sql`, and confirm it can apply to a fresh test database.
- [x] Commit: `feat: add Relay database schema and invariants`

## Task 4: Seed the fictional two-sided launch market

**Files:**

- Create: `scripts/seed.ts`
- Create: `public/demo/garments/emerald-midi.png`
- Create: `public/demo/garments/midnight-jumpsuit.png`
- Create: `public/demo/garments/burgundy-maxi.png`
- Create: `docs/assets/attribution.md`
- Test: `tests/integration/seed.test.ts`

- [x] Create three original, product-only garment images on a neutral background. Record the creation method, author/tool, date, and permitted use in `docs/assets/attribution.md`; do not download unattributed marketplace photographs.
- [x] Write a failing seed test expecting one shopper (`Maya Chen`), three providers (two peers and one boutique), five active listings, and at least three listings that match the canonical wedding-guest brief.
- [x] Run `npm run test:integration -- tests/integration/seed.test.ts` and confirm it fails on the empty database.
- [x] Implement an idempotent `scripts/seed.ts` using fixed UUIDs and `onConflictDoUpdate`. Seed fictional Chicago location bands `loop`, `west`, and `north`; use only public garment asset paths and never seed a shopper photo.
- [x] Seed listing measurements, dates, price, tags, radius, reliability, and provider type so ranking has one clear winner, one style-driven alternative, one budget alternative, and two hard-filtered controls.
- [x] Run `npm run db:seed` twice, then rerun the seed test and confirm counts do not increase.
- [x] Open the three assets at mobile and desktop sizes and confirm the entire garment is visible with no people, logos, watermark, or unreadable detail.
- [x] Commit: `feat: seed Relay demo providers and inventory`

## Task 5: Implement deterministic matching with explanations

**Files:**

- Create: `src/lib/domain/matching.ts`
- Test: `tests/unit/matching.test.ts`

- [x] Define `MatchInput` with a normalized brief and candidate listings enriched with `distanceMiles`; define `RankedMatch` with integer basis-point `score`, a six-part breakdown, and ordered explanation strings.
- [x] Write failing table tests for every hard filter: inactive listing, unavailable event window, category mismatch, over-budget price, out-of-radius distance, and a missing required garment measurement.
- [x] Write failing ranking tests that lock the weights at measurement 3500, event/dress code 2500, style/color 1500, price 1000, provider reliability 1000, and distance 500 basis points; include a stable listing-ID tiebreaker and a maximum of three results.
- [x] Run `npm run test:unit -- tests/unit/matching.test.ts` and confirm the hard-filter and score assertions fail.
- [x] Implement pure helpers `passesHardFilters`, `measurementScore`, `tagScore`, `priceScore`, `distanceScore`, and `rankMatches`. For full-body items require bust, waist, and hips for compatibility and length for shopper display; accept each garment circumference between the corresponding body circumference + 20 and + 120 tenths-cm; score proximity to 60 tenths-cm ease.
- [x] Lock the normalized component formulas: measurement is the average of `clamp(1 - abs(ease - 60) / 60)`; event/dress is 70% dress-tag coverage plus 30% event-tag coverage; color/style is the average of each preference-coverage score and defaults to 1 only when that preference list is empty; price is `clamp(1 - (price - minBudget) / max(1, maxBudget - minBudget))`; reliability is basis points / 10000; distance is `clamp(1 - distance / min(briefRadius, serviceRadius))`.
- [x] Define explicit compatible tags: `cocktail -> [cocktail, polished]`, `formal -> [formal, black_tie]`, `semi_formal -> [semi_formal, polished]`, `festive -> [festive, statement]`; map the four event types to their same-named event tag. Unknown tags receive no compatibility credit but never trigger a hard filter.

  ```ts
  export function rankMatches(input: MatchInput): RankedMatch[] {
    return input.listings
      .filter((listing) => passesHardFilters(input.brief, listing))
      .map((listing) => scoreListing(input.brief, listing))
      .sort((a, b) => b.score - a.score || a.listingId.localeCompare(b.listingId))
      .slice(0, 3);
  }
  ```

- [x] Generate explanations only from deterministic facts, for example `Measurements allow 4-8 cm ease`, `Matches formal dress code`, and `$18 below your maximum`; never say `perfect fit` or infer body type.
- [x] Add property-style loops covering 100 generated candidates to prove scores remain 0–10000, changing input order does not change output order, and a lower reliability score cannot increase the reliability component.
- [x] Run the focused test and `npm run typecheck`; confirm all pass.
- [x] Commit: `feat: add explainable top-three matching`

## Task 6: Guard offer, reservation, and retry state changes

**Files:**

- Create: `src/lib/domain/state-machines.ts`
- Create: `src/lib/try-on/retry-policy.ts`
- Test: `tests/unit/state-machines.test.ts`
- Test: `tests/unit/retry-policy.test.ts`

- [x] Write failing transition tables for every allowed offer transition: `matched -> generating|expired`, `generating -> ready|failed|expired`, `ready -> reservation_requested|expired`, `reservation_requested -> accepted|declined`, and no transition out of `accepted|declined|expired|failed`.
- [x] Write failing reservation transition tables for `requested -> confirmed|cancelled`, then model but do not expose `confirmed -> ready_for_pickup -> in_use -> returned` and cancellation before `in_use`.
- [x] Run the two focused unit files and confirm they fail because the guard functions do not exist.
- [x] Implement `transitionOffer(current, next)` and `transitionReservation(current, next)` as pure functions returning the next state or throwing a typed `InvalidTransitionError` that contains states but no entity data.
- [x] Write retry-policy tests for HTTP 429, 500–599, network timeout, engine error, invalid input, attempt cap, and bounded jitter. Inject the random value so expected delays are deterministic.
- [x] Implement `classifyYouCamFailure` and `nextPollAt`. Use base delays `[2, 4, 8, 16, 30, 45]` seconds, at most 12 polls, ±20% jitter, and a hard 6-minute job deadline. Never create a new external task after `externalTaskId` exists.
- [x] Run both focused test files and `npm run typecheck`; confirm all pass.
- [x] Commit: `feat: guard marketplace and retry state transitions`

## Task 7: Validate and privately store image media

**Files:**

- Create: `src/lib/images/validate-image.ts`
- Create: `src/lib/storage/object-store.ts`
- Create: `src/lib/storage/s3-object-store.ts`
- Create: `src/app/api/media/[mediaId]/route.ts`
- Test: `tests/unit/validate-image.test.ts`
- Test: `tests/integration/privacy.test.ts`
- Fixture: `tests/fixtures/images/{valid-portrait.jpg,too-small.png,wrong-type.gif}`

- [x] Define `ObjectStore` with `putPrivate`, `getPrivate`, `delete`, and `createReadUrl`; its return values use opaque keys that are never serialized by API response schemas.

  ```ts
  export interface ObjectStore {
    putPrivate(input: { key: string; bytes: Uint8Array; contentType: "image/jpeg" | "image/png" }): Promise<void>;
    getPrivate(key: string): Promise<{ bytes: Uint8Array; contentType: string }>;
    delete(key: string): Promise<void>;
    createReadUrl(key: string, expiresInSeconds: number): Promise<string>;
  }
  ```

- [x] Write failing image tests for allowed MIME signatures, a mismatched extension/MIME signature, byte size `< 10_000_000`, minimum `512x384`, maximum side `4096`, and Sharp metadata failures.
- [x] Run `npm run test:unit -- tests/unit/validate-image.test.ts` and confirm the invalid fixtures are not yet rejected.
- [x] Implement `validateImage(bytes, declaredContentType)` using magic bytes plus Sharp metadata. Return normalized metadata or typed codes `unsupported_type`, `too_large`, `too_small`, `too_large_dimensions`, and `unreadable` with shopper-facing guidance.
- [x] Implement `S3ObjectStore` with private `PutObject`, `GetObject`, `DeleteObject`, and five-minute presigned GET URLs. Construct keys server-side as `briefs/{briefId}/source/{uuid}.{ext}`, `listings/{listingId}/garment/{uuid}.{ext}`, and `jobs/{jobId}/result/{uuid}.jpg`.
- [x] Write a privacy integration test against MinIO that uploads an object, proves anonymous HTTP GET is denied, proves the signed URL works, deletes it, and proves both direct and newly signed reads fail.
- [x] Implement the media Route Handler as an authenticated redirect to a newly signed URL after resource authorization. It accepts a database media ID, never an object key; providers can read their listing images but cannot read brief source images.
- [x] Run the focused unit/integration tests and inspect test output for signed URLs or secret values; confirm none appear.
- [x] Commit: `feat: validate and protect marketplace media`

## Task 8: Build the official YouCam Clothes v3 adapter

**Files:**

- Create: `src/lib/youcam/schemas.ts`
- Create: `src/lib/youcam/errors.ts`
- Create: `src/lib/youcam/client.ts`
- Create: `tests/fixtures/youcam/{file-ready.json,task-created.json,task-running.json,task-success.json,task-engine-error.json,rate-limited.json}`
- Test: `tests/contract/youcam-client.test.ts`

**Reference:** [Official AI Clothes Virtual Try-On guide](https://docs.perfectcorp.com/reference/ai_clothes/section/overview). The adapter must use the documented file registration -> presigned PUT -> task creation -> status polling flow.

- [x] Capture sanitized JSON fixtures for: file registration with `file_id` and upload request; task creation with `task_id`; running status; success with result URL; engine failure; and HTTP 429. Keep no real key or unexpired signed URL in the repository.
- [x] Write MSW contract tests proving the bearer token is sent only to `yce-api-01.makeupar.com`, the signed PUT receives the exact byte length and MIME type but no bearer token, and task creation uses the returned IDs.
- [x] Run `npm run test:unit -- tests/contract/youcam-client.test.ts` and confirm it fails because the adapter does not exist.
- [x] Define and Zod-parse the wire responses. Reject a 200 response with a malformed body as `invalid_upstream_response`; do not cast unvalidated JSON.
- [x] Implement this narrow interface:

  ```ts
  export interface ClothesV3Client {
    upload(bytes: Uint8Array, input: { fileName: string; contentType: "image/jpeg" | "image/png" }): Promise<string>;
    createTask(input: {
      sourceFileId: string;
      referenceFileId: string;
      garmentCategory: GarmentCategory;
    }): Promise<string>;
    getTask(taskId: string): Promise<
      | { status: "processing" }
      | { status: "success"; resultUrl: string }
      | { status: "error"; code: NormalizedYouCamError }
    >;
  }
  ```

- [x] Implement `upload` as `POST /s2s/v2.0/file/cloth-v3` with `files[{content_type,file_name,file_size}]`, mapping browser `image/jpeg` to YouCam's documented `image/jpg`, then perform the returned `PUT` with exactly the returned headers. Implement `createTask` with `src_file_id`, `ref_file_id`, and `garment_category`. Implement polling at `GET /s2s/v2.0/task/cloth-v3/{task_id}`.
- [x] Map documented engine codes into `invalid_source`, `invalid_reference`, `unsafe_content`, `download_failed`, `engine_failed`, `rate_limited`, `transient_upstream`, or `invalid_upstream_response`; attach `retryable` based on Task 6 policy.
- [x] Add tests proving an API-key substring, upload URL query string, and source bytes do not appear in error messages. Abort each fetch after 15 seconds.
- [x] Run the contract test, typecheck, and lint; confirm all pass.
- [x] Commit: `feat: add YouCam Clothes v3 adapter`

## Task 9: Persist and advance idempotent try-on jobs

**Files:**

- Create: `src/lib/try-on/orchestrator.ts`
- Create: `src/lib/repositories/marketplace.ts`
- Test: `tests/integration/brief-flow.test.ts`

- [x] Define repository transaction methods `createMatchesAndJobs`, `claimDueJobs`, `recordExternalTask`, `schedulePoll`, `completeJob`, and `failJob`. Claim with `SELECT ... FOR UPDATE SKIP LOCKED` and compare the persisted state in every update.
- [x] Write an integration test where creating a canonical brief produces exactly three matches, three offers in `matched`, and three unique jobs in `queued`; submitting the same idempotency key returns the same IDs and count.
- [x] Run `npm run test:integration -- tests/integration/brief-flow.test.ts` and confirm it fails before the repository exists.
- [x] Implement `createMatchesAndJobs` in one transaction: load active candidates, call the pure matcher, insert match breakdowns/explanations, insert one job and offer per match, and persist the command idempotency key.
- [x] Extend the test with a fake `ClothesV3Client` and in-memory `ObjectStore`: successive advances upload and persist the source file ID, upload and persist the reference file ID, create and persist one task ID, report processing, then download/copy the result, mark the job `succeeded`, and change the offer to `ready`.
- [x] Implement `TryOnOrchestrator.advanceBrief(briefId, now)` with a concurrency cap of three and at most one lifecycle phase per claimed job per request. Resume from the first missing persisted file/task ID; if an external task ID exists, only poll it and never upload or recreate the task.
- [x] Add a partial-failure test where the middle job receives `invalid_reference`; assert only its job/offer fail and the other two reach ready. Add a retry test where 429 changes only `attemptCount` and `nextPollAt`.
- [x] Implement result-copy recovery: if downloading the result URL returns expired/forbidden, call `getTask(externalTaskId)` once for a fresh URL, then copy; if it still fails, schedule a retry without losing the task ID.
- [x] Run the focused integration test and `npm run typecheck`; confirm all pass.
- [x] Commit: `feat: orchestrate persisted virtual try-on jobs`

## Task 10: Add signed demo sessions and authorized repositories

**Files:**

- Create: `src/lib/auth/demo-session.ts`
- Create: `src/app/api/demo/session/route.ts`
- Create: `src/lib/repositories/briefs.ts`
- Create: `src/lib/repositories/listings.ts`
- Test: `tests/unit/demo-session.test.ts`
- Test: `tests/integration/authorization.test.ts`

- [x] Write failing tests for a valid HMAC-signed session, tampered user/role/expiry values, expiration, unknown seeded user, and cookie attributes `HttpOnly`, `SameSite=Lax`, `Secure` in production, and `Path=/`.
- [x] Run `npm run test:unit -- tests/unit/demo-session.test.ts` and confirm it fails.
- [x] Implement `createDemoSession` and `readDemoSession` with Node `crypto.createHmac("sha256", SESSION_SECRET)`, constant-time signature comparison, a one-hour expiry, and a payload containing only `userId`, `role`, and `expiresAt`.
- [x] Implement `POST /api/demo/session` accepting a seeded `userId`, verifying its role from PostgreSQL, issuing the cookie, and redirecting shoppers to `/request/new` or providers to `/provider`. Return 404 for arbitrary IDs.
- [x] Create repository methods for owner-scoped brief reads/deletes and provider-scoped listing/request reads. Require an `Actor` parameter in every method instead of relying on callers to remember a filter.
- [x] Write integration tests proving shopper A cannot read or delete shopper B's brief, a shopper cannot create a listing, provider A cannot mutate provider B's listing/request, and providers never receive `shopperMediaId` or `measurementProfile`.
- [x] Implement authorization in the repository query itself; return `NotFound` for both missing and unauthorized resources so ID enumeration does not reveal existence.
- [x] Run both focused test files and lint; confirm all pass.
- [x] Commit: `feat: add authorized demo marketplace sessions`

## Task 11: Build the shopper brief API and recoverable form

**Files:**

- Create: `src/app/api/briefs/route.ts`
- Create: `src/app/api/briefs/[briefId]/route.ts`
- Create: `src/app/api/briefs/[briefId]/offers/route.ts`
- Create: `src/app/api/briefs/[briefId]/process/route.ts`
- Create: `src/app/request/new/page.tsx`
- Create: `src/components/brief/brief-form.tsx`
- Create: `src/components/brief/image-guidance.tsx`
- Test: `tests/integration/brief-api.test.ts`
- Test: `tests/unit/brief-form.test.tsx`

- [x] Write Route Handler tests for unauthenticated rejection, malformed multipart data, invalid photo, consent false, successful creation, duplicate idempotency key, no matches, and storage/database rollback cleanup.
- [x] Run `npm run test:integration -- tests/integration/brief-api.test.ts` and confirm it fails before the route exists.
- [x] Implement `POST /api/briefs` as multipart data with `command` JSON and `photo` file. Authenticate shopper, parse command, validate bytes, create the brief ID, store the photo privately, insert the brief/matches/jobs/offers transactionally, and delete the object if the database transaction fails.
- [x] Return `201 { briefId, outcome: "matched", matchCount }` or `201 { briefId, outcome: "no_matches", eliminatedBy }`. Calculate `eliminatedBy` by rerunning hard filters independently and return only counts by adjustable constraint.
- [x] Implement owner-only `GET /api/briefs/[briefId]`, JSON `PATCH /api/briefs/[briefId]`, multipart `PUT /api/briefs/[briefId]`, `GET .../offers`, and `POST .../process`. PATCH permits only radius, maximum budget, garment category, and preferred colors. PUT replaces only the source photo after validation/consent. Each increments `matchingRevision`, expires unselected earlier offers, and creates new matches/jobs; photo replacement deletes the prior Relay object after the database commit. The process route calls `advanceBrief`, returns only the current revision's offer read models, and rate-limits each brief to one advance per two seconds.
- [x] Write component tests for required fields, inline validation, photo preview/removal, affirmative consent, disabled submit while pending, preservation of all non-photo fields after an invalid image, and redirect to the returned brief.
- [x] Implement a three-section form: `Your event`, `Your measurements`, and `Your photo`. Fields are event type/date, dress code, budget min/max, category, size label, bust/waist/hips, desired ease, location band/radius, preferred colors, style tags, exclusions, image, and consent.
- [x] Put the official capture requirements next to the file input: JPEG/PNG, under 10 MB, at least 512x384, one forward-facing adult, face and intended clothing area visible, and person occupying most of the frame. Say that automatic person/composition validation happens at YouCam and may require a replacement photo.
- [x] Run the focused integration/component tests, typecheck, and lint; confirm all pass.
- [x] Commit: `feat: create recoverable shopper event briefs`

## Task 12: Render live offer progress, comparison, and no-match recovery

**Files:**

- Create: `src/app/briefs/[briefId]/page.tsx`
- Create: `src/components/offers/offer-progress.tsx`
- Create: `src/components/offers/offer-grid.tsx`
- Create: `src/components/offers/offer-card.tsx`
- Modify: `src/components/brief/brief-form.tsx`
- Test: `tests/unit/offer-grid.test.tsx`
- Test: `tests/integration/offer-read-model.test.ts`

- [x] Write read-model tests proving offers are score-ordered, never exceed three, include signed original/result URLs only when authorized, and serialize `failed` without leaking normalized upstream detail.
- [x] Write component tests for all-matched, generating, one-ready, partial-failure, all-ready, all-failed, expired-image-refresh, and no-match states. Assert screen-reader live-region text changes without replacing the whole page.
- [x] Run both focused tests and confirm they fail.
- [x] Implement the server page with the first authorized snapshot and a client `OfferProgress` island. While any job is actionable, POST to `process` no faster than every two seconds with exponential UI backoff; then GET offers. Stop on all terminal states or after six minutes and show a manual retry control.
- [x] Render each card with generated preview when ready, original garment image, garment title/measurements/size/condition, rental and displayed deposit, provider type, distance band, pickup method, score explanations, and the mandatory fit disclaimer.
- [x] Make partial success the normal layout: ready cards are actionable, generating cards retain their positions, and failed cards show the original garment plus `Preview unavailable—garment can still be reviewed` without blocking other cards.
- [x] Add no-match controls that prefill the existing brief and PATCH radius, maximum budget, category, or color. The response returns the incremented matching revision; the UI begins polling that revision without requiring another photo upload, while earlier matches remain expired audit records.
- [x] When a result image URL expires, GET the offer endpoint to issue a fresh Relay signed URL. Never pass a YouCam result URL to the browser.
- [x] Run focused tests, typecheck, lint, and manually verify the layout at 390x844 and 1440x900.
- [x] Commit: `feat: present live explainable try-on offers`

## Task 13: Complete provider listings and the reservation handshake

**Files:**

- Create: `src/app/api/listings/route.ts`
- Create: `src/app/api/listings/[listingId]/route.ts`
- Create: `src/app/api/offers/[offerId]/reserve/route.ts`
- Create: `src/app/api/reservations/[reservationId]/accept/route.ts`
- Create: `src/app/api/reservations/[reservationId]/decline/route.ts`
- Create: `src/app/provider/page.tsx`
- Create: `src/app/provider/listings/new/page.tsx`
- Create: `src/app/provider/requests/[offerId]/page.tsx`
- Create: `src/app/reservations/[reservationId]/page.tsx`
- Create: `src/components/provider/listing-form.tsx`
- Create: `src/components/provider/request-card.tsx`
- Create: `src/components/reservation/reservation-timeline.tsx`
- Test: `tests/integration/reservation-flow.test.ts`
- Test: `tests/unit/reservation-timeline.test.tsx`

- [x] Write integration tests that create and edit an owned provider listing, increment its version, expire nonterminal offers made from the prior version, reject missing measurements/photo, reject another provider's edit, reject edits during a requested/confirmed reservation, request a ready offer once, expire its competing offers, return the same reservation on duplicate request, reject a second selected offer, reject the wrong provider, accept exactly once, and cover decline as `offer=declined` plus `reservation=cancelled`.
- [x] Run `npm run test:integration -- tests/integration/reservation-flow.test.ts` and confirm it fails.
- [x] Implement provider-only multipart `POST /api/listings`, metadata `PATCH /api/listings/[listingId]`, and image `PUT /api/listings/[listingId]` with private upload and the same compensating-delete pattern as briefs. Validate title, category, size, four measurements, condition, color/style tags, cents, service radius/location, unavailable ranges, and image; authorize ownership in the update query. Reject edits while the listing has a requested or confirmed reservation; otherwise increment the listing version and expire nonterminal offers/jobs tied to older versions.
- [x] Implement shopper-only reservation request plus provider-only accept/decline commands inside serializable database transactions. On selection, create the reservation, move the chosen offer to `reservation_requested`, expire nonterminal competing current-revision offers, and stop their unfinished jobs as `failed` with internal code `superseded`. Accept moves states to `accepted`/`confirmed`; decline moves them to `declined`/`cancelled`. Derive pickup as event date minus one local day and return as event date plus one local day, store UTC timestamps, and never accept client-provided shopper/provider/price IDs.
- [x] Build the provider dashboard with provider type, active listings, qualified requests, no shopper photograph, no body measurements, and no exact address. Show event type/date, dress code, size label, listing, dates, rental price, and request status.
- [x] Build create/edit listing modes and request detail. Accept and decline require separate confirmation text; both buttons disable after either terminal result, and duplicate browser clicks render the same reservation.
- [x] Write timeline component tests for `requested`, `confirmed`, and `cancelled`; include `Reservation simulation—no payment has been collected`, pickup/return dates, rental amount, displayed deposit, and a single current-state announcement.
- [x] Build shopper reservation page with the same timeline, provider display name/type, garment, and return expectations. Do not render controls for deferred operational states.
- [x] Run focused tests, typecheck, lint, and a manual two-browser shopper/provider handshake.
- [x] Commit: `feat: complete two-sided reservation handshake`

## Task 14: Implement deletion, failure recovery, and operational safeguards

**Files:**

- Modify: `src/app/api/briefs/[briefId]/route.ts`
- Modify: `src/components/brief/brief-form.tsx`
- Modify: `src/lib/repositories/briefs.ts`
- Modify: `src/lib/try-on/orchestrator.ts`
- Create: `src/lib/http/errors.ts`
- Test: `tests/integration/privacy.test.ts`
- Test: `tests/integration/failure-recovery.test.ts`

- [x] Add failing deletion tests for an owned brief with source plus two generated results. Assert database media references are nulled, every Relay object is deleted, signed reads stop working, offers retain non-image audit status, and an unauthorized actor changes nothing.
- [x] Add failure tests for invalid source, invalid reference, 429, 503, timeout, malformed 200, engine error, expired result URL, duplicate poll, and the six-minute deadline.
- [x] Run the two focused integration files and confirm the new cases fail.
- [x] Implement `DELETE /api/briefs/[briefId]` as owner-only and idempotent. First mark the brief `deleting` and clear usable media references transactionally; then best-effort delete objects; persist deletion completion/errors for safe retry.
- [x] Return deletion copy that distinguishes Relay deletion from upstream retention: `Relay has deleted its stored copies. Perfect Corp. may retain API files for up to 30 days under its documented policy.`
- [x] Implement a single HTTP error mapper for validation 400, unauthenticated 401, not-found/unauthorized 404, conflict 409, request-too-large 413, rate-limited 429, and unexpected 500. Each response includes a safe stable code and request ID, never stack trace or upstream body.
- [x] Finish orchestrator and UI error behavior: invalid source exposes the existing photo-only replacement control with all brief fields preserved; invalid reference flags only the provider listing with image guidance; retryable errors preserve the external task; permanent errors fail only the affected offer; deadline expiry stops polling and enables manual retry.
- [x] Add idempotency pruning for command keys older than seven days and a maximum of three concurrent YouCam actions per brief, remaining below the documented 250 requests/300 seconds limit.
- [x] Run focused tests, full integration suite, and inspect logs from the failure run for secrets, URLs, source bytes, or measurement values.
- [x] Commit: `feat: add privacy deletion and resilient failures`

## Task 15: Polish the judged experience and prove it end to end

**Files:**

- Modify: `src/app/globals.css`
- Modify: all pages/components under `src/app` and `src/components`
- Create: `tests/e2e/relay-flow.spec.ts`
- Create: `tests/e2e/accessibility.spec.ts`
- Test: `tests/e2e/relay-flow.spec.ts`
- Test: `tests/e2e/accessibility.spec.ts`

- [ ] Establish the visual tokens in CSS: warm paper `#F7F3EC`, ink `#14251C`, Relay green `#176B51`, coral action accent `#D75F4A`, muted gold `#B78A35`, 16px cards, high-contrast focus rings, and restrained motion that respects `prefers-reduced-motion`.
- [ ] Use an editorial marketplace composition: concise serif display headings with system sans-serif controls, real garment imagery, visible pricing, dense useful metadata, and one primary action per screen. Avoid gradients, glass effects, anonymous stock portraits, and decorative AI imagery.
- [ ] Write a Playwright shopper/provider test using the fake YouCam adapter: select shopper, create brief with fixture photo, watch three offers resolve, request the top offer, switch to its provider, accept, switch back, and assert confirmed timeline.
- [ ] Add E2E scenarios for invalid photo recovery, one failed preview beside two successes, no-match widening, duplicate clicks, direct unauthorized URL, brief deletion, and mobile viewport.
- [ ] Write accessibility assertions for landmarks, heading order, labels/descriptions, keyboard-only completion, visible focus, live status announcements, dialog focus return, 44px touch targets, color-independent state, descriptive image alt text, and no horizontal scroll at 320px.
- [ ] Run `npm run test:e2e` and confirm the new scenarios fail before polish is complete.
- [ ] Implement missing responsive, keyboard, loading, empty, partial-failure, and focus behaviors. Use skeletons only for fixed content regions and keep submit/accept text stable while disabled.
- [ ] Rerun E2E at Chromium desktop and mobile; manually inspect Safari/Firefox-compatible behavior through Playwright projects if configured.
- [ ] Commit: `test: verify Relay marketplace journeys end to end`

## Task 16: Deploy, validate real YouCam, and prepare the Devpost submission

**Files:**

- Modify: `README.md`
- Create: `docs/submission/demo-script.md`
- Create: `docs/submission/devpost-copy.md`
- Create: `docs/submission/release-checklist.md`
- Create: `.github/workflows/ci.yml`
- Test: production deployment and manual real-API smoke test

- [ ] Write `README.md` with product thesis, architecture diagram, prerequisites, exact local setup, Docker startup, migrations/seeding, fake/live YouCam modes, test commands, privacy model, limitations, deployment variables, and troubleshooting for photo/rate-limit failures.
- [ ] Add CI on pull requests and pushes: `npm ci`, typecheck, lint, unit/contract tests, PostgreSQL-backed integration tests, production build, then Playwright with the fake adapter. Upload Playwright traces only on failure and ensure fixtures contain no personal image.
- [ ] Provision a production PostgreSQL database and private S3-compatible bucket; set all `.env.example` variables in the host; use a new 32+ byte session secret; set `DEMO_MODE=true`, `YOUCAM_MODE=live`, `APP_TIME_ZONE=America/Chicago`; never prefix server secrets with `NEXT_PUBLIC_`.
- [ ] Deploy to Vercel, run migrations once, run the idempotent seed once, and verify anonymous access to object storage returns denied. Configure the public deployment URL in Playwright's smoke target.
- [ ] With a consented, non-sensitive test image and the real key, perform one full Clothes v3 run. Confirm file registration, presigned PUT, task creation, bounded status polling, private result copy, ready offer, reservation request, provider acceptance, fresh signed Relay URL, and source/result deletion.
- [ ] Record measured latency, task ID suffix, result status, and normalized errors in `release-checklist.md`; do not record full task ID, signed URL, image, API key, or measurement profile.
- [ ] Draft `demo-script.md` to fit 1–3 minutes: 0:00 problem/market, 0:15 shopper brief, 0:40 explainable matches and real VTO, 1:15 reservation request, 1:35 provider acceptance, 1:55 confirmed timeline, 2:10 18% commission hypothesis/impact, 2:30 trust/limits/close.
- [ ] Draft `devpost-copy.md` with title/tagline, problem, solution, how built, YouCam integration, two-sided business model, potential impact, challenges, accomplishments, lessons, next steps, repository/test instructions, and explicit deferred features. Do not claim guaranteed fit, return reduction, environmental reduction, or live marketplace supply.
- [ ] Capture desktop and mobile screenshots of the real result, comparison, provider request, and confirmed timeline; create a public 1–3 minute video; verify repository visibility and working demo access in an incognito browser.
- [ ] Run the release gate from a clean install:

  ```bash
  npm ci
  npm run typecheck
  npm run lint
  npm run test:unit
  npm run test:integration
  npm run build
  npm run test:e2e
  ```

- [ ] Check the deployed flow against all four equally weighted judging criteria: technological implementation, design, potential impact, and quality of idea. Record pass/fail evidence in `release-checklist.md`.
- [ ] Commit: `docs: prepare Relay release and Devpost submission`

---

## Release Acceptance Gate

Implementation is complete only when all of the following are true:

- [ ] A fresh clone can install, migrate, seed, test, build, and start from the README.
- [ ] One real YouCam Clothes v3 result is generated through the documented file registration, signed PUT, create-task, and poll flow.
- [ ] A shopper gets no more than three deterministic, explainable offers and can request one reservation.
- [ ] The owning provider can accept once; another provider cannot see private shopper data or accept it.
- [ ] Original and generated images are private, served through short-lived Relay URLs, and deleted through the privacy control.
- [ ] Invalid images, no matches, partial YouCam failure, rate limiting, duplicate actions, expired result URLs, and unauthorized access are visibly and safely handled.
- [ ] The production deployment works in an incognito browser at mobile and desktop widths.
- [ ] The repository, screenshots, Devpost copy, public 1–3 minute video, working link, and test access are ready before August 17, 2026 at 11:45 AM EDT.

## Post-Hackathon Boundary

Do not pull payments, payouts, shipping, damage protection, identity verification, reviews, messaging, notifications, fraud scoring, multi-city search, dynamic pricing, Skin AI, or native mobile into this plan. The next production tranche begins only after validating brief completion, valid-photo rate, VTO success/latency, reservation conversion, provider acceptance, completed reservation, repeat usage, contribution margin, and whether a rental actually displaced a new purchase.
