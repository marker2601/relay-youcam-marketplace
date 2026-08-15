// @vitest-environment node

import { readFile } from "node:fs/promises";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createListingPostHandler } from "@/app/api/listings/route";
import { createDemoSession, demoSessionCookieName } from "@/lib/auth/demo-session";
import { listings } from "@/lib/db/schema";
import type { ObjectStore } from "@/lib/storage/object-store";
import { seedIds, seedRelay } from "../../scripts/seed";
import {
  closeTestDatabase,
  migrateTestDatabase,
  resetTestDatabase,
  testDb,
} from "../helpers/test-db";

const secret = "listing-api-session-secret-at-least-32-characters";
const now = new Date("2026-08-15T12:00:00.000Z");

class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  async putPrivate(input: { key: string; bytes: Uint8Array }): Promise<void> {
    this.objects.set(input.key, input.bytes);
  }
  async getPrivate(): Promise<{ bytes: Uint8Array; contentType: string }> {
    throw new Error("not used");
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
  async createReadUrl(): Promise<string> {
    throw new Error("not used");
  }
}

const command = {
  title: "Copper Bias-Cut Midi",
  garmentCategory: "full_body",
  sizeLabel: "M",
  measurements: {
    bustTenthsCm: 960,
    waistTenthsCm: 780,
    hipsTenthsCm: 1040,
    lengthTenthsCm: 1180,
  },
  condition: "excellent",
  colorTags: ["copper"],
  styleTags: ["formal", "minimal"],
  rentalPriceCents: 7_200,
  depositDisplayCents: 3_500,
  serviceRadiusMiles: 20,
  locationBand: "west",
  unavailableRanges: [],
};

function request(form: FormData, userId: string = seedIds.boutique) {
  const token = createDemoSession({ userId, role: userId === seedIds.shopper ? "shopper" : "provider" }, secret, now.getTime());
  return new Request("http://localhost/api/listings", {
    method: "POST",
    headers: { cookie: `${demoSessionCookieName}=${token}` },
    body: form,
  });
}

beforeAll(migrateTestDatabase);
beforeEach(async () => {
  await resetTestDatabase();
  await seedRelay(testDb, { uploadAsset: async () => undefined });
});
afterAll(closeTestDatabase);

describe("POST /api/listings", () => {
  it("rejects missing measurements or a missing photo without storing anything", async () => {
    const store = new MemoryObjectStore();
    const handler = createListingPostHandler({ db: testDb, objectStore: store, sessionSecret: secret, now: () => now });
    const missingMeasurements = new FormData();
    const invalid = { ...command } as Record<string, unknown>;
    delete invalid.measurements;
    missingMeasurements.set("command", JSON.stringify(invalid));
    missingMeasurements.set("photo", new File([await readFile("public/demo/garments/emerald-midi.png")], "garment.png", { type: "image/png" }));
    const noPhoto = new FormData();
    noPhoto.set("command", JSON.stringify(command));

    expect((await handler(request(missingMeasurements))).status).toBe(400);
    expect((await handler(request(noPhoto))).status).toBe(400);
    expect(store.objects.size).toBe(0);
    expect(await testDb.select().from(listings)).toHaveLength(5);
  });

  it("creates complete provider-owned inventory with a private garment object", async () => {
    const store = new MemoryObjectStore();
    const handler = createListingPostHandler({ db: testDb, objectStore: store, sessionSecret: secret, now: () => now });
    const form = new FormData();
    form.set("command", JSON.stringify(command));
    form.set("photo", new File([await readFile("public/demo/garments/emerald-midi.png")], "garment.png", { type: "image/png" }));

    const response = await handler(request(form));
    const body = await response.json() as { listingId: string; version: number };

    expect(response.status).toBe(201);
    expect(body.version).toBe(1);
    expect(store.objects.size).toBe(1);
    expect(await testDb.select().from(listings)).toHaveLength(6);
  });

  it("hides provider commands from shopper sessions", async () => {
    const store = new MemoryObjectStore();
    const handler = createListingPostHandler({ db: testDb, objectStore: store, sessionSecret: secret, now: () => now });
    const form = new FormData();
    form.set("command", JSON.stringify(command));
    form.set("photo", new File([await readFile("public/demo/garments/emerald-midi.png")], "garment.png", { type: "image/png" }));

    expect((await handler(request(form, seedIds.shopper))).status).toBe(404);
    expect(store.objects.size).toBe(0);
  });
});
