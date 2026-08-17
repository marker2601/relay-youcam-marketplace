# Relay final-voice release verification

Verified locally on August 16, 2026. Status: **PASS for local release gates; publication pending**.

## Exact candidate

- File: `docs/submission/assets/relay-professional-demo-v2.mp4`
- SHA-256: `60FE80A9308E48E5FF3835279DB7E9BD177332B39D27D44635D27BA2DE62213B`
- Size: 12,617,548 bytes
- Duration: 160.933333 seconds
- Frames: 4,828 decoded of 4,828 at 30 fps
- Video: H.264, 1920x1080, `yuv420p`
- Audio: AAC, stereo, 48 kHz
- MP4 atoms: `ftyp` -> `moov` -> `mdat`

The installed exact-master verifier passed the stream contract, exact duration, full-frame decode, and atom-order checks. Independent FFprobe packet/frame reads agreed with the verifier.

## Audio and continuity

- EBU R128 integrated loudness: -16.0 LUFS
- True peak: -1.9 dBFS
- `silencedetect=noise=-45dB:d=1.2`: no interval reported
- `blackdetect=d=0.2:pix_th=0.10`: no interval reported

Sequential raw-RGB decoding matched independent seeking at all five required positions:

| Position | Frame | Timestamp | MD5 |
| --- | ---: | ---: | --- |
| 12% | 579 | 19.300000 s | `b8b8fce54b3f6013f376cf59b77e52bd` |
| 35% | 1,690 | 56.333333 s | `9e524601cd9a08d2071ff9f7944bcf9c` |
| 60% | 2,897 | 96.566667 s | `57e1549b3ded23a7c6ad2084035fc35e` |
| 84% | 4,056 | 135.200000 s | `13b6ebabf2529aaf6fa64c6d4633d15b` |
| 98% | 4,731 | 157.700000 s | `b613c826fc3a7a1d96b0464c0dce0995` |

## ASR, captions, and visual review

Full ASR of the exact MP4 used the existing local `ggml-base.en.bin` model. It preserved the approved hook meaning; Relay's reliability-layer and discovery-versus-outcome promise; YouCam Clothes v3, signed-upload, bounded-retry, and private-result meaning; the primary decline, backup activation/acceptance, and Event ready sequence; literal `This prototype collects zero dollars`; literal `It does not process payments`; both no-guarantee disclosures; and the 18% commission hypothesis. The base model rendered some YouCam and idempotency terms phonetically, while the binding meaning remained present and matched the authored captions.

The timing/provenance audit found eight valid non-overlapping chapters and 49 valid non-overlapping captions. Captions have at most two lines, a maximum line length of 43 characters, and a caption JSON SHA-256 matching the ASS marker SHA-256: `57F09FAD3022DEFB523AFA167D4C1D0AEE94573D0963BE67EA2D848A4DB4FD05`.

All 49 caption midpoints were inspected at native 1920x1080 resolution. The former long cue is now three complete, unclipped chunks:

- 118.422-123.116 seconds: `Under the hood, Relay registers shopper and` / `garment files, follows YouCam's signed`
- 123.116-127.744 seconds: `upload instructions, creates each Clothes` / `version three task, polls with bounded`
- 127.744-131.248 seconds: `retries, and copies successful results into` / `private storage.`

First/middle/final frames for all eight chapters (24 frames) and all six story overlays (18 frames) were inspected. Product proof and active controls remained readable; captions were complete; shopper was gold, primary was coral, and backup was green. No credential, task ID, signed URL, private key, local path, unrelated browser content, or other secret-bearing material was visible.

## Repository verification

The repository's PostgreSQL and MinIO services were recreated with fresh volumes, migrated, initialized, and seeded through the documented workflow. No stale repository test process was present before the run.

- `npm.cmd test -- tests/unit/professional-demo-v2.test.ts`: 1 file, 31/31 passed
- `npm.cmd run typecheck`: passed
- `npm.cmd run lint`: passed with 0 errors and 3 known unused-fixture warnings
- `npm.cmd run test:unit`: 19 files, 213/213 passed
- `npm.cmd run test:integration`: 10 files, 77/77 passed with the repository's single-worker integration script
- `npm.cmd test`: 29 files, 290/290 passed
- `npm.cmd run build`: passed with Next.js 16.3.1
- `git diff --check`: passed

The first seed attempt occurred before migrations and failed because the fresh database had no schema. Running the complete documented order (`db:migrate`, then `db:seed`) passed; all subsequent repository suites passed cleanly.

## Release state

This report verifies only the local candidate above. No upload, publication, push, Devpost change, or submission was performed. The prior public video remains unchanged until a coordinator performs the separate publication step.
