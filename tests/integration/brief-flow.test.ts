import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
  eventBriefs,
  idempotencyKeys,
  matches,
  mediaObjects,
  offers,
  tryOnJobs,
} from "@/lib/db/schema";
import type { TenthsCm } from "@/lib/domain/contracts";
import { MarketplaceRepository } from "@/lib/repositories/marketplace";
import type { ObjectStore } from "@/lib/storage/object-store";
import {
  ResultDownloadError,
  TryOnOrchestrator,
  type ResultDownloader,
} from "@/lib/try-on/orchestrator";
import type { ClothesV3Client } from "@/lib/youcam/client";
import { YouCamError } from "@/lib/youcam/errors";
import { seedIds, seedRelay } from "../../scripts/seed";
import {
  closeTestDatabase,
  migrateTestDatabase,
  resetTestDatabase,
  testDb,
} from "../helpers/test-db";

const cm = (value: number) => value as TenthsCm;
const canonicalBriefId = "50000000-0000-4000-8000-000000000001";
const canonicalSourceMediaId = "50000000-0000-4000-8000-000000000002";
const baseNow = new Date("2026-08-15T12:00:00.000Z");

class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async putPrivate(input: {
    key: string;
    bytes: Uint8Array;
    contentType: "image/jpeg" | "image/png";
  }): Promise<void> {
    this.objects.set(input.key, { bytes: input.bytes, contentType: input.contentType });
  }

  async getPrivate(key: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    const object = this.objects.get(key);
    if (!object) {
      throw new Error("missing test object");
    }
    return object;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async createReadUrl(key: string): Promise<string> {
    return `https://private.example.test/${encodeURIComponent(key)}`;
  }
}

type FakeMode = "processing_then_expired" | "success" | "permanent_expired";

class FakeClothesClient implements ClothesV3Client {
  readonly uploadCalls: Array<{ marker: number; fileName: string }> = [];
  readonly createCalls: Array<{ sourceFileId: string; referenceFileId: string }> = [];
  readonly getCalls = new Map<string, number>();
  readonly failedTaskIds = new Set<string>();
  rateLimited = false;

  constructor(private readonly mode: FakeMode) {}

  async upload(
    bytes: Uint8Array,
    input: { fileName: string; contentType: "image/jpeg" | "image/png" },
  ): Promise<string> {
    const marker = bytes[0] ?? 0;
    this.uploadCalls.push({ marker, fileName: input.fileName });
    return `file-${marker}`;
  }

  async createTask(input: {
    sourceFileId: string;
    referenceFileId: string;
    garmentCategory: "upper_body" | "lower_body" | "full_body";
  }): Promise<string> {
    this.createCalls.push(input);
    return `task-${input.referenceFileId}`;
  }

  async getTask(taskId: string): ReturnType<ClothesV3Client["getTask"]> {
    if (this.rateLimited) {
      throw new YouCamError("rate_limited");
    }
    const call = (this.getCalls.get(taskId) ?? 0) + 1;
    this.getCalls.set(taskId, call);

    if (this.failedTaskIds.has(taskId)) {
      return { status: "error", code: "invalid_reference" };
    }
    if (this.mode === "processing_then_expired" && call === 1) {
      return { status: "processing" };
    }
    if (this.mode === "processing_then_expired" && call === 2) {
      return { status: "success", resultUrl: `https://results.example.test/expired/${taskId}` };
    }
    if (this.mode === "permanent_expired") {
      return { status: "success", resultUrl: `https://results.example.test/expired/${taskId}` };
    }
    return { status: "success", resultUrl: `https://results.example.test/fresh/${taskId}` };
  }
}

class FakeResultDownloader implements ResultDownloader {
  readonly urls: string[] = [];

  async download(url: string): Promise<{ bytes: Uint8Array; contentType: "image/jpeg" }> {
    this.urls.push(url);
    if (url.includes("/expired/")) {
      throw new ResultDownloadError(403);
    }
    return { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0x01]), contentType: "image/jpeg" };
  }
}

async function createOrchestrationHarness(mode: FakeMode) {
  const repository = new MarketplaceRepository(testDb);
  await repository.createMatchesAndJobs({
    briefId: canonicalBriefId,
    actorId: seedIds.shopper,
    idempotencyKey: `orchestration-${mode}`,
    now: baseNow,
  });

  const store = new MemoryObjectStore();
  const persistedMedia = await testDb.select().from(mediaObjects);
  let garmentMarker = 10;
  for (const media of persistedMedia) {
    if (media.kind === "brief_source") {
      store.objects.set(media.objectKey, { bytes: new Uint8Array([1]), contentType: media.contentType });
    } else if (media.kind === "listing_garment") {
      store.objects.set(media.objectKey, {
        bytes: new Uint8Array([garmentMarker]),
        contentType: media.contentType,
      });
      garmentMarker += 1;
    }
  }

  const client = new FakeClothesClient(mode);
  const downloader = new FakeResultDownloader();
  const orchestrator = new TryOnOrchestrator({
    repository,
    client,
    objectStore: store,
    resultDownloader: downloader,
    random: () => 0.5,
  });
  return { repository, store, client, downloader, orchestrator };
}

function minutesAfterBase(minutes: number): Date {
  return new Date(baseNow.getTime() + minutes * 60_000);
}

beforeAll(migrateTestDatabase);
beforeEach(async () => {
  await resetTestDatabase();
  await seedRelay(testDb, { uploadAsset: async () => undefined });
  await testDb.insert(mediaObjects).values({
    id: canonicalSourceMediaId,
    ownerUserId: seedIds.shopper,
    kind: "brief_source",
    objectKey: `briefs/${canonicalBriefId}/source/canonical.png`,
    contentType: "image/png",
    byteSize: 1_024,
    briefId: canonicalBriefId,
  });
  await testDb.insert(eventBriefs).values({
    id: canonicalBriefId,
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
    styleTags: ["minimal", "polished", "statement"],
    exclusions: [],
    shopperMediaId: canonicalSourceMediaId,
    photoConsentAt: new Date("2026-08-15T12:00:00.000Z"),
  });
});
afterAll(closeTestDatabase);

describe("createMatchesAndJobs", () => {
  it("creates one top-three job graph and returns it unchanged for the same idempotency key", async () => {
    const repository = new MarketplaceRepository(testDb);
    const input = {
      briefId: canonicalBriefId,
      actorId: seedIds.shopper,
      idempotencyKey: "canonical-brief-create-001",
      now: new Date("2026-08-15T12:00:00.000Z"),
    };

    const first = await repository.createMatchesAndJobs(input);
    const repeated = await repository.createMatchesAndJobs(input);

    expect(repeated).toEqual(first);
    expect(first.matchIds).toHaveLength(3);
    expect(new Set(first.matchIds)).toHaveLength(3);
    expect(new Set(first.offerIds)).toHaveLength(3);
    expect(new Set(first.jobIds)).toHaveLength(3);

    const persistedMatches = await testDb.select().from(matches);
    const persistedOffers = await testDb.select().from(offers);
    const persistedJobs = await testDb.select().from(tryOnJobs);
    const persistedKeys = await testDb.select().from(idempotencyKeys);

    expect(persistedMatches).toHaveLength(3);
    expect(persistedOffers).toHaveLength(3);
    expect(persistedOffers.every((offer) => offer.status === "matched")).toBe(true);
    expect(persistedJobs).toHaveLength(3);
    expect(persistedJobs.every((job) => job.status === "queued")).toBe(true);
    expect(new Set(persistedJobs.map((job) => job.id))).toHaveLength(3);
    expect(persistedKeys).toHaveLength(1);
  });

  it("serializes concurrent submissions of the same idempotency key", async () => {
    const repository = new MarketplaceRepository(testDb);
    const input = {
      briefId: canonicalBriefId,
      actorId: seedIds.shopper,
      idempotencyKey: "canonical-concurrent-create-001",
      now: baseNow,
    };

    const [left, right] = await Promise.all([
      repository.createMatchesAndJobs(input),
      repository.createMatchesAndJobs(input),
    ]);

    expect(right).toEqual(left);
    expect(await testDb.select().from(matches)).toHaveLength(3);
    expect(await testDb.select().from(tryOnJobs)).toHaveLength(3);
    expect(await testDb.select().from(idempotencyKeys)).toHaveLength(1);
  });
});

describe("TryOnOrchestrator", () => {
  it("advances one persisted phase per call, recovers an expired result URL, and completes all offers", async () => {
    const { client, downloader, orchestrator } = await createOrchestrationHarness(
      "processing_then_expired",
    );

    await orchestrator.advanceBrief(canonicalBriefId, minutesAfterBase(0));
    let jobs = await testDb.select().from(tryOnJobs);
    expect(jobs.every((job) => job.sourceFileId && !job.referenceFileId && !job.externalTaskId)).toBe(
      true,
    );
    expect((await testDb.select().from(offers)).every((offer) => offer.status === "generating")).toBe(
      true,
    );

    await orchestrator.advanceBrief(canonicalBriefId, minutesAfterBase(1));
    jobs = await testDb.select().from(tryOnJobs);
    expect(jobs.every((job) => job.sourceFileId && job.referenceFileId && !job.externalTaskId)).toBe(
      true,
    );

    await orchestrator.advanceBrief(canonicalBriefId, minutesAfterBase(2));
    jobs = await testDb.select().from(tryOnJobs);
    expect(jobs.every((job) => job.externalTaskId && job.status === "processing")).toBe(true);

    await orchestrator.advanceBrief(canonicalBriefId, minutesAfterBase(3));
    jobs = await testDb.select().from(tryOnJobs);
    expect(jobs.every((job) => job.status === "processing" && job.attemptCount === 1)).toBe(true);

    await orchestrator.advanceBrief(canonicalBriefId, minutesAfterBase(4));
    jobs = await testDb.select().from(tryOnJobs);
    const persistedOffers = await testDb.select().from(offers);
    const resultMedia = (await testDb.select().from(mediaObjects)).filter(
      (media) => media.kind === "try_on_result",
    );

    expect(jobs.every((job) => job.status === "succeeded" && job.resultMediaId)).toBe(true);
    expect(persistedOffers.every((offer) => offer.status === "ready")).toBe(true);
    expect(resultMedia).toHaveLength(3);
    expect(client.uploadCalls).toHaveLength(6);
    expect(client.createCalls).toHaveLength(3);
    expect([...client.getCalls.values()]).toEqual([3, 3, 3]);
    expect(downloader.urls.filter((url) => url.includes("/expired/"))).toHaveLength(3);
    expect(downloader.urls.filter((url) => url.includes("/fresh/"))).toHaveLength(3);

    await orchestrator.advanceBrief(canonicalBriefId, minutesAfterBase(5));
    expect(client.createCalls).toHaveLength(3);
  });

  it("isolates a terminal reference failure to one job and offer", async () => {
    const { client, orchestrator } = await createOrchestrationHarness("success");
    await orchestrator.advanceBrief(canonicalBriefId, minutesAfterBase(0));
    await orchestrator.advanceBrief(canonicalBriefId, minutesAfterBase(1));
    await orchestrator.advanceBrief(canonicalBriefId, minutesAfterBase(2));

    const beforePoll = await testDb.select().from(tryOnJobs);
    const failedJob = beforePoll[1]!;
    client.failedTaskIds.add(failedJob.externalTaskId!);
    await orchestrator.advanceBrief(canonicalBriefId, minutesAfterBase(3));

    const outcomes = await testDb
      .select({ jobId: tryOnJobs.id, jobStatus: tryOnJobs.status, offerStatus: offers.status })
      .from(tryOnJobs)
      .innerJoin(offers, eq(offers.matchId, tryOnJobs.matchId));
    expect(outcomes.filter((outcome) => outcome.jobStatus === "failed")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.offerStatus === "failed")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.jobStatus === "succeeded")).toHaveLength(2);
    expect(outcomes.find((outcome) => outcome.jobId === failedJob.id)).toMatchObject({
      jobStatus: "failed",
      offerStatus: "failed",
    });
  });

  it("keeps persisted task state intact when HTTP 429 schedules a retry", async () => {
    const { client, orchestrator } = await createOrchestrationHarness("success");
    await orchestrator.advanceBrief(canonicalBriefId, minutesAfterBase(0));
    await orchestrator.advanceBrief(canonicalBriefId, minutesAfterBase(1));
    await orchestrator.advanceBrief(canonicalBriefId, minutesAfterBase(2));
    const before = await testDb.select().from(tryOnJobs);

    client.rateLimited = true;
    await orchestrator.advanceBrief(canonicalBriefId, minutesAfterBase(3));
    const after = await testDb.select().from(tryOnJobs);

    for (const prior of before) {
      const current = after.find((job) => job.id === prior.id)!;
      expect(current).toEqual({
        ...prior,
        attemptCount: prior.attemptCount + 1,
        nextPollAt: expect.any(Date),
      });
      expect(current.nextPollAt!.getTime()).toBeGreaterThan(minutesAfterBase(3).getTime());
    }
    expect(client.createCalls).toHaveLength(3);
  });

  it("retains the external task and schedules a retry when refreshed result download still fails", async () => {
    const { client, orchestrator } = await createOrchestrationHarness("permanent_expired");
    await orchestrator.advanceBrief(canonicalBriefId, minutesAfterBase(0));
    await orchestrator.advanceBrief(canonicalBriefId, minutesAfterBase(1));
    await orchestrator.advanceBrief(canonicalBriefId, minutesAfterBase(2));
    await orchestrator.advanceBrief(canonicalBriefId, minutesAfterBase(3));

    const jobs = await testDb.select().from(tryOnJobs);
    expect(jobs.every((job) => job.status === "processing")).toBe(true);
    expect(jobs.every((job) => job.externalTaskId && job.attemptCount === 1 && job.nextPollAt)).toBe(
      true,
    );
    expect([...client.getCalls.values()]).toEqual([2, 2, 2]);
  });
});
