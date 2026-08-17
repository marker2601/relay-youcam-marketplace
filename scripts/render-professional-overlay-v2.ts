import { lstat, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildHumanHandoffAss,
  type CaptionCue,
  type HumanHandoffAssInput,
  validateMotionCues,
} from "./video/professional-demo-v2";

export type OverlayRendererPaths = Readonly<{
  timingPath: string;
  captionPath: string;
  outputPath: string;
  repositoryRoot?: string;
}>;

type TimingManifest = Readonly<{
  audioDurationSeconds: number;
  chapterStarts: NonNullable<HumanHandoffAssInput["chapterStarts"]>;
}>;

function isInsideDirectory(path: string, directory: string): boolean {
  const pathFromDirectory = relative(directory, path);
  return pathFromDirectory === "" || (!pathFromDirectory.startsWith("..") && !pathFromDirectory.includes(":\\"));
}

async function resolveRepositoryPath(path: string, repositoryRoot: string, kind: "input" | "output"): Promise<string> {
  const resolvedPath = resolve(path);
  if (kind === "input") {
    let realInputPath: string;
    try {
      realInputPath = await realpath(resolvedPath);
      const details = await stat(realInputPath);
      if (!details.isFile()) throw new Error("not a file");
    } catch {
      throw new Error(`Required input file does not exist: ${resolvedPath}`);
    }
    if (!isInsideDirectory(realInputPath, repositoryRoot)) {
      throw new Error("Input path must stay inside the repository.");
    }
    return realInputPath;
  } else {
    let realParentDirectory: string;
    try {
      realParentDirectory = await realpath(dirname(resolvedPath));
      const parent = await stat(realParentDirectory);
      if (!parent.isDirectory()) throw new Error("not a directory");
    } catch {
      throw new Error(`Output directory does not exist: ${dirname(resolvedPath)}`);
    }
    const realOutputPath = resolve(realParentDirectory, basename(resolvedPath));
    if (!isInsideDirectory(realOutputPath, repositoryRoot)) {
      throw new Error("Output path must stay inside the repository.");
    }
    try {
      if ((await lstat(realOutputPath)).isSymbolicLink()) {
        throw new Error("Output path cannot be a symbolic link.");
      }
    } catch (error) {
      if (error instanceof Error && error.message === "Output path cannot be a symbolic link.") throw error;
    }
    return realOutputPath;
  }
}

function assertTimingManifest(value: unknown): TimingManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Timing JSON must be an object.");
  }
  const timing = value as Partial<TimingManifest>;
  if (!Number.isFinite(timing.audioDurationSeconds) || timing.audioDurationSeconds! <= 0) {
    throw new Error("Timing JSON must include a positive audioDurationSeconds value.");
  }
  if (!timing.chapterStarts || typeof timing.chapterStarts !== "object") {
    throw new Error("Timing JSON must include chapterStarts.");
  }
  return { audioDurationSeconds: timing.audioDurationSeconds!, chapterStarts: timing.chapterStarts };
}

function assertCaptions(value: unknown): readonly CaptionCue[] {
  if (!Array.isArray(value)) throw new Error("Caption JSON must be an array.");
  return value.map((caption, index) => {
    if (!caption || typeof caption !== "object") throw new Error(`Caption ${index + 1} must be an object.`);
    const candidate = caption as Partial<CaptionCue>;
    if (
      !Number.isFinite(candidate.startSeconds) || !Number.isFinite(candidate.endSeconds)
      || typeof candidate.text !== "string"
    ) {
      throw new Error(`Caption ${index + 1} is malformed.`);
    }
    return Object.freeze({
      startSeconds: candidate.startSeconds!,
      endSeconds: candidate.endSeconds!,
      text: candidate.text,
    });
  });
}

export async function runOverlayRenderer(paths: OverlayRendererPaths): Promise<void> {
  const repositoryRoot = await realpath(resolve(paths.repositoryRoot ?? process.cwd()));
  const timingPath = await resolveRepositoryPath(paths.timingPath, repositoryRoot, "input");
  const captionPath = await resolveRepositoryPath(paths.captionPath, repositoryRoot, "input");
  const outputPath = await resolveRepositoryPath(paths.outputPath, repositoryRoot, "output");

  const timings = assertTimingManifest(JSON.parse(await readFile(timingPath, "utf8")));
  const captions = assertCaptions(JSON.parse(await readFile(captionPath, "utf8")));
  validateMotionCues(timings.audioDurationSeconds);
  await writeFile(outputPath, buildHumanHandoffAss({
    durationSeconds: timings.audioDurationSeconds,
    chapterStarts: timings.chapterStarts,
    captions,
  }), "utf8");
}

function parseCliArguments(arguments_: readonly string[]): OverlayRendererPaths {
  if (arguments_.length !== 6) {
    throw new Error("Use --timings <path> --captions <path> --output <path>.");
  }
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if ((flag !== "--timings" && flag !== "--captions" && flag !== "--output") || !value || values.has(flag)) {
      throw new Error("Use --timings <path> --captions <path> --output <path>.");
    }
    values.set(flag, value);
  }
  return {
    timingPath: values.get("--timings")!,
    captionPath: values.get("--captions")!,
    outputPath: values.get("--output")!,
  };
}

const isCliInvocation = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCliInvocation) {
  runOverlayRenderer(parseCliArguments(process.argv.slice(2))).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
