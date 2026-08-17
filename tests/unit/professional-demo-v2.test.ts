import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
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
