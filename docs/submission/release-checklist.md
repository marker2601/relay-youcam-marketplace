# Relay release checklist

Last updated: August 15, 2026. This document separates verified evidence from work that still requires production credentials or human assets.

## Automated release evidence

- [x] Strict TypeScript: `npm run typecheck`.
- [x] ESLint: `npm run lint`.
- [x] Unit/contract/component suite: 15 files, 134 tests passed.
- [x] PostgreSQL integration suite: 10 files, 55 tests passed.
- [x] Next.js production build completed successfully.
- [x] Playwright: 14/14 Chromium desktop/mobile journeys passed.
- [x] E2E fixtures contain no personal image; they reuse an original project-generated garment asset and an in-memory synthetic invalid image.
- [x] Secret scan found no API key, cloud credential, private key, signed URL, or `.env` file in tracked source.
- [x] Local bucket initialization disables anonymous access; a direct known-object request returned HTTP 403.

## Functional and trust evidence

- [x] At most three deterministic offers with visible score explanations.
- [x] Shopper request and owning-provider acceptance converge on one confirmed reservation.
- [x] Duplicate reserve/accept clicks return one durable resource.
- [x] Another role cannot read a private brief or mutate its reservation.
- [x] Providers cannot fetch the shopper's source image or measurement profile.
- [x] Invalid photo recovery preserves the remaining brief.
- [x] No-match widening does not require another upload.
- [x] One failed preview remains isolated beside two requestable offers.
- [x] Expired result URLs receive one refresh attempt before a bounded retry.
- [x] Deletion revokes Relay media references before best-effort object cleanup.
- [x] The UI states YouCam's maximum 30-day upstream retention separately from Relay deletion.
- [x] The generated result always carries the appearance-not-fit disclaimer.
- [x] Reservation screens clearly state that payment has not been collected.

## Production infrastructure gate

- [ ] Provision a TLS PostgreSQL database.
- [ ] Provision a private S3-compatible bucket with least-privilege credentials.
- [ ] Verify anonymous `GET` to a known production object returns `403`/`AccessDenied`.
- [ ] Generate a new 32+ byte `SESSION_SECRET`.
- [ ] Configure every production variable listed in `.env.example` as a server-only secret/value.
- [ ] Set `APP_TIME_ZONE=America/Chicago`, `DEMO_MODE=true`, and `YOUCAM_MODE=live`.
- [ ] Link the Vercel project and deploy a preview.
- [ ] Run `npm run db:migrate` once against production.
- [ ] Run the idempotent `npm run db:seed` once against production.
- [ ] Validate the preview, then promote that exact artifact to production.
- [ ] Put the production URL in `PLAYWRIGHT_BASE_URL` and run a smoke target.

Current blocker: no production PostgreSQL URL, S3 endpoint/credentials, or YouCam API key is available in this workspace. A static Vercel shell would not prove the judged flow, so no deployment is labeled ready until these server resources are configured.

## Real YouCam Clothes v3 smoke record

Use one consented, non-sensitive test image. Record only the fields below—never the key, image, full task ID, signed URL, object key, upload headers, or measurement profile.

| Check | Result |
| --- | --- |
| File registration succeeded | **Pending real key** |
| Signed source/reference PUT succeeded | **Pending real key** |
| Task creation succeeded | **Pending real key** |
| Bounded polling reached terminal status | **Pending real key** |
| Result copied to private Relay storage | **Pending real key** |
| Offer became ready | **Pending real key** |
| Reservation request + provider acceptance succeeded | **Pending production deployment** |
| Fresh signed Relay result URL authorized | **Pending production deployment** |
| Source and result deletion made Relay URLs unavailable | **Pending production deployment** |
| End-to-end latency | **Pending; record rounded seconds only** |
| Task ID suffix | **Pending; last 6 characters only** |
| Terminal result status | **Pending** |
| Normalized errors observed | **Pending; code names only** |

## Devpost requirements

- [x] Account authenticated and registered for the YouCam API hackathon.
- [x] Repository URL prepared.
- [x] Text description covers features, functionality, and consumer/retail value.
- [x] Public repo/license path prepared; final visibility change remains gated on the last secret scan.
- [ ] Add the production demo URL (a website is optional in the official form, but useful to judges).
- [ ] Capture 3–5 screenshots from the functioning app, including one real generated result.
- [ ] Record a public 1–3 minute YouTube/Vimeo/Youku video with the YouCam API explained.
- [ ] Confirm the video contains no unlicensed music, third-party marks, credentials, or private URLs.
- [ ] Fill submitter type and country of residence.
- [ ] Optionally add a social post URL.
- [ ] Submit before August 17, 2026 at 11:45 AM EDT.

## Four-criterion judging gate

| Criterion | Evidence | Status |
| --- | --- | --- |
| Technological implementation | Typed Clothes v3 client; persisted top-three orchestration; schema-validated contracts; retries, refresh, private copy, deletion; 189 unit/integration tests. | **Conditional pass** — real-key smoke still required |
| Design | Complete shopper/provider loop; editorial responsive UI; accessible focus/labels/live regions; independent failure states; 14 E2E journeys. | **Pass** |
| Potential impact | Specific occasionwear audience, two compatible provider types, one-city liquidity wedge, 18% commission hypothesis, measurable outcomes without unsupported claims. | **Pass** |
| Quality of idea | Demand-first marketplace uses VTO as trust infrastructure across fragmented circular inventory, not a catalog wrapper. | **Pass** |

## Media and final audit

- [ ] Desktop shortlist screenshot with real result.
- [ ] Mobile comparison screenshot with real result and disclaimer.
- [ ] Provider request screenshot without shopper media.
- [ ] Confirmed timeline screenshot.
- [ ] Privacy/deletion screenshot.
- [ ] Public video URL added to `docs/submission/devpost-copy.md`.
- [ ] Public demo URL added to README and Devpost copy.
- [ ] Fresh secret/history scan passes.
- [ ] Repository is public, or `contact_event@PerfectCorp.com` has access while it remains private.
- [ ] Incognito clone/setup and demo access verified.
- [ ] GitHub Actions is green on the final commit.

## Clean release gate

```bash
npm ci
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e
```
