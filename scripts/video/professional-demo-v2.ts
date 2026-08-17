import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import deliveryProfileJson from "../../docs/submission/assets/relay-professional-v2-delivery-profile.json";

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
  rate: string;
  pitch: string;
}>;

export type VoiceDeliveryChapter = Readonly<{
  id: NarrationChapterId;
  segments: readonly VoiceSampleSegment[];
}>;

export type VoiceDeliveryProfile = Readonly<{
  engine: "edge-tts";
  version: "7.2.8";
  voice: "en-US-JennyNeural";
  defaultRate: "-3%";
  defaultPitch: "-2Hz";
  volume: "-3%";
  internalPauseSeconds: number;
  chapterPauseSeconds: number;
  sample: Readonly<{ chapterId: NarrationChapterId; segmentIndexes: readonly number[] }>;
  chapters: readonly VoiceDeliveryChapter[];
}>;

export const VOICE_DELIVERY_PROFILE = deliveryProfileJson as VoiceDeliveryProfile;

export const VOICE_PROFILE: VoiceProfile = {
  engine: VOICE_DELIVERY_PROFILE.engine,
  version: VOICE_DELIVERY_PROFILE.version,
  voice: VOICE_DELIVERY_PROFILE.voice,
  rate: VOICE_DELIVERY_PROFILE.defaultRate,
  pitch: VOICE_DELIVERY_PROFILE.defaultPitch,
  volume: VOICE_DELIVERY_PROFILE.volume,
};

const LEGACY_SAMPLE_SEGMENTS: readonly VoiceSampleSegment[] = Object.freeze([
  Object.freeze({ text: "Hey—do you know what makes Relay different?", rate: "+0%", pitch: "+8Hz" }),
  Object.freeze({ text: "It does not just show you an outfit.", rate: "-5%", pitch: "-5Hz" }),
  Object.freeze({ text: "It keeps a ready backup in motion, so when the first plan falls through, your event does not.", rate: "+0%", pitch: "+5Hz" }),
]);

void LEGACY_SAMPLE_SEGMENTS;

const CHAPTER_IDS: readonly NarrationChapterId[] = [
  "promise", "brief", "plan", "failure", "recovery", "ready", "youcam", "business",
];

const profileChapterIds = VOICE_DELIVERY_PROFILE.chapters.map((chapter) => chapter.id);
if (profileChapterIds.length !== CHAPTER_IDS.length || profileChapterIds.join(",") !== CHAPTER_IDS.join(",")) {
  throw new Error("Voice delivery profile must contain the eight canonical chapters in order.");
}
if (VOICE_DELIVERY_PROFILE.internalPauseSeconds !== 0.22 || VOICE_DELIVERY_PROFILE.chapterPauseSeconds !== 0.12) {
  throw new Error("Voice delivery profile must preserve the approved 220 ms and 120 ms pauses.");
}
const sampleChapter = VOICE_DELIVERY_PROFILE.chapters.find((chapter) => chapter.id === VOICE_DELIVERY_PROFILE.sample.chapterId);
if (!sampleChapter) throw new Error("Voice delivery sample chapter is missing.");
export const VOICE_SAMPLE_SEGMENTS: readonly VoiceSampleSegment[] = Object.freeze(
  VOICE_DELIVERY_PROFILE.sample.segmentIndexes.map((index) => {
    const segment = sampleChapter.segments[index];
    if (!segment) throw new Error("Voice delivery sample references a missing segment.");
    return Object.freeze(segment);
  }),
);
export const VOICE_DELIVERY_CHAPTERS: readonly VoiceDeliveryChapter[] = Object.freeze(
  VOICE_DELIVERY_PROFILE.chapters.map((chapter) => Object.freeze({
    id: chapter.id,
    segments: Object.freeze(chapter.segments.map((segment) => Object.freeze(segment))),
  })),
);

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

for (const [index, chapter] of NARRATION_CHAPTERS.entries()) {
  const profileChapter = VOICE_DELIVERY_CHAPTERS[index]!;
  const profileText = profileChapter.segments.map((segment) => segment.text).join(" ");
  if (profileChapter.id !== chapter.id || profileText !== chapter.text) {
    throw new Error(`Voice delivery profile text must exactly match narration chapter '${chapter.id}'.`);
  }
}

export type MotionCue = Readonly<{
  id: "shopper-brief" | "youcam-flow" | "primary-backup-plan" |
    "primary-declines" | "backup-reroute" | "event-ready";
  chapterId: NarrationChapterId;
  startSeconds: number;
  endSeconds: number;
  loop: false;
  box: Readonly<{ x: number; y: number; width: number; height: number }>;
}>;

export type CaptionCue = Readonly<{
  startSeconds: number;
  endSeconds: number;
  text: string;
}>;

export type HumanHandoffAssInput = Readonly<{
  durationSeconds: number;
  chapterStarts?: Partial<Record<NarrationChapterId, number>> | readonly number[];
  captions: readonly CaptionCue[];
}>;

type MotionCueTemplate = Omit<MotionCue, "startSeconds" | "endSeconds"> & Readonly<{
  startOffsetSeconds: number;
  endOffsetSeconds: number;
}>;

const FRAME = Object.freeze({ width: 1920, height: 1080, inset: 40, captionTop: 900 });

const CANONICAL_CHAPTER_STARTS: Readonly<Record<NarrationChapterId, number>> = Object.freeze({
  promise: 0,
  brief: 10.812,
  plan: 24.983,
  failure: 50.594,
  recovery: 70.836,
  ready: 84.919,
  youcam: 100.421,
  business: 122.265,
});

const HUMAN_HANDOFF_CUE_TEMPLATES: readonly MotionCueTemplate[] = Object.freeze([
  Object.freeze({
    id: "shopper-brief",
    chapterId: "brief",
    startOffsetSeconds: 0.5,
    endOffsetSeconds: 6.4,
    loop: false,
    box: Object.freeze({ x: 120, y: 160, width: 260, height: 360 }),
  }),
  Object.freeze({
    id: "youcam-flow",
    chapterId: "plan",
    startOffsetSeconds: 0.5,
    endOffsetSeconds: 3.9,
    loop: false,
    box: Object.freeze({ x: 1060, y: 90, width: 700, height: 150 }),
  }),
  Object.freeze({
    id: "primary-backup-plan",
    chapterId: "plan",
    startOffsetSeconds: 4.2,
    endOffsetSeconds: 10.5,
    loop: false,
    box: Object.freeze({ x: 390, y: 170, width: 1160, height: 430 }),
  }),
  Object.freeze({
    id: "primary-declines",
    chapterId: "failure",
    startOffsetSeconds: 0.8,
    endOffsetSeconds: 5.5,
    loop: false,
    box: Object.freeze({ x: 680, y: 190, width: 580, height: 350 }),
  }),
  Object.freeze({
    id: "backup-reroute",
    chapterId: "recovery",
    startOffsetSeconds: 0.6,
    endOffsetSeconds: 6.5,
    loop: false,
    box: Object.freeze({ x: 720, y: 180, width: 700, height: 360 }),
  }),
  Object.freeze({
    id: "event-ready",
    chapterId: "ready",
    startOffsetSeconds: 0.7,
    endOffsetSeconds: 6.8,
    loop: false,
    box: Object.freeze({ x: 700, y: 150, width: 520, height: 350 }),
  }),
]);

function resolveChapterStarts(
  chapterStarts: HumanHandoffAssInput["chapterStarts"],
): Readonly<Record<NarrationChapterId, number>> {
  if (!chapterStarts) return CANONICAL_CHAPTER_STARTS;

  const starts: Partial<Record<NarrationChapterId, number>> = Array.isArray(chapterStarts)
    ? Object.fromEntries(CHAPTER_IDS.map((id, index) => [id, chapterStarts[index]]))
    : chapterStarts as Partial<Record<NarrationChapterId, number>>;

  const resolved = {} as Record<NarrationChapterId, number>;
  for (const id of CHAPTER_IDS) {
    const start = starts[id];
    if (!Number.isFinite(start) || start! < 0) {
      throw new Error(`Missing or invalid chapter start for '${id}'.`);
    }
    resolved[id] = start!;
  }
  return Object.freeze(resolved);
}

function resolveMotionCues(
  chapterStarts?: HumanHandoffAssInput["chapterStarts"],
): readonly MotionCue[] {
  const starts = resolveChapterStarts(chapterStarts);
  return Object.freeze(HUMAN_HANDOFF_CUE_TEMPLATES.map((template) => Object.freeze({
    id: template.id,
    chapterId: template.chapterId,
    startSeconds: starts[template.chapterId] + template.startOffsetSeconds,
    endSeconds: starts[template.chapterId] + template.endOffsetSeconds,
    loop: template.loop,
    box: template.box,
  })));
}

export const HUMAN_HANDOFF_CUES: readonly MotionCue[] = resolveMotionCues();

export function validateMotionCues(
  durationSeconds: number,
  cues: readonly MotionCue[] = HUMAN_HANDOFF_CUES,
): void {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Narration duration must be a positive finite number.");
  }

  const orderedByTime = [...cues].sort((left, right) => left.startSeconds - right.startSeconds);
  let previousEnd = 0;
  for (const cue of orderedByTime) {
    const { box } = cue;
    if (!Number.isFinite(cue.startSeconds) || !Number.isFinite(cue.endSeconds) || cue.endSeconds <= cue.startSeconds) {
      throw new Error(`Cue '${cue.id}' has a negative or zero duration.`);
    }
    if (cue.startSeconds < 0 || cue.endSeconds > durationSeconds) {
      throw new Error(`Cue '${cue.id}' falls outside the narration duration.`);
    }
    if (cue.loop !== false) {
      throw new Error(`Cue '${cue.id}' must play once.`);
    }
    if (
      !Number.isFinite(box.x) || !Number.isFinite(box.y) || !Number.isFinite(box.width) || !Number.isFinite(box.height)
      || box.x < FRAME.inset || box.y < FRAME.inset || box.width <= 0 || box.height <= 0
      || box.x + box.width > FRAME.width - FRAME.inset
      || box.y + box.height > FRAME.captionTop
    ) {
      throw new Error(`Cue '${cue.id}' falls outside the safe overlay zone.`);
    }
    if (cue.startSeconds < previousEnd) {
      throw new Error(`Cue '${cue.id}' overlaps another motion cue.`);
    }
    previousEnd = cue.endSeconds;
  }
}

function formatAssTime(seconds: number): string {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor((centiseconds % 360000) / 6000);
  const remainingSeconds = Math.floor((centiseconds % 6000) / 100);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}.${String(centiseconds % 100).padStart(2, "0")}`;
}

function escapeAssText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\r?\n/g, "\\N");
}

function dialogue(
  layer: number,
  startSeconds: number,
  endSeconds: number,
  name: string,
  text: string,
): string {
  return `Dialogue: ${layer},${formatAssTime(startSeconds)},${formatAssTime(endSeconds)},Motion,${name},0,0,0,,${text}`;
}

const COLORS = Object.freeze({
  gold: "&H0041A4D9",
  coral: "&H006277E7",
  green: "&H0078AE5B",
  darkGreen: "&H00353F17",
  cream: "&H00E6F8FF",
  red: "&H005757D9",
  muted: "&H00758A7A",
});

function characterDrawing(color: string): string {
  return `\\1c${color}\\bord0\\p1}m 78 10 b 52 10 52 54 78 54 b 104 54 104 10 78 10 m 42 72 l 114 72 l 132 180 l 24 180 l 42 72`;
}

function cueById(cues: readonly MotionCue[], id: MotionCue["id"]): MotionCue {
  const cue = cues.find((candidate) => candidate.id === id);
  if (!cue) throw new Error(`Missing motion cue '${id}'.`);
  return cue;
}

export function buildHumanHandoffAss(input: HumanHandoffAssInput): string {
  const cues = resolveMotionCues(input.chapterStarts);
  validateMotionCues(input.durationSeconds, cues);

  const shopper = cueById(cues, "shopper-brief");
  const youcam = cueById(cues, "youcam-flow");
  const plan = cueById(cues, "primary-backup-plan");
  const decline = cueById(cues, "primary-declines");
  const reroute = cueById(cues, "backup-reroute");
  const ready = cueById(cues, "event-ready");

  const lines = [
    "[Script Info]",
    "; Relay Professional Demo v2 — Human Handoff overlay",
    "ScriptType: v4.00+",
    "PlayResX: 1920",
    "PlayResY: 1080",
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    `Style: Motion,Arial,28,${COLORS.cream},${COLORS.cream},${COLORS.darkGreen},&H80000000,1,0,0,0,100,100,0,0,1,2,0,7,40,40,40,1`,
    `Style: Caption,Arial,38,${COLORS.cream},${COLORS.cream},${COLORS.darkGreen},&H99000000,0,0,0,0,100,100,0,0,1,3,1,2,80,80,50,1`,
    "",
    "[Events]",
    "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
    dialogue(4, shopper.startSeconds, shopper.endSeconds, shopper.id, `{\\an7\\move(70,190,120,190,0,500)\\fad(300,500)\\t(0,450,\\fscx105\\fscy105)${characterDrawing(COLORS.gold)}`),
    dialogue(7, shopper.startSeconds, shopper.endSeconds, shopper.id, `{\\an7\\move(200,310,230,310,100,600)\\fad(300,450)\\1c${COLORS.cream}\\bord2\\3c${COLORS.darkGreen}}SHOPPER`),
    dialogue(7, shopper.startSeconds + 0.25, shopper.endSeconds, shopper.id, `{\\an7\\pos(240,410)\\fad(300,400)\\1c${COLORS.gold}\\bord2\\3c${COLORS.darkGreen}\\p1}m 0 0 l 95 0 l 95 62 l 0 62 l 0 0 m 0 0 l 48 34 l 95 0`),
    dialogue(4, plan.startSeconds, plan.endSeconds, plan.id, `{\\an7\\move(500,220,520,200,0,500)\\fad(300,500)\\t(0,450,\\fscx104\\fscy104)${characterDrawing(COLORS.gold)}`),
    dialogue(5, plan.startSeconds, plan.endSeconds, plan.id, `{\\an7\\move(930,220,910,200,0,500)\\fad(300,500)\\t(0,450,\\fscx104\\fscy104)${characterDrawing(COLORS.coral)}`),
    dialogue(6, plan.startSeconds, plan.endSeconds, plan.id, `{\\an7\\move(1300,220,1280,200,200,700)\\fad(350,500)\\t(0,500,\\fscx104\\fscy104)${characterDrawing(COLORS.green)}`),
    dialogue(7, plan.startSeconds, plan.endSeconds, plan.id, `{\\an7\\pos(1035,320)\\fad(300,450)\\1c${COLORS.cream}\\bord2\\3c${COLORS.darkGreen}}PRIMARY`),
    dialogue(7, plan.startSeconds, plan.endSeconds, plan.id, `{\\an7\\pos(1410,320)\\fad(350,450)\\1c${COLORS.cream}\\bord2\\3c${COLORS.darkGreen}}BACKUP`),
    dialogue(7, plan.startSeconds + 0.2, plan.endSeconds - 0.2, plan.id, `{\\an7\\move(650,310,650,310,200,850)\\fad(250,400)\\1c${COLORS.gold}\\bord0\\p1}m 0 0 l 260 0 l 260 8 l 0 8`),
    dialogue(7, plan.startSeconds + 0.2, plan.endSeconds - 0.2, plan.id, `{\\an7\\move(650,310,910,310,400,1100)\\fad(250,400)\\1c${COLORS.cream}\\bord2\\3c${COLORS.darkGreen}\\p1}m 0 0 l 44 0 l 44 30 l 0 30 l 0 0 m 0 0 l 22 15 l 44 0`),
    dialogue(7, decline.startSeconds, decline.endSeconds, decline.id, `{\\an7\\pos(900,215)\\fad(180,450)\\1c${COLORS.red}\\bord2\\3c${COLORS.darkGreen}\\p1}m 0 0 l 270 0 l 270 64 l 0 64`),
    dialogue(7, decline.startSeconds, decline.endSeconds, decline.id, `{\\an7\\move(965,235,965,250,0,250)\\fad(180,450)\\1c${COLORS.cream}\\bord2\\3c${COLORS.darkGreen}\\t(0,260,\\fscx106\\fscy106)}PRIMARY DECLINES`),
    dialogue(5, decline.startSeconds, decline.endSeconds, decline.id, `{\\an7\\move(910,205,910,228,120,350)\\fad(180,450)\\t(0,300,\\1a&H70&)${characterDrawing(COLORS.coral)}`),
    dialogue(7, decline.startSeconds + 0.2, decline.endSeconds - 0.2, decline.id, `{\\an7\\pos(400,350)\\fad(180,400)\\1c${COLORS.muted}\\bord0\\p1}m 0 0 l 440 0 l 440 8 l 0 8`),
    dialogue(7, reroute.startSeconds, reroute.endSeconds, reroute.id, `{\\an7\\move(400,400,1220,400,150,850)\\fad(240,450)\\1c${COLORS.green}\\bord0\\p1}m 0 0 l 800 0 l 800 10 l 0 10`),
    dialogue(6, reroute.startSeconds, reroute.endSeconds, reroute.id, `{\\an7\\move(1280,215,1280,200,100,420)\\fad(220,450)\\t(0,350,\\fscx107\\fscy107)${characterDrawing(COLORS.green)}`),
    dialogue(7, reroute.startSeconds + 0.25, reroute.endSeconds, reroute.id, `{\\an7\\pos(1285,355)\\fad(250,400)\\1c${COLORS.green}\\bord2\\3c${COLORS.darkGreen}}BACKUP READY`),
    dialogue(7, reroute.startSeconds + 0.5, reroute.endSeconds, reroute.id, `{\\an7\\pos(885,470)\\fad(300,400)\\1c${COLORS.cream}\\bord2\\3c${COLORS.darkGreen}}No new search or upload`),
    dialogue(7, youcam.startSeconds, youcam.endSeconds, youcam.id, `{\\an7\\pos(1080,125)\\fad(300,500)\\1c${COLORS.darkGreen}\\3c${COLORS.cream}\\bord2\\t(0,500,\\fscx103\\fscy103)}Signed upload → Clothes v3 → Private result`),
    dialogue(7, youcam.startSeconds + 0.1, youcam.endSeconds - 0.15, youcam.id, `{\\an7\\move(1060,165,1750,165,150,850)\\fad(250,450)\\1c${COLORS.cream}\\bord0\\p1}m 0 0 l 690 0 l 690 4 l 0 4`),
    dialogue(7, ready.startSeconds, ready.endSeconds, ready.id, `{\\an7\\pos(960,300)\\fad(250,500)\\1c${COLORS.green}\\bord3\\3c${COLORS.darkGreen}\\t(0,450,\\fscx110\\fscy110)\\t(450,900,\\fscx100\\fscy100)}EVENT READY`),
    dialogue(7, ready.startSeconds, ready.endSeconds, ready.id, `{\\an7\\pos(820,365)\\fad(250,450)\\1c${COLORS.green}\\bord0\\p1}m 0 0 l 280 0 l 280 70 l 0 70`),
    ...([[820, 285], [1090, 270], [780, 410], [1140, 400]] as const).map(([x, y], index) => dialogue(7, ready.startSeconds + 0.1 * index, ready.endSeconds - 0.1, ready.id, `{\\an7\\move(${x},${y + 18},${x},${y},0,500)\\fad(180,500)\\1c${COLORS.gold}\\bord0\\p1}m 0 0 l 10 0 l 10 10 l 0 10`)),
  ];

  for (const [index, caption] of input.captions.entries()) {
    if (
      !Number.isFinite(caption.startSeconds) || !Number.isFinite(caption.endSeconds)
      || caption.startSeconds < 0 || caption.endSeconds <= caption.startSeconds
      || caption.endSeconds > input.durationSeconds
    ) {
      throw new Error(`Caption ${index + 1} falls outside the narration duration.`);
    }
    lines.push(`Dialogue: 10,${formatAssTime(caption.startSeconds)},${formatAssTime(caption.endSeconds)},Caption,caption-${index + 1},0,0,0,,{\\an2\\pos(960,1015)\\fad(120,160)}${escapeAssText(caption.text)}`);
  }

  return `${lines.join("\r\n")}\r\n`;
}
