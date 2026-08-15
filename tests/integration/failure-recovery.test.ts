// @vitest-environment node

import { describe, expect, it } from "vitest";

import type {
  ClaimedTryOnJob,
  MarketplaceRepository,
} from "@/lib/repositories/marketplace";
import type { ObjectStore } from "@/lib/storage/object-store";
import {
  ResultDownloadError,
  TryOnOrchestrator,
  type ResultDownloader,
} from "@/lib/try-on/orchestrator";
import {
  YouCamClothesV3Client,
  type ClothesV3Client,
} from "@/lib/youcam/client";
import {
  YouCamError,
  type NormalizedYouCamError,
} from "@/lib/youcam/errors";

const now = new Date("2026-08-15T16:00:00.000Z");

function processingJob(overrides: Partial<ClaimedTryOnJob> = {}): ClaimedTryOnJob {
  return {
    id: "61000000-0000-4000-8000-000000000001",
    matchId: "61000000-0000-4000-8000-000000000002",
    status: "processing",
    attemptCount: 0,
    sourceFileId: "source-file",
    referenceFileId: "reference-file",
    externalTaskId: "external-task",
    createdAt: now,
    shopperId: "61000000-0000-4000-8000-000000000003",
    garmentCategory: "full_body",
    sourceObjectKey: "briefs/source.png",
    sourceContentType: "image/png",
    referenceObjectKey: "listings/reference.png",
    referenceContentType: "image/png",
    ...overrides,
  };
}

class RecordingRepository {
  claims = 0;
  failed: Array<{ code: NormalizedYouCamError }> = [];
  scheduled: Array<{ nextPollAt: Date }> = [];
  completed = 0;

  constructor(readonly job: ClaimedTryOnJob) {}

  async claimDueJobs(): Promise<ClaimedTryOnJob[]> {
    this.claims += 1;
    return this.claims === 1 ? [this.job] : [];
  }

  async failJob(input: { code: NormalizedYouCamError }): Promise<void> {
    this.failed.push(input);
  }

  async schedulePoll(input: { nextPollAt: Date }): Promise<void> {
    this.scheduled.push(input);
  }

  async completeJob(): Promise<string> {
    this.completed += 1;
    return "61000000-0000-4000-8000-000000000004";
  }
}

class MemoryStore implements ObjectStore {
  readonly written: string[] = [];

  async putPrivate(input: { key: string }): Promise<void> {
    this.written.push(input.key);
  }

  async getPrivate(): Promise<{ bytes: Uint8Array; contentType: string }> {
    return { bytes: new Uint8Array([1]), contentType: "image/png" };
  }

  async delete(): Promise<void> {}

  async createReadUrl(): Promise<string> {
    return "https://private.example.test/signed";
  }
}

function orchestrator(input: {
  repository: RecordingRepository;
  client: ClothesV3Client;
  downloader?: ResultDownloader;
  store?: MemoryStore;
}) {
  return new TryOnOrchestrator({
    repository: input.repository as unknown as MarketplaceRepository,
    client: input.client,
    objectStore: input.store ?? new MemoryStore(),
    resultDownloader:
      input.downloader ??
      ({
        download: async () => ({
          bytes: new Uint8Array([0xff, 0xd8, 0xff]),
          contentType: "image/jpeg" as const,
        }),
      } satisfies ResultDownloader),
    random: () => 0.5,
  });
}

function taskClient(
  getTask: ClothesV3Client["getTask"],
): ClothesV3Client {
  return {
    upload: async () => "uploaded-file",
    createTask: async () => "created-task",
    getTask,
  };
}

describe("YouCam failure recovery", () => {
  it.each(["invalid_source", "invalid_reference", "engine_failed"] as const)(
    "isolates terminal %s failures to the affected preview",
    async (code) => {
      const repository = new RecordingRepository(processingJob());
      const runner = orchestrator({
        repository,
        client: taskClient(async () => ({ status: "error", code })),
      });

      await runner.advanceBrief("brief", now);

      expect(repository.failed).toEqual([expect.objectContaining({ code })]);
      expect(repository.scheduled).toEqual([]);
    },
  );

  it.each(["rate_limited", "transient_upstream"] as const)(
    "preserves a persisted external task when %s is retryable",
    async (code) => {
      const job = processingJob();
      const repository = new RecordingRepository(job);
      const runner = orchestrator({
        repository,
        client: taskClient(async () => {
          throw new YouCamError(code);
        }),
      });

      await runner.advanceBrief("brief", now);

      expect(job.externalTaskId).toBe("external-task");
      expect(repository.failed).toEqual([]);
      expect(repository.scheduled).toHaveLength(1);
      expect(repository.scheduled[0]!.nextPollAt.getTime()).toBeGreaterThan(now.getTime());
    },
  );

  it("stops retrying at the six-minute deadline and exposes a manual recovery state", async () => {
    const repository = new RecordingRepository(
      processingJob({ createdAt: new Date(now.getTime() - 6 * 60_000) }),
    );
    const runner = orchestrator({
      repository,
      client: taskClient(async () => {
        throw new YouCamError("transient_upstream");
      }),
    });

    await runner.advanceBrief("brief", now);

    expect(repository.scheduled).toEqual([]);
    expect(repository.failed).toEqual([
      expect.objectContaining({ code: "transient_upstream" }),
    ]);
  });

  it("refreshes one expired result URL, persists the bytes, and ignores a duplicate poll", async () => {
    let taskReads = 0;
    let downloads = 0;
    const repository = new RecordingRepository(processingJob());
    const store = new MemoryStore();
    const runner = orchestrator({
      repository,
      store,
      client: taskClient(async () => {
        taskReads += 1;
        return {
          status: "success",
          resultUrl:
            taskReads === 1
              ? "https://results.example.test/expired"
              : "https://results.example.test/refreshed",
        };
      }),
      downloader: {
        async download(url) {
          downloads += 1;
          if (url.endsWith("/expired")) throw new ResultDownloadError(403);
          return { bytes: new Uint8Array([0xff, 0xd8, 0xff]), contentType: "image/jpeg" };
        },
      },
    });

    await runner.advanceBrief("brief", now);
    await runner.advanceBrief("brief", now);

    expect(taskReads).toBe(2);
    expect(downloads).toBe(2);
    expect(repository.completed).toBe(1);
    expect(store.written).toHaveLength(1);
  });

  it.each([
    [429, "rate_limited", true],
    [503, "transient_upstream", true],
  ] as const)("normalizes HTTP %s without exposing the upstream body", async (status, code, retryable) => {
    const client = new YouCamClothesV3Client({
      apiKey: "youcam-secret-key-should-never-leak",
      fetchImpl: async () =>
        Response.json({ private: "upstream diagnostic" }, { status }),
    });

    await expect(client.getTask("task")).rejects.toMatchObject({ code, retryable });
  });

  it.each([
    ["network timeout", async () => { throw new Error("socket timeout"); }, "transient_upstream"],
    [
      "malformed 200",
      async () => Response.json({ status: 200, data: { task_status: "success" } }),
      "invalid_upstream_response",
    ],
  ] as const)("normalizes a %s response", async (_name, fetchImpl, code) => {
    const client = new YouCamClothesV3Client({
      apiKey: "youcam-secret-key-should-never-leak",
      fetchImpl,
    });
    await expect(client.getTask("task")).rejects.toMatchObject({ code });
  });
});
