import { randomUUID } from "node:crypto";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = "HttpError";
  }
}

export class ValidationHttpError extends HttpError {
  constructor(code = "invalid_request") {
    super(400, code);
    this.name = "ValidationHttpError";
  }
}

export class UnauthenticatedHttpError extends HttpError {
  constructor() {
    super(401, "unauthenticated");
    this.name = "UnauthenticatedHttpError";
  }
}

export class NotFoundHttpError extends HttpError {
  constructor() {
    super(404, "not_found");
    this.name = "NotFoundHttpError";
  }
}

export class ConflictHttpError extends HttpError {
  constructor(code = "conflict") {
    super(409, code);
    this.name = "ConflictHttpError";
  }
}

export class PayloadTooLargeHttpError extends HttpError {
  constructor() {
    super(413, "payload_too_large");
    this.name = "PayloadTooLargeHttpError";
  }
}

export class RateLimitedHttpError extends HttpError {
  constructor() {
    super(429, "rate_limited");
    this.name = "RateLimitedHttpError";
  }
}

function safeError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }
  return new HttpError(500, "internal_error");
}

export function toHttpErrorResponse(
  error: unknown,
  requestId: string = randomUUID(),
): Response {
  const mapped = safeError(error);
  return Response.json(
    { code: mapped.code, requestId },
    {
      status: mapped.status,
      headers: {
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
      },
    },
  );
}
