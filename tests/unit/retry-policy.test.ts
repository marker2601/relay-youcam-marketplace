import { describe, expect, it } from "vitest";

import {
  classifyYouCamFailure,
  nextPollAt,
  shouldCreateExternalTask,
} from "@/lib/try-on/retry-policy";

describe("classifyYouCamFailure", () => {
  it.each([
    [{ kind: "http", status: 429 }, "retryable"],
    [{ kind: "http", status: 500 }, "retryable"],
    [{ kind: "http", status: 599 }, "retryable"],
    [{ kind: "network_timeout" }, "retryable"],
    [{ kind: "http", status: 400 }, "terminal"],
    [{ kind: "engine_error", code: "person_not_detected" }, "terminal"],
    [{ kind: "invalid_input", code: "unsupported_image" }, "terminal"],
  ] as const)("classifies %o as %s", (failure, expected) => {
    expect(classifyYouCamFailure(failure)).toBe(expected);
  });
});

describe("nextPollAt", () => {
  const startedAtMs = Date.UTC(2026, 7, 15, 12, 0, 0);

  it("uses the bounded base delay sequence with deterministic neutral jitter", () => {
    const expectedSeconds = [2, 4, 8, 16, 30, 45, 45, 45];

    expectedSeconds.forEach((seconds, attempt) => {
      expect(
        nextPollAt({
          attempt,
          startedAtMs,
          nowMs: startedAtMs,
          random: () => 0.5,
        }),
      ).toBe(startedAtMs + seconds * 1_000);
    });
  });

  it("keeps jitter inside plus or minus twenty percent", () => {
    expect(
      nextPollAt({ attempt: 4, startedAtMs, nowMs: startedAtMs, random: () => 0 }),
    ).toBe(startedAtMs + 24_000);
    expect(
      nextPollAt({ attempt: 4, startedAtMs, nowMs: startedAtMs, random: () => 1 }),
    ).toBe(startedAtMs + 36_000);
  });

  it("stops after twelve polls", () => {
    expect(
      nextPollAt({ attempt: 11, startedAtMs, nowMs: startedAtMs, random: () => 0.5 }),
    ).toBe(startedAtMs + 45_000);
    expect(
      nextPollAt({ attempt: 12, startedAtMs, nowMs: startedAtMs, random: () => 0.5 }),
    ).toBeNull();
  });

  it("never schedules a poll at or beyond the six-minute deadline", () => {
    const justBeforeDeadline = startedAtMs + 359_000;
    expect(
      nextPollAt({
        attempt: 2,
        startedAtMs,
        nowMs: justBeforeDeadline,
        random: () => 0.5,
      }),
    ).toBeNull();
    expect(
      nextPollAt({
        attempt: 2,
        startedAtMs,
        nowMs: startedAtMs + 360_000,
        random: () => 0.5,
      }),
    ).toBeNull();
  });

  it("rejects random sources outside the normalized range", () => {
    expect(() =>
      nextPollAt({ attempt: 0, startedAtMs, nowMs: startedAtMs, random: () => 1.01 }),
    ).toThrow("random");
  });
});

describe("external task creation", () => {
  it("allows one creation before an external task ID exists and never recreates afterward", () => {
    expect(shouldCreateExternalTask(null)).toBe(true);
    expect(shouldCreateExternalTask("youcam-task-123")).toBe(false);
  });
});
