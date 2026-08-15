import { createHmac, timingSafeEqual } from "node:crypto";

import type { DemoRole } from "@/lib/domain/contracts";

export const demoSessionCookieName = "relay_demo_session";

export interface DemoSession {
  userId: string;
  role: DemoRole;
  expiresAt: number;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createDemoSession(
  actor: { userId: string; role: DemoRole },
  secret: string,
  nowMs = Date.now(),
): string {
  const payload = Buffer.from(
    JSON.stringify({
      userId: actor.userId,
      role: actor.role,
      expiresAt: nowMs + 60 * 60 * 1_000,
    } satisfies DemoSession),
  ).toString("base64url");

  return `${payload}.${sign(payload, secret)}`;
}

function isDemoSession(value: unknown): value is DemoSession {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === 3 &&
    typeof candidate.userId === "string" &&
    candidate.userId.length > 0 &&
    (candidate.role === "shopper" || candidate.role === "provider") &&
    typeof candidate.expiresAt === "number" &&
    Number.isSafeInteger(candidate.expiresAt)
  );
}

export function readDemoSession(
  token: string | undefined,
  secret: string,
  nowMs = Date.now(),
): DemoSession | null {
  if (!token) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }
  const [payload, suppliedSignature] = parts;
  if (!payload || !suppliedSignature) {
    return null;
  }

  const expectedSignature = Buffer.from(sign(payload, secret), "base64url");
  let receivedSignature: Buffer;
  try {
    receivedSignature = Buffer.from(suppliedSignature, "base64url");
  } catch {
    return null;
  }
  if (
    receivedSignature.byteLength !== expectedSignature.byteLength ||
    !timingSafeEqual(receivedSignature, expectedSignature)
  ) {
    return null;
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isDemoSession(decoded) || decoded.expiresAt <= nowMs) {
    return null;
  }

  return decoded;
}

export function sessionTokenFromCookieHeader(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  for (const entry of cookieHeader.split(";")) {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const name = entry.slice(0, separatorIndex).trim();
    if (name === demoSessionCookieName) {
      try {
        return decodeURIComponent(entry.slice(separatorIndex + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
