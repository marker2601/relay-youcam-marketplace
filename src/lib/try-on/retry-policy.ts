export type YouCamFailure =
  | { kind: "http"; status: number }
  | { kind: "network_timeout" }
  | { kind: "engine_error"; code: string }
  | { kind: "invalid_input"; code: string };

export type FailureDisposition = "retryable" | "terminal";

export interface PollScheduleInput {
  /** Zero-based number of the poll being scheduled. */
  attempt: number;
  /** Epoch milliseconds when Relay began processing the persisted job. */
  startedAtMs: number;
  /** Current epoch milliseconds, supplied to keep scheduling deterministic in tests. */
  nowMs: number;
  /** Returns a normalized value from zero through one, inclusive. */
  random: () => number;
}

const baseDelaySeconds = [2, 4, 8, 16, 30, 45] as const;
const maximumPolls = 12;
const jobDeadlineMs = 6 * 60 * 1_000;

export function classifyYouCamFailure(failure: YouCamFailure): FailureDisposition {
  if (failure.kind === "network_timeout") {
    return "retryable";
  }
  if (failure.kind !== "http") {
    return "terminal";
  }

  return failure.status === 429 || (failure.status >= 500 && failure.status <= 599)
    ? "retryable"
    : "terminal";
}

export function nextPollAt(input: PollScheduleInput): number | null {
  if (!Number.isInteger(input.attempt) || input.attempt < 0) {
    throw new RangeError("attempt must be a non-negative integer");
  }
  if (input.attempt >= maximumPolls) {
    return null;
  }

  const deadlineAtMs = input.startedAtMs + jobDeadlineMs;
  if (input.nowMs >= deadlineAtMs) {
    return null;
  }

  const randomValue = input.random();
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue > 1) {
    throw new RangeError("random must return a value between 0 and 1");
  }

  const delayIndex = Math.min(input.attempt, baseDelaySeconds.length - 1);
  const baseDelayMs = baseDelaySeconds[delayIndex]! * 1_000;
  const jitterMultiplier = 0.8 + randomValue * 0.4;
  const scheduledAtMs = input.nowMs + Math.round(baseDelayMs * jitterMultiplier);

  return scheduledAtMs < deadlineAtMs ? scheduledAtMs : null;
}

export function shouldCreateExternalTask(externalTaskId: string | null): boolean {
  return externalTaskId === null;
}
