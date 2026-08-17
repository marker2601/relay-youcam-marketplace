# Relay Professional Demo V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Relay's current submission video with a verified 1–3 minute release that uses a friendly, upbeat female neural voice and Human Handoff character animations over real production footage.

**Architecture:** Keep the existing production capture as the evidence layer. Generate narration chapter-by-chapter with pinned `edge-tts`, derive deterministic chapter/caption timing, generate a separate ASS vector-motion layer from typed cue data, and combine capture, motion, captions, and normalized audio with FFmpeg. Preserve the current public video and Devpost link until the replacement passes local, public, and Devpost readback gates.

**Tech Stack:** PowerShell 5.1, `uvx`, `edge-tts==7.2.8`, TypeScript 6, `tsx`, Vitest 4, FFmpeg/FFprobe, YouTube Studio, Devpost connector.

## Global Constraints

- Final duration must be 1:00–3:00; target 2:10–2:40.
- Final format must be H.264 `yuv420p`, 1920×1080, constant 30 fps, AAC stereo 48 kHz, and fast-start MP4.
- Voice must be friendly, upbeat, female, natural, and approximately 135–150 spoken words per minute.
- Audio target is approximately -16 LUFS integrated with true peak no higher than -1.5 dBFS.
- Product footage must remain visible throughout substantive claims; overlays may not obscure critical application controls or proof.
- Shopper, Primary, and Backup use gold, coral, and green flat-vector characters respectively.
- Motion plays once in narration sync; no final-release overlay loops.
- Required disclosure remains explicit: no payment is collected and fit, delivery, availability, and transaction completion are not guaranteed.
- Current public video and Devpost URL remain unchanged until replacement publication and readback succeed.
- Final Devpost submission is out of scope for this plan and still requires the user's exact `yes, submit` afterward.

## File Map

- Create `scripts/video/professional-demo-v2.ts`: typed voice profile, narration chapters, motion cues, ASS formatting, and safe-zone validation.
- Create `scripts/generate-professional-narration-v2.ps1`: pinned neural TTS sample/full narration generation and chapter/caption timing evidence.
- Create `scripts/render-professional-overlay-v2.ts`: CLI that converts final timing evidence into the Human Handoff ASS layer.
- Create `scripts/compose-professional-demo-v2.ps1`: non-destructive v2 compositor producing a new master alongside the current release.
- Create `tests/unit/professional-demo-v2.test.ts`: voice/config, cue-order, safe-zone, one-shot animation, and required-copy tests.
- Modify `docs/submission/assets/demo-narration.txt`: keep the eight approved chapters while improving phrasing only if the neural read requires it.
- Modify `docs/submission/video-evidence.md`: replace duration, checksum, encoding, audio, caption, ASR, public URL, and Devpost readback evidence after release.
- Modify `docs/submission/video-release-contract.md`, `docs/submission/demo-script.md`, `docs/submission/release-checklist.md`, `devpost-submission.md`, `docs/submission/devpost-copy.md`, and `README.md`: record the final v2 URL and exact verified facts.
- Create `docs/submission/assets/relay-professional-demo-v2.mp4`: exact verified release master.
- Keep generated narration, SRT, ASS, timing JSON, QA frames, and model artifacts ignored unless a small text artifact is explicitly needed for auditability.

---

### Task 1: Friendly female neural narration contract and preview

**Files:**
- Create: `scripts/video/professional-demo-v2.ts`
- Create: `scripts/generate-professional-narration-v2.ps1`
- Create: `tests/unit/professional-demo-v2.test.ts`
- Read: `docs/submission/assets/demo-narration.txt`

**Interfaces:**
- Produces: `VOICE_PROFILE`, `NARRATION_CHAPTERS`, `VoiceProfile`, and `NarrationChapter` from `scripts/video/professional-demo-v2.ts`.
- Produces: `docs/submission/assets/relay-professional-v2-voice-sample.mp3` for the user-visible approval gate.
- Produces after approval: `relay-professional-narration-v2.wav`, `relay-professional-captions-v2.json`, and `relay-professional-timings-v2.json` under `docs/submission/assets/`.

- [ ] **Step 1: Write the failing voice-contract test**

```ts
import { describe, expect, it } from "vitest";
import { NARRATION_CHAPTERS, VOICE_PROFILE } from "../../scripts/video/professional-demo-v2";

describe("professional demo v2 narration", () => {
  it("uses the approved friendly female neural profile", () => {
    expect(VOICE_PROFILE).toEqual({
      engine: "edge-tts",
      version: "7.2.8",
      voice: "en-US-JennyNeural",
      rate: "-3%",
      pitch: "-2Hz",
      volume: "-3%",
    });
  });

  it("locks eight non-empty narration chapters and required disclosures", () => {
    expect(NARRATION_CHAPTERS).toHaveLength(8);
    const script = NARRATION_CHAPTERS.map((chapter) => chapter.text).join(" ");
    expect(script).toContain("No payment has been collected");
    expect(script).toContain("physical fit are not guaranteed");
    expect(script).toContain("YouCam");
    expect(script).toContain("Event ready");
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd exec vitest run tests/unit/professional-demo-v2.test.ts`

Expected: FAIL because `scripts/video/professional-demo-v2.ts` does not exist.

- [ ] **Step 3: Implement the typed voice and chapter contract**

```ts
export type VoiceProfile = Readonly<{
  engine: "edge-tts";
  version: "7.2.8";
  voice: "en-US-JennyNeural";
  rate: "-3%";
  pitch: "-2Hz";
  volume: "-3%";
}>;

export type NarrationChapterId =
  | "promise" | "brief" | "plan" | "failure"
  | "recovery" | "ready" | "youcam" | "business";

export type NarrationChapter = Readonly<{
  id: NarrationChapterId;
  label: string;
  text: string;
}>;

export const VOICE_PROFILE: VoiceProfile = {
  engine: "edge-tts",
  version: "7.2.8",
  voice: "en-US-JennyNeural",
  rate: "-3%",
  pitch: "-2Hz",
  volume: "-3%",
};
```

Parse `demo-narration.txt` into exactly eight paragraphs and map them to the fixed chapter IDs `promise`, `brief`, `plan`, `failure`, `recovery`, `ready`, `youcam`, and `business`. Throw during module initialization if the count differs or a chapter is empty.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm.cmd exec vitest run tests/unit/professional-demo-v2.test.ts`

Expected: 2 tests pass.

- [ ] **Step 5: Implement pinned TTS preview/full generation**

The PowerShell script must resolve inputs with `-LiteralPath`, require `uvx`, `ffmpeg`, and `ffprobe`, and invoke the pinned package without a global installation:

```powershell
& uvx --from 'edge-tts==7.2.8' edge-tts `
  --voice 'en-US-JennyNeural' `
  --rate=-3% `
  --pitch=-2Hz `
  --volume=-3% `
  --text $chapterText `
  --write-media $chapterMp3 `
  --write-subtitles $chapterSrt
```

Support `-VoiceSampleOnly`. For that mode, synthesize this exact sample and stop without touching the release master:

```text
Relay turns one urgent fashion brief into a resilient plan. If the primary provider cannot help, an already-rendered backup keeps the event moving—without another search or upload.
```

For full mode, synthesize all eight chapters separately, concatenate them with 180 ms of silence, convert to 48 kHz stereo WAV, offset each SRT cue into a JSON array of `{ startSeconds, endSeconds, text }`, and write chapter starts plus duration and word count into the timing JSON.

- [ ] **Step 6: Generate and inspect the voice sample**

Run: `powershell -NoProfile -File scripts/generate-professional-narration-v2.ps1 -VoiceSampleOnly`

Expected: the sample exists, FFprobe reports a non-zero duration, and no release MP4 is modified.

- [ ] **Step 7: Present the sample to the user and stop for audible approval**

Render `relay-professional-v2-voice-sample.mp3` in the Codex app. Continue only after the user says the voice is acceptable. If rejected, test `en-US-AriaNeural` with the same rate/pitch/volume before any desktop voice fallback.

- [ ] **Step 8: Commit the approved narration pipeline**

```powershell
git add -- scripts/video/professional-demo-v2.ts scripts/generate-professional-narration-v2.ps1 tests/unit/professional-demo-v2.test.ts
git commit -m "feat: add friendly neural demo narration"
```

---

### Task 2: Human Handoff motion layer

**Files:**
- Modify: `scripts/video/professional-demo-v2.ts`
- Create: `scripts/render-professional-overlay-v2.ts`
- Modify: `tests/unit/professional-demo-v2.test.ts`

**Interfaces:**
- Consumes: `relay-professional-timings-v2.json` and `relay-professional-captions-v2.json` from Task 1.
- Produces: `MotionCue`, `HUMAN_HANDOFF_CUES`, `validateMotionCues(durationSeconds)`, and `buildHumanHandoffAss(input)`.
- Produces: ignored `docs/submission/assets/relay-professional-overlay-v2.ass`.

- [ ] **Step 1: Add failing cue and safety tests**

```ts
import {
  HUMAN_HANDOFF_CUES,
  buildHumanHandoffAss,
  validateMotionCues,
} from "../../scripts/video/professional-demo-v2";

it("contains the six approved one-shot story beats in order", () => {
  expect(HUMAN_HANDOFF_CUES.map((cue) => cue.id)).toEqual([
    "shopper-brief",
    "youcam-flow",
    "primary-backup-plan",
    "primary-declines",
    "backup-reroute",
    "event-ready",
  ]);
});

it("keeps every cue inside the safe overlay zones", () => {
  expect(() => validateMotionCues(180)).not.toThrow();
  for (const cue of HUMAN_HANDOFF_CUES) {
    expect(cue.startSeconds).toBeLessThan(cue.endSeconds);
    expect(cue.loop).toBe(false);
    expect(cue.box.x).toBeGreaterThanOrEqual(40);
    expect(cue.box.y).toBeGreaterThanOrEqual(40);
    expect(cue.box.x + cue.box.width).toBeLessThanOrEqual(1880);
    expect(cue.box.y + cue.box.height).toBeLessThanOrEqual(900);
  }
});

it("renders required role, recovery, and architecture copy", () => {
  const ass = buildHumanHandoffAss({ durationSeconds: 150, captions: [] });
  for (const text of [
    "SHOPPER",
    "PRIMARY",
    "BACKUP",
    "PRIMARY DECLINES",
    "BACKUP READY",
    "EVENT READY",
    "Signed upload",
    "Clothes v3",
    "Private result",
  ]) expect(ass).toContain(text);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd exec vitest run tests/unit/professional-demo-v2.test.ts`

Expected: FAIL because the motion exports do not exist.

- [ ] **Step 3: Implement typed cues and safe-zone validation**

```ts
export type MotionCue = Readonly<{
  id: "shopper-brief" | "youcam-flow" | "primary-backup-plan" |
    "primary-declines" | "backup-reroute" | "event-ready";
  chapterId: NarrationChapterId;
  startSeconds: number;
  endSeconds: number;
  loop: false;
  box: Readonly<{ x: number; y: number; width: number; height: number }>;
}>;
```

Anchor cue starts to chapter timings rather than absolute master times. Use the upper 820 pixels for characters and system callouts; reserve the lower 180 pixels for captions. Reject overlap, negative duration, out-of-frame geometry, a cue that extends past narration duration, or `loop !== false`.

- [ ] **Step 4: Implement the ASS vector renderer**

Use ASS vector drawing and `\move`, `\fad`, and `\t` transforms to render:

- shopper gold head/torso plus brief envelope;
- primary coral and backup green head/torso characters;
- path draw from shopper to primary, then de-emphasis;
- single red decline chip and small primary reaction;
- green reroute to backup plus `No new search or upload`;
- compact `Signed upload → Clothes v3 → Private result` rail;
- restrained Event ready pulse and four small celebratory particles.

Put characters on ASS layers 4–6, callouts on layer 7, and captions on layer 10. Every event receives an explicit start and end; no ASS event uses an infinite or repeated animation.

- [ ] **Step 5: Implement the overlay CLI**

```ts
const timings = JSON.parse(await readFile(timingPath, "utf8"));
const captions = JSON.parse(await readFile(captionPath, "utf8"));
validateMotionCues(timings.audioDurationSeconds);
await writeFile(outputPath, buildHumanHandoffAss({
  durationSeconds: timings.audioDurationSeconds,
  chapterStarts: timings.chapterStarts,
  captions,
}), "utf8");
```

Accept only explicit `--timings`, `--captions`, and `--output` paths. Resolve them and fail if an input is outside the repository or missing.

- [ ] **Step 6: Run focused tests and render the overlay**

Run: `npm.cmd exec vitest run tests/unit/professional-demo-v2.test.ts`

Run: `npm.cmd exec tsx scripts/render-professional-overlay-v2.ts -- --timings docs/submission/assets/relay-professional-timings-v2.json --captions docs/submission/assets/relay-professional-captions-v2.json --output docs/submission/assets/relay-professional-overlay-v2.ass`

Expected: all focused tests pass and the ASS file contains the six cue IDs as event names.

- [ ] **Step 7: Commit the motion layer**

```powershell
git add -- scripts/video/professional-demo-v2.ts scripts/render-professional-overlay-v2.ts tests/unit/professional-demo-v2.test.ts
git commit -m "feat: animate the Relay recovery handoff"
```

---

### Task 3: Non-destructive v2 composition

**Files:**
- Create: `scripts/compose-professional-demo-v2.ps1`
- Modify: `tests/unit/professional-demo-v2.test.ts`
- Create: `docs/submission/assets/relay-professional-demo-v2.mp4`

**Interfaces:**
- Consumes: existing `professional-raw/relay-production-journey.webm` and capture manifest.
- Consumes: v2 narration WAV, timing JSON, caption JSON, and ASS overlay from Tasks 1–2.
- Produces: `docs/submission/assets/relay-professional-demo-v2.mp4` without overwriting `relay-professional-demo.mp4`.

- [ ] **Step 1: Add a failing non-destructive composition-contract test**

Read the PowerShell source as text and assert exact release boundaries:

```ts
it("renders v2 beside the current master", async () => {
  const source = await readFile("scripts/compose-professional-demo-v2.ps1", "utf8");
  expect(source).toContain("relay-professional-demo-v2.mp4");
  expect(source).not.toMatch(/Remove-Item.+relay-professional-demo\.mp4/);
  expect(source).toContain("subtitles=");
  expect(source).toContain("loudnorm=I=-16:TP=-1.5:LRA=11");
  expect(source).toContain("+faststart");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd exec vitest run tests/unit/professional-demo-v2.test.ts`

Expected: FAIL because the v2 compositor does not exist.

- [ ] **Step 3: Implement the compositor**

Reuse the existing eight source ranges and chapter-to-source retiming logic from `compose-professional-demo.ps1`, but replace SAPI synthesis and mixed caption generation with the Task 1–2 artifacts. Set the exact new output path:

```powershell
$outputPath = Join-Path $assetRoot 'relay-professional-demo-v2.mp4'
```

Build the final filter chain as:

```text
eight trimmed/scaled production scenes
→ concat
→ pad/trim to final narration duration
→ ASS motion and caption layer
→ H.264 yuv420p 30 fps
```

Map the final WAV and normalize with `loudnorm=I=-16:TP=-1.5:LRA=11`. Encode AAC at 192 kbps, 48 kHz, stereo. Use `-movflags +faststart`. Do not delete or modify either the current master or current public-video evidence.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm.cmd exec vitest run tests/unit/professional-demo-v2.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Generate full narration, overlay, and master**

```powershell
powershell -NoProfile -File scripts/generate-professional-narration-v2.ps1
npm.cmd exec tsx scripts/render-professional-overlay-v2.ts -- --timings docs/submission/assets/relay-professional-timings-v2.json --captions docs/submission/assets/relay-professional-captions-v2.json --output docs/submission/assets/relay-professional-overlay-v2.ass
powershell -NoProfile -File scripts/compose-professional-demo-v2.ps1
```

Expected: `relay-professional-demo-v2.mp4` is created and the original `relay-professional-demo.mp4` checksum is unchanged.

- [ ] **Step 6: Create a visual-review contact sheet**

Extract frames immediately before, during, and after all six overlays plus caption midpoints. Build one contact sheet that makes collisions, blocked controls, role colors, and story continuity inspectable.

- [ ] **Step 7: Correct only observed composition defects and rerender**

Change cue timing or safe-zone geometry in the typed cue source, keep tests green, regenerate the ASS layer, and rerun the compositor. Do not patch the output MP4 directly.

- [ ] **Step 8: Commit the compositor and exact master**

```powershell
git add -- scripts/compose-professional-demo-v2.ps1 tests/unit/professional-demo-v2.test.ts docs/submission/assets/relay-professional-demo-v2.mp4
git commit -m "feat: render animated Relay demo v2"
```

---

### Task 4: Exact release verification

**Files:**
- Modify: `docs/submission/video-evidence.md`
- Modify: `docs/submission/release-checklist.md`
- Read: `docs/submission/assets/relay-professional-demo-v2.mp4`

**Interfaces:**
- Consumes: exact v2 MP4 from Task 3.
- Produces: release evidence with duration, frame count, codecs, loudness, checksum, captions, ASR claims, and visual QA.

- [ ] **Step 1: Run the exact-master verifier**

Get the FFprobe duration and pass that exact value to the verifier:

```powershell
$relayV2Duration = (& ffprobe -v error -show_entries format=duration -of 'default=noprint_wrappers=1:nokey=1' docs\submission\assets\relay-professional-demo-v2.mp4).Trim()
python C:\Users\harik\.codex\skills\create-professional-explainer-video\scripts\verify_master.py docs\submission\assets\relay-professional-demo-v2.mp4 --expected-duration $relayV2Duration
```

Expected: H.264, AAC, 1920×1080, 30 fps, `yuv420p`, stereo 48 kHz, full-frame decode, and `ftyp/moov/mdat` atom order all pass.

- [ ] **Step 2: Verify audio and visual continuity**

Run FFmpeg `ebur128`, `silencedetect=noise=-45dB:d=1.2`, and `blackdetect=d=0.2:pix_th=0.10`. Expected: approximately -16 LUFS, true peak ≤ -1.5 dBFS, no silence longer than 1.2 seconds, and no unintended black interval.

- [ ] **Step 3: Verify random seeking**

Extract five frames near 12%, 35%, 60%, 84%, and 98% through both sequential decode and independent seeking. Compare pixel hashes or normalized frame differences. Expected: all five pairs match.

- [ ] **Step 4: Verify claims with full local ASR**

Transcribe the exact MP4 and assert the transcript preserves these claims: Relay reliability layer, discovery-versus-outcome promise, YouCam Clothes v3, signed upload, private result, primary decline, backup activation/acceptance, Event ready, no payment, fit/delivery limitations, and 18% commission hypothesis.

- [ ] **Step 5: Inspect all overlay/caption frames**

Review the contact sheet and full-resolution frames for each story cue. Expected: product proof remains readable, characters use the approved colors, captions remain outside controls, and no overlay exposes credentials, task IDs, signed URLs, private keys, local paths, or unrelated browser content.

- [ ] **Step 6: Run repository verification**

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
git diff --check
```

Expected: typecheck/build/tests exit 0; lint has zero errors; diff check exits 0.

- [ ] **Step 7: Record exact evidence and commit**

Update `video-evidence.md` and the release checklist with observed numbers only. Then:

```powershell
git add -- docs/submission/video-evidence.md docs/submission/release-checklist.md
git commit -m "docs: verify animated Relay demo v2"
```

---

### Task 5: Public replacement, repository alignment, and Devpost readback

**Files:**
- Modify: `README.md`
- Modify: `devpost-submission.md`
- Modify: `docs/submission/devpost-copy.md`
- Modify: `docs/submission/demo-script.md`
- Modify: `docs/submission/video-release-contract.md`
- Modify: `docs/submission/video-evidence.md`
- Modify: `.devpost-hackathon-state.json` (ignored local state only)

**Interfaces:**
- Consumes: verified exact master and evidence from Task 4.
- Produces: new public YouTube URL, exact Devpost video URL readback, and a draft submission with `submitted_at: null`.

- [ ] **Step 1: Upload the exact verified master to YouTube**

Use the authenticated YouTube Studio session. Title it `Relay Rescue — Primary Fails. Backup Is Ready. | YouCam API Challenge`. Use the truthful existing description, set `Not made for kids`, retain an automatic product-frame thumbnail if custom-thumbnail verification is still unavailable, wait for copyright checks, and publish Public.

- [ ] **Step 2: Verify the new public page independently**

Open the new short URL outside the Studio response and confirm it resolves to the expected title. Record the exact URL. Keep both earlier Relay videos available until Devpost readback succeeds.

- [ ] **Step 3: Update the Devpost project video only**

Call `devpost_hackathons_update_project` for `relay-xr7byl` with only the new `video_url`. Then call `devpost_hackathons_get_project` and require:

```text
video_url == newly published YouTube URL
hackathons[0].submitted_at == null
```

Do not call the Devpost submit tool.

- [ ] **Step 4: Update all repository references**

Replace the prior YouTube URL and old duration with the new URL and exact observed duration. Update the local ignored state file. Run:

```powershell
rg -n "K_iLJKMcykg|rtxc3_vG1a8|Public 2:21|Public 2:25" README.md devpost-submission.md docs/submission
```

Expected: old URLs remain only where intentionally documented as prior releases, not as the active submission video.

- [ ] **Step 5: Commit and push the release update**

```powershell
git add -- README.md devpost-submission.md docs/submission/devpost-copy.md docs/submission/demo-script.md docs/submission/video-release-contract.md docs/submission/video-evidence.md docs/submission/release-checklist.md
git commit -m "docs: publish animated Relay demo v2"
git push -u origin codex/relay-implementation
```

- [ ] **Step 6: Update PR #4 and wait for exact CI**

Confirm PR #4 points to the latest branch head. Require the remote typecheck, lint, unit/contract, PostgreSQL integration, build, and desktop/mobile E2E job to pass before merging the repository update.

- [ ] **Step 7: Run final readbacks**

Verify: public app loads, new YouTube page loads, GitHub default branch contains the active video URL, Devpost returns that same URL, screenshots remain present, entrant type is `Individual`, country is `United States`, rules are acknowledged, and `submitted_at` is still null.

- [ ] **Step 8: Stop at the irreversible submission gate**

Report the verified artifacts and state exactly:

```markdown
### ⏳ Not submitted yet
Nothing has been sent to Devpost.
```

Ask the user for the exact phrase `yes, submit`. Do not infer confirmation from earlier approvals.
