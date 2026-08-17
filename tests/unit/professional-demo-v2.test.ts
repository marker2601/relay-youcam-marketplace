import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NARRATION_CHAPTERS, VOICE_PROFILE, VOICE_SAMPLE_SEGMENTS } from "../../scripts/video/professional-demo-v2";

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
