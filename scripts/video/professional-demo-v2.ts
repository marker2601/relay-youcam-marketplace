import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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

export type VoiceSampleSegment = Readonly<{
  text: string;
  rate: "+0%" | "-5%";
  pitch: "+8Hz" | "-5Hz" | "+5Hz";
}>;

export const VOICE_PROFILE: VoiceProfile = {
  engine: "edge-tts",
  version: "7.2.8",
  voice: "en-US-JennyNeural",
  rate: "-3%",
  pitch: "-2Hz",
  volume: "-3%",
};

export const VOICE_SAMPLE_SEGMENTS: readonly VoiceSampleSegment[] = Object.freeze([
  Object.freeze({ text: "Hey—do you know what makes Relay different?", rate: "+0%", pitch: "+8Hz" }),
  Object.freeze({ text: "It does not just show you an outfit.", rate: "-5%", pitch: "-5Hz" }),
  Object.freeze({ text: "It keeps a ready backup in motion, so when the first plan falls through, your event does not.", rate: "+0%", pitch: "+5Hz" }),
]);

const CHAPTER_IDS: readonly NarrationChapterId[] = [
  "promise", "brief", "plan", "failure", "recovery", "ready", "youcam", "business",
];

const CHAPTER_LABELS: readonly string[] = [
  "The promise", "The brief", "The plan", "Primary failure",
  "Backup recovery", "Event ready", "YouCam orchestration", "Business hypothesis",
];

const moduleDirectory = import.meta.url.startsWith("file:")
  ? dirname(fileURLToPath(import.meta.url))
  : resolve(process.cwd(), "scripts/video");
const narrationPath = resolve(moduleDirectory, "../../docs/submission/assets/demo-narration.txt");
const paragraphs = readFileSync(narrationPath, "utf8")
  .trim()
  .split(/\r?\n\s*\r?\n/)
  .map((paragraph) => paragraph.replace(/\s+/g, " ").trim());

if (paragraphs.length !== CHAPTER_IDS.length || paragraphs.some((paragraph) => !paragraph)) {
  throw new Error(`Expected ${CHAPTER_IDS.length} non-empty narration paragraphs, found ${paragraphs.length}.`);
}

export const NARRATION_CHAPTERS: readonly NarrationChapter[] = Object.freeze(
  paragraphs.map((text, index) => Object.freeze({
    id: CHAPTER_IDS[index]!,
    label: CHAPTER_LABELS[index]!,
    text,
  })),
);
