import { describe, expect, it } from "vitest";

import {
  createDemoSession,
  readDemoSession,
  serializeDemoSessionCookie,
} from "@/lib/auth/demo-session";

const secret = "unit-test-session-secret-with-32-characters";
const now = Date.UTC(2026, 7, 15, 12, 0, 0);
const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  role: "shopper" as const,
};

function tamperPayload(token: string, mutate: (payload: Record<string, unknown>) => void): string {
  const [encodedPayload, signature] = token.split(".");
  const payload = JSON.parse(Buffer.from(encodedPayload!, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
  mutate(payload);
  return `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`;
}

describe("signed demo sessions", () => {
  it("round-trips only the actor identity and one-hour expiry", () => {
    const token = createDemoSession(actor, secret, now);

    expect(readDemoSession(token, secret, now + 59 * 60_000)).toEqual({
      ...actor,
      expiresAt: now + 60 * 60_000,
    });
  });

  it.each([
    ["user", (payload: Record<string, unknown>) => { payload.userId = "attacker"; }],
    ["role", (payload: Record<string, unknown>) => { payload.role = "provider"; }],
    ["expiry", (payload: Record<string, unknown>) => { payload.expiresAt = now + 86_400_000; }],
  ] as const)("rejects a tampered %s value", (_name, mutate) => {
    const token = createDemoSession(actor, secret, now);
    expect(readDemoSession(tamperPayload(token, mutate), secret, now)).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = createDemoSession(actor, secret, now);
    expect(readDemoSession(token, secret, now + 60 * 60_000)).toBeNull();
  });

  it("emits hardened cookie attributes and enables Secure only in production", () => {
    const token = createDemoSession(actor, secret, now);
    const production = serializeDemoSessionCookie(token, true);
    const local = serializeDemoSessionCookie(token, false);

    for (const cookie of [production, local]) {
      expect(cookie).toContain("relay_demo_session=");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Path=/");
      expect(cookie).toContain("Max-Age=3600");
    }
    expect(production).toContain("Secure");
    expect(local).not.toContain("Secure");
  });
});
