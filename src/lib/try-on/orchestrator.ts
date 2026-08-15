import type { MarketplaceRepository, ClaimedTryOnJob } from "@/lib/repositories/marketplace";
import type { ObjectStore } from "@/lib/storage/object-store";
import { createJobResultKey } from "@/lib/storage/s3-object-store";
import { nextPollAt } from "@/lib/try-on/retry-policy";
import type { ClothesV3Client } from "@/lib/youcam/client";
import { YouCamError, type NormalizedYouCamError } from "@/lib/youcam/errors";

type ImageContentType = "image/jpeg" | "image/png";

export interface ResultDownloader {
  download(url: string): Promise<{ bytes: Uint8Array; contentType: ImageContentType }>;
}

export class ResultDownloadError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("YouCam result download failed");
    this.name = "ResultDownloadError";
    this.status = status;
  }
}

export class FetchResultDownloader implements ResultDownloader {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async download(url: string): Promise<{ bytes: Uint8Array; contentType: ImageContentType }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let response: Response;
    try {
      response = await this.fetchImpl(url, { signal: controller.signal });
    } catch {
      throw new ResultDownloadError(0);
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new ResultDownloadError(response.status);
    }

    const declared = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
    const contentType = declared === "image/png" ? "image/png" : declared === "image/jpeg" || declared === "image/jpg" ? "image/jpeg" : null;
    if (!contentType) {
      throw new ResultDownloadError(422);
    }
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType,
    };
  }
}

export interface TryOnOrchestratorOptions {
  repository: MarketplaceRepository;
  client: ClothesV3Client;
  objectStore: ObjectStore;
  resultDownloader: ResultDownloader;
  random?: () => number;
}

function asImageContentType(value: string): ImageContentType {
  if (value === "image/jpeg" || value === "image/png") {
    return value;
  }
  throw new YouCamError("invalid_upstream_response");
}

function extensionFor(contentType: ImageContentType): "jpg" | "png" {
  return contentType === "image/jpeg" ? "jpg" : "png";
}

export class TryOnOrchestrator {
  private readonly repository: MarketplaceRepository;
  private readonly client: ClothesV3Client;
  private readonly objectStore: ObjectStore;
  private readonly resultDownloader: ResultDownloader;
  private readonly random: () => number;

  constructor(options: TryOnOrchestratorOptions) {
    this.repository = options.repository;
    this.client = options.client;
    this.objectStore = options.objectStore;
    this.resultDownloader = options.resultDownloader;
    this.random = options.random ?? Math.random;
  }

  async advanceBrief(briefId: string, now: Date): Promise<void> {
    const jobs = await this.repository.claimDueJobs(briefId, now, 3);
    await Promise.all(jobs.map((job) => this.advanceJob(job, now)));
  }

  private expected(job: ClaimedTryOnJob) {
    return {
      jobId: job.id,
      expectedStatus: job.status,
      expectedAttemptCount: job.attemptCount,
    } as const;
  }

  private async scheduleOrFail(
    job: ClaimedTryOnJob,
    now: Date,
    terminalCode: NormalizedYouCamError,
  ): Promise<void> {
    const scheduledAt = nextPollAt({
      attempt: job.attemptCount,
      startedAtMs: job.createdAt.getTime(),
      nowMs: now.getTime(),
      random: this.random,
    });
    if (scheduledAt === null) {
      await this.repository.failJob({
        ...this.expected(job),
        code: terminalCode,
        now,
      });
      return;
    }

    await this.repository.schedulePoll({
      ...this.expected(job),
      nextPollAt: new Date(scheduledAt),
    });
  }

  private async downloadWithOneRefresh(
    job: ClaimedTryOnJob,
    resultUrl: string,
  ): Promise<{ bytes: Uint8Array; contentType: ImageContentType }> {
    try {
      return await this.resultDownloader.download(resultUrl);
    } catch (error) {
      if (
        !(error instanceof ResultDownloadError) ||
        ![401, 403, 404].includes(error.status)
      ) {
        throw new YouCamError("transient_upstream");
      }
    }

    const refreshed = await this.client.getTask(job.externalTaskId!);
    if (refreshed.status === "processing") {
      throw new YouCamError("transient_upstream");
    }
    if (refreshed.status === "error") {
      throw new YouCamError(refreshed.code);
    }
    try {
      return await this.resultDownloader.download(refreshed.resultUrl);
    } catch {
      throw new YouCamError("transient_upstream");
    }
  }

  private async persistResult(
    job: ClaimedTryOnJob,
    result: { bytes: Uint8Array; contentType: ImageContentType },
    now: Date,
  ): Promise<void> {
    const key = createJobResultKey(job.id);
    await this.objectStore.putPrivate({ key, bytes: result.bytes, contentType: result.contentType });
    try {
      await this.repository.completeJob({
        ...this.expected(job),
        ownerUserId: job.shopperId,
        objectKey: key,
        contentType: result.contentType,
        byteSize: result.bytes.byteLength,
        now,
      });
    } catch (error) {
      await this.objectStore.delete(key);
      throw error;
    }
  }

  private async advanceJob(job: ClaimedTryOnJob, now: Date): Promise<void> {
    try {
      if (!job.sourceFileId) {
        const source = await this.objectStore.getPrivate(job.sourceObjectKey);
        const contentType = asImageContentType(source.contentType);
        const fileId = await this.client.upload(source.bytes, {
          fileName: `${job.id}-source.${extensionFor(contentType)}`,
          contentType,
        });
        await this.repository.recordSourceFile({ ...this.expected(job), fileId });
        return;
      }

      if (!job.referenceFileId) {
        const reference = await this.objectStore.getPrivate(job.referenceObjectKey);
        const contentType = asImageContentType(reference.contentType);
        const fileId = await this.client.upload(reference.bytes, {
          fileName: `${job.id}-reference.${extensionFor(contentType)}`,
          contentType,
        });
        await this.repository.recordReferenceFile({ ...this.expected(job), fileId });
        return;
      }

      if (!job.externalTaskId) {
        const externalTaskId = await this.client.createTask({
          sourceFileId: job.sourceFileId,
          referenceFileId: job.referenceFileId,
          garmentCategory: job.garmentCategory,
        });
        await this.repository.recordExternalTask({ ...this.expected(job), externalTaskId });
        return;
      }

      const task = await this.client.getTask(job.externalTaskId);
      if (task.status === "processing") {
        await this.scheduleOrFail(job, now, "engine_failed");
        return;
      }
      if (task.status === "error") {
        await this.repository.failJob({ ...this.expected(job), code: task.code, now });
        return;
      }

      const result = await this.downloadWithOneRefresh(job, task.resultUrl);
      await this.persistResult(job, result, now);
    } catch (error) {
      if (error instanceof YouCamError && !error.retryable) {
        await this.repository.failJob({ ...this.expected(job), code: error.code, now });
        return;
      }
      const code = error instanceof YouCamError ? error.code : "transient_upstream";
      await this.scheduleOrFail(job, now, code);
    }
  }
}
