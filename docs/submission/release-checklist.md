# Relay Rescue release checklist

Last updated: August 16, 2026. This separates fresh local evidence, previously completed production checks, and release actions still owned by the coordinator.

## Fresh local verification

- [x] Strict TypeScript: `npm.cmd run typecheck` exited 0.
- [x] ESLint: `npm.cmd run lint` exited 0 with zero errors and three known negative-fixture unused-variable warnings.
- [x] Full Vitest suite: 28 files and 259 tests passed.
- [x] Next.js 16.3.1 production build compiled and generated all routes successfully.
- [x] Full Playwright suite: 16/16 desktop/mobile/accessibility scenarios passed, including decline-to-backup recovery.
- [x] Exact tracked-artifact and secret-pattern checks were inspected: only the intentionally tracked `.env.example` matched the artifact expression; assignment matches were safe placeholders or command documentation, with no production values.
- [x] CI pins Node.js 20; repository dependencies require Node 20.19 or newer, which is compatible with the configured Node 20 runner.

## Relay Rescue behavior gate

- [x] The home page leads with the exact reliability promise.
- [x] Briefs require an explicit America/Chicago event time in the next 90 days.
- [x] A three-match plan assigns one primary and prefers an independent-provider backup.
- [x] Readiness totals are bounded and component labels are visible.
- [x] Requesting the primary preserves the backup and expires only alternatives.
- [x] Provider requests show urgency, response deadline, and that a backup exists without identifying its provider.
- [x] Decline and timeout permit one authorized, idempotent backup activation.
- [x] Backup activation reuses the existing preview and requires no new upload.
- [x] The independent backup provider can accept and the shopper reaches **Event ready**.
- [x] Providers never receive shopper source media or measurement profiles.
- [x] Photo deletion still revokes source and generated Relay media.
- [x] The UI states that previews show appearance/styling, not guaranteed physical fit.
- [x] Reservation screens state that no payment has been collected.

## Production evidence and release operations

- [x] Production URL exists: https://relay-youcam-marketplace.vercel.app.
- [x] Production PostgreSQL and private object storage were configured before this documentation task.
- [x] RLS was enabled with no public policies before this documentation task.
- [x] A real YouCam Clothes v3 success path was completed within the approved credit budget before this documentation task.
- [x] Push the final reviewed commit and deploy it through the existing Vercel project.
- [x] Run the production smoke suite against the exact deployed commit.
- [x] Re-run one real YouCam success path on that deployed commit within the approved credit budget.
- [x] Verify anonymous access to a known production object returns `403`/`AccessDenied`.
- [x] Verify the full primary-decline-backup-acceptance path produces no browser/runtime errors in production.

## Required visual assets

- [x] Hero screenshot visibly includes both exact sentences: **Relay is the reliability layer for time-sensitive fashion. Discovery apps show possibilities; Relay makes sure you have something to wear.**
- [x] Primary and independent backup real YouCam previews.
- [x] Primary decline followed by visible **Backup available**.
- [x] Backup provider acceptance followed by **Event ready**.
- [x] Submission thumbnail derived from project-owned assets.
- [x] Public 2:21 1080p professional YouTube demo showing and explaining YouCam: https://youtu.be/K_iLJKMcykg.
- [x] Unauthenticated fetch verifies the final video URL is public.

Use `docs/submission/relay-rescue-shot-list.md` for framing and privacy checks.

## Devpost form gate

- [x] Repository URL: https://github.com/marker2601/relay-youcam-marketplace.
- [x] Public demo URL: https://relay-youcam-marketplace.vercel.app.
- [x] Product description, API surprise, underexplored use case, and technical wall are drafted truthfully.
- [x] Project start date derived from git history: August 14, 2026.
- [x] App status is documented as an existing Relay prototype with a major Rescue update begun August 16, 2026.
- [x] Submitter type supplied: Individual.
- [x] Country of residence supplied: United States.
- [x] Add final screenshots, thumbnail, and public video URL.
- [x] Confirm repository visibility or judge access.
- [x] Confirm the exact submitted copy contains no guarantees or unimplemented retailer-return claim.
- [ ] Obtain the user's final explicit `yes, submit` immediately before the irreversible submit action.
- [ ] Submit before August 17, 2026 at 15:45 UTC.

## Four-criterion judging gate

| Criterion | Evidence | Status before final production pass |
| --- | --- | --- |
| Technological implementation | Typed Clothes v3 adapter; persisted jobs and private copy; stable assurance roles; bounded readiness; transactional expiry and idempotent failover; deterministic recovery E2E. | Local, CI, production smoke, and real YouCam path passed |
| Coherent design | One visible promise connects the brief, primary/backup plan, provider deadline, recovery, and **Event ready** outcome. | Implemented and uploaded with four production screenshots |
| Potential impact | Bounded occasionwear wedge, independent-provider resilience, 18% commission hypothesis, measurable conversion and completion outcomes. | Copy ready; market validation remains a hypothesis |
| Quality/non-obviousness | YouCam is the visual trust layer inside a demand-first, failure-tolerant two-sided marketplace rather than a catalog widget. | Implemented; public 2:21 professional video proof live |

## Exact local release commands

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e

git status --short
git ls-files | rg "(^|/)\.env($|\.)|\.vercel/|node_modules/|test-results/|playwright-report/"
rg -n --hidden -g '!node_modules/**' -g '!.git/**' "YOUCAM_API_KEY=|S3_SECRET_ACCESS_KEY=|SESSION_SECRET=" .
```
