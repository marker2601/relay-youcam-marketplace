import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { eventBriefs, mediaObjects, offers, tryOnJobs } from "@/lib/db/schema";
import type { TenthsCm } from "@/lib/domain/contracts";
import { MarketplaceRepository } from "@/lib/repositories/marketplace";
import { getAuthorizedOfferSnapshot } from "@/lib/repositories/offer-read";
import type { ObjectStore } from "@/lib/storage/object-store";
import { seedIds, seedRelay } from "../../scripts/seed";
import {
  closeTestDatabase,
  migrateTestDatabase,
  resetTestDatabase,
  testDb,
} from "../helpers/test-db";

const cm = (value: number) => value as TenthsCm;
const briefId = "51000000-0000-4000-8000-000000000001";
const sourceMediaId = "51000000-0000-4000-8000-000000000002";
const resultMediaId = "51000000-0000-4000-8000-000000000003";
const now = new Date("2026-08-15T12:00:00.000Z");

class RecordingObjectStore implements ObjectStore {
  readonly signedKeys: string[] = [];

  async putPrivate(): Promise<void> {}
  async getPrivate(): Promise<{ bytes: Uint8Array; contentType: string }> {
    throw new Error("not used");
  }
  async delete(): Promise<void> {}
  async createReadUrl(key: string, expiresInSeconds: number): Promise<string> {
    this.signedKeys.push(key);
    return `https://relay-storage.test/read/${encodeURIComponent(key)}?ttl=${expiresInSeconds}`;
  }
}

beforeAll(migrateTestDatabase);
beforeEach(async () => {
  await resetTestDatabase();
  await seedRelay(testDb, { uploadAsset: async () => undefined });
  await testDb.insert(mediaObjects).values({
    id: sourceMediaId,
    ownerUserId: seedIds.shopper,
    kind: "brief_source",
    objectKey: `briefs/${briefId}/source.png`,
    contentType: "image/png",
    byteSize: 1_024,
    briefId,
  });
  await testDb.insert(eventBriefs).values({
    id: briefId,
    shopperId: seedIds.shopper,
    eventType: "wedding_guest",
    eventDate: "2026-09-20",
    eventStartsAt: new Date("2026-09-21T00:00:00.000Z"),
    dressCode: "formal",
    budgetMinCents: 5_000,
    budgetMaxCents: 12_000,
    garmentCategory: "full_body",
    sizeLabel: "M",
    measurementProfile: {
      bustTenthsCm: cm(900),
      waistTenthsCm: cm(720),
      hipsTenthsCm: cm(980),
      desiredEaseMinTenthsCm: cm(20),
      desiredEaseMaxTenthsCm: cm(120),
    },
    locationBand: "west",
    radiusMiles: 15,
    preferredColors: ["emerald", "navy", "burgundy"],
    styleTags: ["minimal", "polished", "statement"],
    exclusions: [],
    shopperMediaId: sourceMediaId,
    photoConsentAt: now,
  });
  const graph = await new MarketplaceRepository(testDb).createMatchesAndJobs({
    briefId,
    actorId: seedIds.shopper,
    idempotencyKey: "offer-read-model",
    now,
  });

  await testDb.insert(mediaObjects).values({
    id: resultMediaId,
    ownerUserId: seedIds.shopper,
    kind: "try_on_result",
    objectKey: `briefs/${briefId}/results/ready.jpg`,
    contentType: "image/jpeg",
    byteSize: 2_048,
    jobId: graph.jobIds[0],
  });
  await testDb
    .update(tryOnJobs)
    .set({ status: "succeeded", resultMediaId, completedAt: now })
    .where(eq(tryOnJobs.id, graph.jobIds[0]!));
  await testDb.update(offers).set({ status: "ready" }).where(eq(offers.id, graph.offerIds[0]!));
  await testDb
    .update(tryOnJobs)
    .set({ status: "failed", normalizedErrorCode: "invalid_reference", completedAt: now })
    .where(eq(tryOnJobs.id, graph.jobIds[2]!));
  await testDb.update(offers).set({ status: "failed" }).where(eq(offers.id, graph.offerIds[2]!));
});
afterAll(closeTestDatabase);

describe("authorized offer read model", () => {
  it("projects an ordered assurance plan with explainable readiness", async () => {
    const store = new RecordingObjectStore();
    const snapshot = await getAuthorizedOfferSnapshot(
      testDb,
      { userId: seedIds.shopper, role: "shopper" },
      briefId,
      store,
      now,
    );

    expect(snapshot.offers).toHaveLength(3);
    expect(snapshot).toMatchObject({
      eventStartsAt: "2026-09-21T00:00:00.000Z",
      urgency: "planned",
      assuranceCoverage: "primary_and_backup",
    });
    expect(snapshot.offers.map((offer) => offer.assuranceRole)).toEqual([
      "primary",
      "backup",
      "alternative",
    ]);
    expect(snapshot.offers[0]!.readiness.total).toBeGreaterThanOrEqual(0);
    expect(snapshot.offers[0]!.readiness.total).toBeLessThanOrEqual(100);
    expect(snapshot.offers.every((offer) => offer.originalImageUrl.startsWith("https://relay-storage.test/read/"))).toBe(true);
    expect(snapshot.offers.filter((offer) => offer.resultImageUrl)).toHaveLength(1);
    expect(snapshot.offers.find((offer) => offer.status === "ready")?.resultImageUrl).toContain(
      encodeURIComponent(`briefs/${briefId}/results/ready.jpg`),
    );
    expect(store.signedKeys).toHaveLength(4);
    expect(snapshot.sourcePhotoNeedsReplacement).toBe(false);
    expect(snapshot.offers.find((offer) => offer.status === "failed")?.failureGuidance).toBe(
      "listing_image",
    );
    expect(JSON.stringify(snapshot)).not.toContain("invalid_reference");
    expect(JSON.stringify(snapshot)).not.toContain("objectKey");
    expect(JSON.stringify(snapshot)).not.toContain("youcam");
  });

  it("authorizes ownership before signing any object", async () => {
    const store = new RecordingObjectStore();

    await expect(
      getAuthorizedOfferSnapshot(
        testDb,
        { userId: seedIds.peerJordan, role: "shopper" },
        briefId,
        store,
        now,
      ),
    ).rejects.toMatchObject({ name: "NotFoundError" });
    expect(store.signedKeys).toEqual([]);
  });

  it("returns only a safe photo-replacement signal for invalid shopper sources", async () => {
    await testDb
      .update(tryOnJobs)
      .set({ normalizedErrorCode: "invalid_source" })
      .where(eq(tryOnJobs.status, "failed"));
    const snapshot = await getAuthorizedOfferSnapshot(
      testDb,
      { userId: seedIds.shopper, role: "shopper" },
      briefId,
      new RecordingObjectStore(),
      now,
    );

    expect(snapshot.sourcePhotoNeedsReplacement).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain("invalid_source");
  });

  it("keeps a post-event offer history readable", async () => {
    await testDb
      .update(eventBriefs)
      .set({ eventStartsAt: new Date("2026-08-14T12:00:00.000Z") })
      .where(eq(eventBriefs.id, briefId));

    await expect(
      getAuthorizedOfferSnapshot(
        testDb,
        { userId: seedIds.shopper, role: "shopper" },
        briefId,
        new RecordingObjectStore(),
        now,
      ),
    ).resolves.toMatchObject({
      eventStartsAt: "2026-08-14T12:00:00.000Z",
      urgency: "tonight",
    });
  });

  it("projects coherent roles for ready offers migrated with alternative defaults", async () => {
    await testDb.update(offers).set({ assuranceRole: "alternative" });

    const snapshot = await getAuthorizedOfferSnapshot(
      testDb,
      { userId: seedIds.shopper, role: "shopper" },
      briefId,
      new RecordingObjectStore(),
      now,
    );

    expect(snapshot.assuranceCoverage).toBe("primary_and_backup");
    expect(snapshot.offers.map((offer) => offer.assuranceRole)).toEqual([
      "primary",
      "backup",
      "alternative",
    ]);
  });
});
