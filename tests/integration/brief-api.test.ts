// @vitest-environment node

import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createBriefPostHandler } from "@/app/api/briefs/route";
import { createDemoSession, demoSessionCookieName } from "@/lib/auth/demo-session";
import { eventBriefs, matches, mediaObjects } from "@/lib/db/schema";
import type { ObjectStore } from "@/lib/storage/object-store";
import { seedIds, seedRelay } from "../../scripts/seed";
import {
  closeTestDatabase,
  migrateTestDatabase,
  resetTestDatabase,
  testDb,
} from "../helpers/test-db";

const sessionSecret = "brief-api-session-secret-at-least-32-characters";
const now = new Date("2026-08-15T12:00:00.000Z");

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async putPrivate(input: {
    key: string;
    bytes: Uint8Array;
    contentType: "image/jpeg" | "image/png";
  }): Promise<void> {
    this.objects.set(input.key, input);
  }

  async getPrivate(key: string) {
    const object = this.objects.get(key);
    if (!object) throw new Error("missing");
    return object;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async createReadUrl(key: string): Promise<string> {
    return `https://private.example.test/${encodeURIComponent(key)}`;
  }
}

const validCommand = {
  eventType: "wedding_guest",
  eventDate: "2026-09-20",
  eventStartsAt: "2026-09-20T23:00:00.000Z",
  dressCode: "formal",
  budgetMinCents: 5_000,
  budgetMaxCents: 12_000,
  garmentCategory: "full_body",
  sizeLabel: "M",
  measurementProfile: {
    bustTenthsCm: 900,
    waistTenthsCm: 720,
    hipsTenthsCm: 980,
    desiredEaseMinTenthsCm: 20,
    desiredEaseMaxTenthsCm: 120,
  },
  locationBand: "west",
  radiusMiles: 15,
  preferredColors: ["emerald", "navy", "burgundy"],
  styleTags: ["minimal", "polished", "statement"],
  exclusions: [],
  photoConsent: true,
} as const;

let validPng: Uint8Array;
let tooSmallPng: Uint8Array;

beforeAll(async () => {
  await migrateTestDatabase();
  validPng = await sharp({
    create: { width: 512, height: 384, channels: 3, background: "#1d604a" },
  })
    .png()
    .toBuffer();
  tooSmallPng = await sharp({
    create: { width: 320, height: 240, channels: 3, background: "#1d604a" },
  })
    .png()
    .toBuffer();
});
beforeEach(async () => {
  await resetTestDatabase();
  await seedRelay(testDb, { uploadAsset: async () => undefined });
});
afterAll(closeTestDatabase);

function authenticatedCookie(): string {
  const token = createDemoSession(
    { userId: seedIds.shopper, role: "shopper" },
    sessionSecret,
    now.getTime(),
  );
  return `${demoSessionCookieName}=${token}`;
}

function requestWith(
  command: unknown,
  photo: Uint8Array = validPng,
  options: { cookie?: string; idempotencyKey?: string } = {},
): Request {
  const form = new FormData();
  form.set("command", JSON.stringify(command));
  form.set("photo", new File([Uint8Array.from(photo).buffer], "source.png", { type: "image/png" }));
  return new Request("http://localhost/api/briefs", {
    method: "POST",
    headers: {
      Cookie: options.cookie ?? authenticatedCookie(),
      "Idempotency-Key": options.idempotencyKey ?? "brief-command-0001",
    },
    body: form,
  });
}

describe("POST /api/briefs", () => {
  it("rejects an unauthenticated request", async () => {
    const handler = createBriefPostHandler({
      db: testDb,
      objectStore: new MemoryStore(),
      sessionSecret,
      now: () => now,
    });
    const response = await handler(requestWith(validCommand, validPng, { cookie: "missing=1" }));
    expect(response.status).toBe(401);
  });

  it("rejects malformed multipart data", async () => {
    const handler = createBriefPostHandler({
      db: testDb,
      objectStore: new MemoryStore(),
      sessionSecret,
      now: () => now,
    });
    const response = await handler(
      new Request("http://localhost/api/briefs", {
        method: "POST",
        headers: { Cookie: authenticatedCookie(), "Content-Type": "application/json" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects an invalid photo without losing the command error boundary", async () => {
    const handler = createBriefPostHandler({
      db: testDb,
      objectStore: new MemoryStore(),
      sessionSecret,
      now: () => now,
    });
    const response = await handler(requestWith(validCommand, tooSmallPng));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "too_small" });
    expect(await testDb.select().from(eventBriefs)).toHaveLength(0);
  });

  it("requires affirmative photo consent", async () => {
    const handler = createBriefPostHandler({
      db: testDb,
      objectStore: new MemoryStore(),
      sessionSecret,
      now: () => now,
    });
    const response = await handler(requestWith({ ...validCommand, photoConsent: false }));
    expect(response.status).toBe(400);
    expect(await testDb.select().from(eventBriefs)).toHaveLength(0);
  });

  it("creates a private brief and exactly three matches", async () => {
    const store = new MemoryStore();
    const handler = createBriefPostHandler({
      db: testDb,
      objectStore: store,
      sessionSecret,
      now: () => now,
    });
    const response = await handler(requestWith(validCommand));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ outcome: "matched", matchCount: 3 });
    const persistedBriefs = await testDb.select().from(eventBriefs);
    expect(persistedBriefs).toHaveLength(1);
    expect(persistedBriefs[0]!.eventStartsAt.toISOString()).toBe("2026-09-20T23:00:00.000Z");
    expect(await testDb.select().from(matches)).toHaveLength(3);
    expect((await testDb.select().from(mediaObjects)).filter((media) => media.kind === "brief_source"))
      .toHaveLength(1);
    expect(store.objects.size).toBe(1);
  });

  it("returns the first brief without adding rows when the idempotency key is replayed", async () => {
    const store = new MemoryStore();
    const handler = createBriefPostHandler({
      db: testDb,
      objectStore: store,
      sessionSecret,
      now: () => now,
    });
    const first = await handler(requestWith(validCommand));
    const repeated = await handler(requestWith(validCommand));

    expect(await repeated.json()).toEqual(await first.json());
    expect(await testDb.select().from(eventBriefs)).toHaveLength(1);
    expect(await testDb.select().from(matches)).toHaveLength(3);
    expect(store.objects.size).toBe(1);
  });

  it("returns adjustable elimination counts when no listings match", async () => {
    const handler = createBriefPostHandler({
      db: testDb,
      objectStore: new MemoryStore(),
      sessionSecret,
      now: () => now,
    });
    const response = await handler(
      requestWith({ ...validCommand, budgetMinCents: 100, budgetMaxCents: 200 }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "no_matches",
      eliminatedBy: { budget: expect.any(Number) },
    });
  });

  it("removes database and object state when downstream match creation fails", async () => {
    const store = new MemoryStore();
    const handler = createBriefPostHandler({
      db: testDb,
      objectStore: store,
      sessionSecret,
      now: () => now,
      marketplace: {
        createMatchesAndJobs: async () => {
          throw new Error("forced downstream failure");
        },
      },
    });
    const response = await handler(requestWith(validCommand));

    expect(response.status).toBe(500);
    expect(await testDb.select().from(eventBriefs)).toHaveLength(0);
    expect((await testDb.select().from(mediaObjects)).filter((media) => media.kind === "brief_source"))
      .toHaveLength(0);
    expect(store.objects.size).toBe(0);
  });
});
