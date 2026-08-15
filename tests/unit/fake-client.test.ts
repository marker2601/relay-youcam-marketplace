import { describe, expect, it } from "vitest";

import { FakeClothesV3Client } from "@/lib/youcam/fake-client";

describe("FakeClothesV3Client", () => {
  it("returns the uploaded reference bytes as a deterministic local success result", async () => {
    const client = new FakeClothesV3Client();
    const sourceId = await client.upload(new Uint8Array([1, 2, 3]), {
      fileName: "source.png",
      contentType: "image/png",
    });
    const referenceBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 7, 8, 9]);
    const referenceId = await client.upload(referenceBytes, {
      fileName: "garment.png",
      contentType: "image/png",
    });
    const taskId = await client.createTask({
      sourceFileId: sourceId,
      referenceFileId: referenceId,
      garmentCategory: "full_body",
    });

    const task = await client.getTask(taskId);
    expect(task.status).toBe("success");
    if (task.status !== "success") throw new Error("expected fake success");
    const response = await fetch(task.resultUrl);
    expect(response.headers.get("content-type")).toContain("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(referenceBytes);
  });
});
