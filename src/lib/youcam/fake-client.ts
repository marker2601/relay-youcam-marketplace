import { createHash } from "node:crypto";

import type { ClothesV3Client } from "@/lib/youcam/client";

/** Explicitly local/test-only adapter. Real recorded demos use the live client. */
export class FakeClothesV3Client implements ClothesV3Client {
  async upload(bytes: Uint8Array): Promise<string> {
    return `fake-file-${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}`;
  }

  async createTask(input: {
    sourceFileId: string;
    referenceFileId: string;
    garmentCategory: "upper_body" | "lower_body" | "full_body";
  }): Promise<string> {
    return `fake-task-${createHash("sha256")
      .update(`${input.sourceFileId}:${input.referenceFileId}:${input.garmentCategory}`)
      .digest("hex")
      .slice(0, 16)}`;
  }

  async getTask(): ReturnType<ClothesV3Client["getTask"]> {
    return { status: "error", code: "engine_failed" };
  }
}
