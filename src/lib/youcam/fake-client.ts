import { createHash } from "node:crypto";

import type { ClothesV3Client } from "@/lib/youcam/client";

/** Explicitly local/test-only adapter. Real recorded demos use the live client. */
export class FakeClothesV3Client implements ClothesV3Client {
  private readonly files = new Map<string, { bytes: Uint8Array; contentType: "image/jpeg" | "image/png" }>();
  private readonly tasks = new Map<string, string>();

  async upload(
    bytes: Uint8Array,
    input: { fileName: string; contentType: "image/jpeg" | "image/png" },
  ): Promise<string> {
    const id = `fake-file-${createHash("sha256").update(bytes).update(input.contentType).digest("hex").slice(0, 16)}`;
    this.files.set(id, { bytes: new Uint8Array(bytes), contentType: input.contentType });
    return id;
  }

  async createTask(input: {
    sourceFileId: string;
    referenceFileId: string;
    garmentCategory: "upper_body" | "lower_body" | "full_body";
  }): Promise<string> {
    const taskId = `fake-task-${createHash("sha256")
      .update(`${input.sourceFileId}:${input.referenceFileId}:${input.garmentCategory}`)
      .digest("hex")
      .slice(0, 16)}`;
    this.tasks.set(taskId, input.referenceFileId);
    return taskId;
  }

  async getTask(taskId: string): ReturnType<ClothesV3Client["getTask"]> {
    const referenceId = this.tasks.get(taskId);
    const reference = referenceId ? this.files.get(referenceId) : undefined;
    if (!reference) return { status: "error", code: "engine_failed" };
    return {
      status: "success",
      resultUrl: `data:${reference.contentType};base64,${Buffer.from(reference.bytes).toString("base64")}`,
    };
  }
}
