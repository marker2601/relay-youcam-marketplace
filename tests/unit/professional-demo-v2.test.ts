import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  buildHumanHandoffAss,
  HUMAN_HANDOFF_CUES,
  NARRATION_CHAPTERS,
  validateMotionCues,
  VOICE_PROFILE,
  VOICE_SAMPLE_SEGMENTS,
} from "../../scripts/video/professional-demo-v2";
import { runOverlayRenderer } from "../../scripts/render-professional-overlay-v2";

const execFileAsync = promisify(execFile);
const compositorPath = resolve(process.cwd(), "scripts/compose-professional-demo-v2.ps1");
const chapterIds = ["promise", "brief", "plan", "failure", "recovery", "ready", "youcam", "business"] as const;

type PreflightFixture = Readonly<{
  directory: string;
  outsideDirectory: string;
  assetDirectory: string;
  timingPath: string;
  captionPath: string;
  overlayPath: string;
}>;

async function createPreflightFixture(): Promise<PreflightFixture> {
  const directory = await mkdtemp(join(process.cwd(), ".relay-v2-compositor-"));
  const outsideDirectory = await mkdtemp(join(tmpdir(), "relay-v2-compositor-cwd-"));
  const assetDirectory = join(directory, "assets");
  const rawDirectory = join(assetDirectory, "professional-raw");
  await mkdir(rawDirectory, { recursive: true });

  const chapterStarts = Object.fromEntries(chapterIds.map((id, index) => [id, index * 10]));
  const timings = JSON.stringify({
    audioDurationSeconds: 80,
    chapterStarts,
    chapters: chapterIds.map((id, index) => ({ id, startSeconds: index * 10, durationSeconds: 9 })),
  });
  const captions = JSON.stringify([{ startSeconds: 1, endSeconds: 2, text: "A verified caption." }]);
  const captionHash = createHash("sha256").update(captions, "utf8").digest("hex");
  const overlay = [
    "[Script Info]",
    "; relay-caption-count=1",
    `; relay-caption-sha256=${captionHash}`,
    "",
    "[Events]",
    "Dialogue: 10,0:00:01.00,0:00:02.00,Caption,caption-1,0,0,0,,A verified caption.",
  ].join("\r\n");

  await Promise.all([
    writeFile(join(rawDirectory, "relay-production-journey.webm"), "placeholder", "utf8"),
    writeFile(join(rawDirectory, "relay-production-journey.json"), JSON.stringify({ scenes: [] }), "utf8"),
    writeFile(join(assetDirectory, "relay-professional-narration-v2.wav"), "placeholder", "utf8"),
    writeFile(join(assetDirectory, "relay-professional-timings-v2.json"), timings, "utf8"),
    writeFile(join(assetDirectory, "relay-professional-captions-v2.json"), captions, "utf8"),
    writeFile(join(assetDirectory, "relay-professional-overlay-v2.ass"), overlay, "utf8"),
  ]);

  return Object.freeze({
    directory,
    outsideDirectory,
    assetDirectory,
    timingPath: join(assetDirectory, "relay-professional-timings-v2.json"),
    captionPath: join(assetDirectory, "relay-professional-captions-v2.json"),
    overlayPath: join(assetDirectory, "relay-professional-overlay-v2.ass"),
  });
}

async function runCompositorPreflight(fixture: PreflightFixture): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", compositorPath,
    "-AssetDirectory", fixture.assetDirectory,
    "-ValidateOnly",
  ], { cwd: fixture.outsideDirectory, windowsHide: true });
}

async function removePreflightFixture(fixture: PreflightFixture): Promise<void> {
  await Promise.all([
    rm(fixture.directory, { recursive: true, force: true }),
    rm(fixture.outsideDirectory, { recursive: true, force: true }),
  ]);
}

async function expectPreflightFailure(fixture: PreflightFixture, message: string): Promise<void> {
  try {
    await runCompositorPreflight(fixture);
    throw new Error("Expected compositor preflight to fail.");
  } catch (error) {
    const details = error instanceof Error && "stderr" in error
      ? `${error.message}\n${String(error.stderr)}`
      : String(error);
    expect(details).toContain(message);
  }
}

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

  it("locks eight non-empty narration chapters and unambiguous required disclosures", () => {
    expect(NARRATION_CHAPTERS).toHaveLength(8);
    const script = NARRATION_CHAPTERS.map((chapter) => chapter.text).join(" ");
    expect(script).toContain("This prototype collects zero dollars. It does not process payments.");
    expect(script).not.toContain("No payment has been collected");
    expect(script).toContain("Delivery and physical fit are not guaranteed");
    expect(script).toContain("Availability and transaction completion are not guaranteed");
    expect(script).toContain("YouCam");
    expect(script).toContain("Event ready");
  });

  it("defines the revised Jenny sample contour deterministically", () => {
    expect(VOICE_SAMPLE_SEGMENTS).toEqual([
      { text: "Hey—do you know what makes Relay different?", rate: "+0%", pitch: "+8Hz" },
      { text: "It does not just show you an outfit.", rate: "-5%", pitch: "-5Hz" },
      { text: "It keeps a ready backup in motion, so when the first plan falls through, your event does not.", rate: "+0%", pitch: "+5Hz" },
    ]);
  });

  it("locks narration-stage loudness normalization and measurement", () => {
    const generator = readFileSync(
      resolve(process.cwd(), "scripts/generate-professional-narration-v2.ps1"),
      "utf8",
    );

    expect(generator).toContain("loudnorm=I=-16:TP=-1.5:LRA=11");
    expect(generator).toContain("relay-professional-narration-v2-loudness.json");
  });

  it("trims chapter-tail silence before adding a deterministic natural pause", () => {
    const generator = readFileSync(
      resolve(process.cwd(), "scripts/generate-professional-narration-v2.ps1"),
      "utf8",
    );

    expect(generator).toContain("$chapterPauseSeconds = 0.12");
    expect(generator).toContain("areverse,silenceremove=start_periods=1:start_duration=0.10:start_threshold=-45dB:start_silence=0,areverse");
    expect(generator).toContain("$preparedDuration = Get-AudioDuration $chapterWav");
    expect(generator).toContain("$caption.endSeconds = [Math]::Round([Math]::Min($caption.endSeconds, $chapterEnd), 3)");
    expect(generator).toContain("$offset += $preparedDuration");
  });

  it("writes the Task 2 timing contract as BOM-free canonical JSON", () => {
    const generator = readFileSync(
      resolve(process.cwd(), "scripts/generate-professional-narration-v2.ps1"),
      "utf8",
    );

    expect(generator).toContain("$timingManifest = [ordered]@{");
    expect(generator).toContain("audioDurationSeconds");
    expect(generator).toContain("chapterStarts");
    expect(generator).toContain("[Text.UTF8Encoding]::new($false)");
    expect(generator).toContain("[IO.File]::WriteAllText");
  });
});

describe("professional demo v2 composition", () => {
  it("renders v2 beside the current master", async () => {
    const source = await readFile("scripts/compose-professional-demo-v2.ps1", "utf8");
    expect(source).toContain("relay-professional-demo-v2.mp4");
    expect(source).not.toMatch(/Remove-Item.+relay-professional-demo\.mp4/);
    expect(source).toContain("subtitles=");
    expect(source).toContain("loudnorm=I=-16:TP=-1.5:LRA=11");
    expect(source).toContain("+faststart");
    expect(source).toContain("$AssetDirectory = Join-Path $PSScriptRoot");
    expect(source).toContain("[double]::IsNaN");
    expect(source).toContain("[double]::IsInfinity");
  });

  it("preflights canonical BOM-free inputs from outside the repository cwd", async () => {
    const fixture = await createPreflightFixture();
    try {
      const result = await runCompositorPreflight(fixture);
      expect(result.stdout).toContain("V2 compositor preflight passed");
      expect(result.stdout).toContain(fixture.overlayPath.slice(process.cwd().length + 1).replaceAll("\\", "/"));
    } finally {
      await removePreflightFixture(fixture);
    }
  });

  it("rejects a legacy array timing manifest before encoding", async () => {
    const fixture = await createPreflightFixture();
    try {
      await writeFile(fixture.timingPath, JSON.stringify([{ id: "promise", startSeconds: 0 }]), "utf8");
      await expectPreflightFailure(fixture, "canonical JSON object");
    } finally {
      await removePreflightFixture(fixture);
    }
  });

  it("rejects a BOM-prefixed canonical timing manifest before encoding", async () => {
    const fixture = await createPreflightFixture();
    try {
      const canonicalJson = await readFile(fixture.timingPath, "utf8");
      await writeFile(fixture.timingPath, `\uFEFF${canonicalJson}`, "utf8");
      await expectPreflightFailure(fixture, "must be UTF-8 without a BOM");
    } finally {
      await removePreflightFixture(fixture);
    }
  });

  it("rejects an ASS whose caption marker does not match the caption JSON", async () => {
    const fixture = await createPreflightFixture();
    try {
      await writeFile(fixture.captionPath, JSON.stringify([{ startSeconds: 1, endSeconds: 2, text: "A stale caption." }]), "utf8");
      await expectPreflightFailure(fixture, "caption marker hash does not match");
    } finally {
      await removePreflightFixture(fixture);
    }
  });
});

describe("professional demo v2 Human Handoff motion", () => {
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

  it("rejects non-finite geometry instead of admitting an invalid safe-zone cue", () => {
    const firstCue = HUMAN_HANDOFF_CUES[0]!;
    const invalidCue = {
      ...firstCue,
      box: { ...firstCue.box, x: Number.NaN },
    };
    expect(() => validateMotionCues(180, [invalidCue])).toThrow("safe overlay zone");
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

  it("uses chapter-relative timestamps and never combines pos with move", () => {
    const ass = buildHumanHandoffAss({
      durationSeconds: 150,
      chapterStarts: { promise: 0, brief: 11, plan: 25, failure: 51, recovery: 71, ready: 85, youcam: 101, business: 123 },
      captions: [],
    });
    expect(ass).toContain("Dialogue: 4,0:00:11.50");
    for (const event of ass.split("\r\n").filter((line) => line.startsWith("Dialogue:") && line.includes("\\move"))) {
      expect(event).not.toContain("\\pos");
    }
  });

  it("resolves the six beats in the approved motion order", () => {
    const ass = buildHumanHandoffAss({
      durationSeconds: 150,
      chapterStarts: { promise: 0, brief: 11, plan: 25, failure: 51, recovery: 71, ready: 85, youcam: 101, business: 123 },
      captions: [],
    });
    const starts = ["shopper-brief", "youcam-flow", "primary-backup-plan", "primary-declines", "backup-reroute", "event-ready"].map((id) => {
      const match = ass.match(new RegExp(`Dialogue: \\d+,([^,]+),[^,]+,Motion,${id},`));
      expect(match?.[1]).toBeTruthy();
      const [hours, minutes, seconds] = match![1]!.split(/[:.]/).map(Number);
      return hours! * 3600 + minutes! * 60 + seconds! + Number(`0.${match![1]!.split(".")[1]}`);
    });
    expect(starts).toEqual([...starts].sort((left, right) => left - right));
  });

  it("keeps shopper, path, brief, and primary together for the handoff", () => {
    const ass = buildHumanHandoffAss({ durationSeconds: 150, captions: [] });
    const planEvents = ass.split("\r\n").filter((line) => line.includes(",primary-backup-plan,"));
    const shopper = planEvents.find((line) => line.startsWith("Dialogue: 4,") && line.includes("&H0041A4D9"));
    const primary = planEvents.find((line) => line.startsWith("Dialogue: 5,") && line.includes("&H006277E7"));
    const path = planEvents.find((line) => line.includes("\\p1}m 0 0 l 260 0") && line.includes("\\move(650,310,650,310"));
    const brief = planEvents.find((line) => line.includes("\\move(650,310,910,310") && line.includes("m 0 0 l 44 0"));

    expect(shopper).toBeTruthy();
    expect(primary).toBeTruthy();
    expect(path).toBeTruthy();
    expect(brief).toBeTruthy();
    expect(shopper!.split(",").slice(1, 3)).toEqual(primary!.split(",").slice(1, 3));
  });

  it("renders a red vector chip behind PRIMARY DECLINES", () => {
    const ass = buildHumanHandoffAss({ durationSeconds: 150, captions: [] });
    const declineEvents = ass.split("\r\n").filter((line) => line.includes(",primary-declines,"));
    const backgroundIndex = declineEvents.findIndex((line) => line.includes("&H005757D9") && line.includes("\\p1}m 0 0 l 270 0"));
    const labelIndex = declineEvents.findIndex((line) => line.includes("PRIMARY DECLINES"));
    expect(backgroundIndex).toBeGreaterThanOrEqual(0);
    expect(labelIndex).toBeGreaterThan(backgroundIndex);
    expect(declineEvents[backgroundIndex]!.split(",").slice(1, 3)).toEqual(declineEvents[labelIndex]!.split(",").slice(1, 3));
  });

  it("renders a deterministic timing fixture with named cues and caption layer 10", async () => {
    const fixtureDirectory = await mkdtemp(join(tmpdir(), "relay-overlay-v2-"));
    const timingPath = join(fixtureDirectory, "timings.json");
    const captionPath = join(fixtureDirectory, "captions.json");
    const outputPath = join(fixtureDirectory, "overlay.ass");

    await writeFile(timingPath, JSON.stringify({
      audioDurationSeconds: 150,
      chapterStarts: { promise: 0, brief: 11, plan: 25, failure: 51, recovery: 71, ready: 85, youcam: 101, business: 123 },
    }), "utf8");
    await writeFile(captionPath, JSON.stringify([
      { startSeconds: 1, endSeconds: 2.5, text: "Relay keeps a backup ready." },
    ]), "utf8");

    try {
      await runOverlayRenderer({ timingPath, captionPath, outputPath, repositoryRoot: fixtureDirectory });
      const ass = await readFile(outputPath, "utf8");
      for (const cue of HUMAN_HANDOFF_CUES) expect(ass).toContain(`,${cue.id},`);
      expect(ass).toContain("Dialogue: 10,0:00:01.00,0:00:02.50,Caption,caption-1");
      expect(ass).toContain("; relay-caption-count=1");
      expect(ass).toContain(`; relay-caption-sha256=${createHash("sha256").update(await readFile(captionPath, "utf8"), "utf8").digest("hex")}`);
    } finally {
      await rm(fixtureDirectory, { recursive: true, force: true });
    }
  });

  it("fails closed for missing and outside-repository timing inputs", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "relay-overlay-repository-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "relay-overlay-outside-"));
    const captionPath = join(repositoryRoot, "captions.json");
    const outputPath = join(repositoryRoot, "overlay.ass");
    const outsideTimingPath = join(outsideRoot, "timings.json");
    const linkedTimingPath = join(repositoryRoot, "linked-timings.json");
    const timings = JSON.stringify({
      audioDurationSeconds: 150,
      chapterStarts: { promise: 0, brief: 11, plan: 25, failure: 51, recovery: 71, ready: 85, youcam: 101, business: 123 },
    });
    await writeFile(captionPath, "[]", "utf8");
    await writeFile(outsideTimingPath, timings, "utf8");

    try {
      await expect(runOverlayRenderer({
        timingPath: join(repositoryRoot, "missing.json"), captionPath, outputPath, repositoryRoot,
      })).rejects.toThrow("Required input file does not exist");
      await expect(runOverlayRenderer({
        timingPath: outsideTimingPath, captionPath, outputPath, repositoryRoot,
      })).rejects.toThrow("Input path must stay inside the repository");

      try {
        await symlink(outsideTimingPath, linkedTimingPath, "file");
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "EPERM") throw error;
        return;
      }
      await expect(runOverlayRenderer({
        timingPath: linkedTimingPath, captionPath, outputPath, repositoryRoot,
      })).rejects.toThrow("Input path must stay inside the repository");
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });
});
