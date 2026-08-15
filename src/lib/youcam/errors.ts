import { classifyYouCamFailure } from "@/lib/try-on/retry-policy";

export type NormalizedYouCamError =
  | "invalid_source"
  | "invalid_reference"
  | "unsafe_content"
  | "download_failed"
  | "engine_failed"
  | "rate_limited"
  | "transient_upstream"
  | "invalid_upstream_response";

const sourceErrors = new Set([
  "error_pose",
  "error_invalid_src",
  "error_below_min_image_size",
]);
const referenceErrors = new Set(["error_invalid_ref", "error_apply_region_mismatch"]);

export function normalizeEngineError(code: string): NormalizedYouCamError {
  if (sourceErrors.has(code)) {
    return "invalid_source";
  }
  if (referenceErrors.has(code)) {
    return "invalid_reference";
  }
  if (code === "error_nsfw_content_detected") {
    return "unsafe_content";
  }
  if (code === "error_download_image") {
    return "download_failed";
  }
  return "engine_failed";
}

export function isRetryableYouCamError(code: NormalizedYouCamError): boolean {
  return code === "rate_limited" || code === "transient_upstream";
}

export function normalizeHttpError(status: number): NormalizedYouCamError {
  const disposition = classifyYouCamFailure({ kind: "http", status });
  if (status === 429) {
    return "rate_limited";
  }
  return disposition === "retryable" ? "transient_upstream" : "invalid_upstream_response";
}

export class YouCamError extends Error {
  readonly code: NormalizedYouCamError;
  readonly retryable: boolean;

  constructor(code: NormalizedYouCamError) {
    super(`YouCam request failed: ${code}`);
    this.name = "YouCamError";
    this.code = code;
    this.retryable = isRetryableYouCamError(code);
  }
}
