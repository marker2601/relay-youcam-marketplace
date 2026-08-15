import { randomUUID } from "node:crypto";

import { S3Client } from "@aws-sdk/client-s3";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createBriefResourceHandlers } from "@/app/api/briefs/[briefId]/route";
import { createDemoSession, demoSessionCookieName } from "@/lib/auth/demo-session";
import {
  eventBriefs,
  mediaObjects,
  offers,
  tryOnJobs,
  users,
} from "@/lib/db/schema";
import type { TenthsCm } from "@/lib/domain/contracts";
import { MarketplaceRepository } from "@/lib/repositories/marketplace";
import type { ObjectStore } from "@/lib/storage/object-store";
import {
  S3ObjectStore,
  createBriefSourceKey,
  createJobResultKey,
  createListingGarmentKey,
} from "@/lib/storage/s3-object-store";
import { seedIds, seedRelay } from "../../scripts/seed";
import {
  closeTestDatabase,
  migrateTestDatabase,
  resetTestDatabase,
  testDb,
} from "../helpers/test-db";

const endpoint = process.env.S3_ENDPOINT ?? "http://localhost:59000";
const bucket = process.env.S3_BUCKET ?? "relay-media";
const client = new S3Client({
  endpoint,
  region: process.env.S3_REGION ?? "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "relay_local",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "relay_local_secret",
  },
});
const store = new S3ObjectStore({ client, bucket });

afterAll(async () => {
  client.destroy();
  await closeTestDatabase();
});

describe("private object storage", () => {
  it("keeps direct reads private, permits a five-minute signed read, and revokes reads on delete", async () => {
    const key = `tests/privacy/${randomUUID()}.png`;
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const directUrl = `${endpoint}/${bucket}/${key}`;

    try {
      await store.putPrivate({ key, bytes, contentType: "image/png" });

      const anonymousResponse = await fetch(directUrl);
      expect(anonymousResponse.ok).toBe(false);
      expect([401, 403, 404]).toContain(anonymousResponse.status);

      const signedUrl = await store.createReadUrl(key, 300);
      const signedResponse = await fetch(signedUrl);
      expect(signedResponse.status).toBe(200);
      expect(new Uint8Array(await signedResponse.arrayBuffer())).toEqual(bytes);

      await store.delete(key);

      const directAfterDelete = await fetch(directUrl);
      expect(directAfterDelete.ok).toBe(false);

      const newlySignedUrl = await store.createReadUrl(key, 300);
      const signedAfterDelete = await fetch(newlySignedUrl);
      expect(signedAfterDelete.ok).toBe(false);
    } finally {
      await store.delete(key);
    }
  });

  it("constructs opaque server-side keys for each media boundary", () => {
    const briefId = "11111111-1111-4111-8111-111111111111";
    const listingId = "22222222-2222-4222-8222-222222222222";
    const jobId = "33333333-3333-4333-8333-333333333333";
    const generatedId = "44444444-4444-4444-8444-444444444444";

    expect(createBriefSourceKey(briefId, "png", () => generatedId)).toBe(
      `briefs/${briefId}/source/${generatedId}.png`,
    );
    expect(createListingGarmentKey(listingId, "jpg", () => generatedId)).toBe(
      `listings/${listingId}/garment/${generatedId}.jpg`,
    );
    expect(createJobResultKey(jobId, () => generatedId)).toBe(
      `jobs/${jobId}/result/${generatedId}.jpg`,
    );
  });
});

const sessionSecret = "privacy-session-secret-at-least-32-characters";
const deletionNow = new Date("2026-08-15T16:00:00.000Z");
const sourceMediaId = "41000000-0000-4000-8000-000000000001";
const briefId = "41000000-0000-4000-8000-000000000002";
const otherShopperId = "41000000-0000-4000-8000-000000000003";
const cm = (value: number) => value as TenthsCm;

class DeletionStore implements ObjectStore {
  readonly objects = new Set<string>();
  readonly deleted: string[] = [];
  readonly failOnce = new Set<string>();

  async putPrivate(input: { key: string }): Promise<void> {
    this.objects.add(input.key);
  }

  async getPrivate(): Promise<{ bytes: Uint8Array; contentType: string }> {
    throw new Error("not used");
  }

  async delete(key: string): Promise<void> {
    if (this.failOnce.delete(key)) {
      throw new Error("temporary object-store failure");
    }
    this.deleted.push(key);
    this.objects.delete(key);
  }

  async createReadUrl(key: string): Promise<string> {
    if (!this.objects.has(key)) throw new Error("missing");
    return `https://private.example.test/${encodeURIComponent(key)}`;
  }
}

function cookieFor(userId: string): string {
  return `${demoSessionCookieName}=${createDemoSession(
    { userId, role: "shopper" },
    sessionSecret,
    deletionNow.getTime(),
  )}`;
}

function deletionRequest(userId: string): Request {
  return new Request(`http://localhost/api/briefs/${briefId}`, {
    method: "DELETE",
    headers: { Cookie: cookieFor(userId) },
  });
}

async function seedDeletableBrief(store: DeletionStore) {
  await seedRelay(testDb, { uploadAsset: async () => undefined });
  await testDb.insert(users).values({
    id: otherShopperId,
    demoRole: "shopper",
    displayName: "Other Shopper",
  });
  const sourceKey = `briefs/${briefId}/source/source.png`;
  store.objects.add(sourceKey);
  await testDb.insert(mediaObjects).values({
    id: sourceMediaId,
    ownerUserId: seedIds.shopper,
    kind: "brief_source",
    objectKey: sourceKey,
    contentType: "image/png",
    byteSize: 512,
    briefId,
    createdAt: deletionNow,
  });
  await testDb.insert(eventBriefs).values({
    id: briefId,
    shopperId: seedIds.shopper,
    eventType: "wedding_guest",
    eventDate: "2026-09-20",
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
    styleTags: ["formal", "polished", "statement"],
    exclusions: [],
    shopperMediaId: sourceMediaId,
    photoConsentAt: deletionNow,
    createdAt: deletionNow,
    updatedAt: deletionNow,
  });

  const graph = await new MarketplaceRepository(testDb).createMatchesAndJobs({
    briefId,
    actorId: seedIds.shopper,
    idempotencyKey: "privacy-delete-graph",
    now: deletionNow,
  });
  const resultRows = graph.jobIds.slice(0, 2).map((jobId, index) => ({
    id: `41000000-0000-4000-8000-00000000001${index}`,
    ownerUserId: seedIds.shopper,
    kind: "try_on_result" as const,
    objectKey: `jobs/${jobId}/result/result-${index}.jpg`,
    contentType: "image/jpeg",
    byteSize: 1024,
    jobId,
    createdAt: deletionNow,
  }));
  for (const result of resultRows) store.objects.add(result.objectKey);
  await testDb.insert(mediaObjects).values(resultRows);
  for (let index = 0; index < 2; index += 1) {
    await testDb
      .update(tryOnJobs)
      .set({
        status: "succeeded",
        resultMediaId: resultRows[index]!.id,
        completedAt: deletionNow,
      })
      .where(eq(tryOnJobs.id, graph.jobIds[index]!));
  }
  await testDb
    .update(tryOnJobs)
    .set({ status: "failed", normalizedErrorCode: "invalid_reference", completedAt: deletionNow })
    .where(eq(tryOnJobs.id, graph.jobIds[2]!));
  await testDb
    .update(offers)
    .set({ status: "ready" })
    .where(inArray(offers.id, graph.offerIds.slice(0, 2)));
  await testDb
    .update(offers)
    .set({ status: "failed" })
    .where(eq(offers.id, graph.offerIds[2]!));

  return { graph, sourceKey, resultRows };
}

describe("brief privacy deletion", () => {
  beforeAll(migrateTestDatabase);
  beforeEach(resetTestDatabase);

  it("revokes owned source and result media while retaining non-image offer audit state", async () => {
    const store = new DeletionStore();
    const seeded = await seedDeletableBrief(store);
    const handlers = createBriefResourceHandlers({
      db: testDb,
      objectStore: store,
      sessionSecret,
      now: () => deletionNow,
    });

    const response = await handlers.delete(deletionRequest(seedIds.shopper), {
      params: Promise.resolve({ briefId }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      briefId,
      status: "deleted",
      message:
        "Relay has deleted its stored copies. Perfect Corp. may retain API files for up to 30 days under its documented policy.",
    });
    const [brief] = await testDb.select().from(eventBriefs).where(eq(eventBriefs.id, briefId));
    expect(brief).toMatchObject({ status: "deleted", shopperMediaId: null });
    const jobs = await testDb
      .select()
      .from(tryOnJobs)
      .where(inArray(tryOnJobs.id, seeded.graph.jobIds));
    expect(jobs.every((job) => job.resultMediaId === null)).toBe(true);
    const ownedMedia = await testDb
      .select()
      .from(mediaObjects)
      .where(
        and(eq(mediaObjects.ownerUserId, seedIds.shopper), eq(mediaObjects.briefId, briefId)),
      );
    const resultMedia = await testDb
      .select()
      .from(mediaObjects)
      .where(inArray(mediaObjects.id, seeded.resultRows.map((result) => result.id)));
    expect([...ownedMedia, ...resultMedia].every((media) => media.deletionStatus === "deleted"))
      .toBe(true);
    expect(store.objects.size).toBe(0);
    expect(new Set(store.deleted)).toEqual(
      new Set([seeded.sourceKey, ...seeded.resultRows.map((result) => result.objectKey)]),
    );
    const auditOffers = await testDb
      .select({ status: offers.status })
      .from(offers)
      .where(inArray(offers.id, seeded.graph.offerIds));
    expect(auditOffers.map((offer) => offer.status).sort()).toEqual(["failed", "ready", "ready"]);

    const replay = await handlers.delete(deletionRequest(seedIds.shopper), {
      params: Promise.resolve({ briefId }),
    });
    expect(replay.status).toBe(200);
  });

  it("does not mutate or delete anything for another shopper", async () => {
    const store = new DeletionStore();
    const seeded = await seedDeletableBrief(store);
    const beforeKeys = new Set(store.objects);
    const handlers = createBriefResourceHandlers({
      db: testDb,
      objectStore: store,
      sessionSecret,
      now: () => deletionNow,
    });

    const response = await handlers.delete(deletionRequest(otherShopperId), {
      params: Promise.resolve({ briefId }),
    });

    expect(response.status).toBe(404);
    expect(store.deleted).toEqual([]);
    expect(store.objects).toEqual(beforeKeys);
    const [brief] = await testDb.select().from(eventBriefs).where(eq(eventBriefs.id, briefId));
    expect(brief).toMatchObject({ status: "active", shopperMediaId: sourceMediaId });
    const jobs = await testDb
      .select()
      .from(tryOnJobs)
      .where(inArray(tryOnJobs.id, seeded.graph.jobIds));
    expect(jobs.filter((job) => job.resultMediaId !== null)).toHaveLength(2);
  });

  it("keeps reads revoked and safely retries a best-effort object deletion", async () => {
    const store = new DeletionStore();
    const seeded = await seedDeletableBrief(store);
    store.failOnce.add(seeded.sourceKey);
    const handlers = createBriefResourceHandlers({
      db: testDb,
      objectStore: store,
      sessionSecret,
      now: () => deletionNow,
    });

    const first = await handlers.delete(deletionRequest(seedIds.shopper), {
      params: Promise.resolve({ briefId }),
    });
    expect(first.status).toBe(202);
    const [failedSource] = await testDb
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.id, sourceMediaId));
    expect(failedSource).toMatchObject({
      deletionStatus: "delete_failed",
      deletionErrorCode: "object_delete_failed",
      deletedAt: null,
    });
    const [briefAfterFirst] = await testDb
      .select()
      .from(eventBriefs)
      .where(eq(eventBriefs.id, briefId));
    expect(briefAfterFirst).toMatchObject({ status: "deleting", shopperMediaId: null });

    const retried = await handlers.delete(deletionRequest(seedIds.shopper), {
      params: Promise.resolve({ briefId }),
    });
    expect(retried.status).toBe(200);
    expect(store.objects.size).toBe(0);
    const [deletedSource] = await testDb
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.id, sourceMediaId));
    expect(deletedSource).toMatchObject({ deletionStatus: "deleted", deletionErrorCode: null });
  });
});
