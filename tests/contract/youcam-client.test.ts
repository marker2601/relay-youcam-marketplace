import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  YouCamError,
  isRetryableYouCamError,
  normalizeEngineError,
} from "@/lib/youcam/errors";
import { YouCamClothesV3Client } from "@/lib/youcam/client";
import fileReady from "../fixtures/youcam/file-ready.json";
import rateLimited from "../fixtures/youcam/rate-limited.json";
import taskCreated from "../fixtures/youcam/task-created.json";
import taskEngineError from "../fixtures/youcam/task-engine-error.json";
import taskRunning from "../fixtures/youcam/task-running.json";
import taskSuccess from "../fixtures/youcam/task-success.json";

const apiOrigin = "https://yce-api-01.makeupar.com";
const apiKey = "youcam-secret-key-should-never-leak";
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function client(fetchImpl: typeof fetch = fetch) {
  return new YouCamClothesV3Client({ apiKey, fetchImpl });
}

describe("YouCam Clothes v3 upload", () => {
  it("registers JPEG metadata, then sends exact bytes and returned headers without bearer auth", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const signals: AbortSignal[] = [];
    const observedFetch: typeof fetch = async (input, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      signals.push(init!.signal as AbortSignal);
      return fetch(input, init);
    };

    server.use(
      http.post(`${apiOrigin}/s2s/v2.0/file/cloth-v3`, async ({ request }) => {
        expect(request.headers.get("authorization")).toBe(`Bearer ${apiKey}`);
        await expect(request.json()).resolves.toEqual({
          files: [
            {
              content_type: "image/jpg",
              file_name: "source.jpg",
              file_size: 4,
            },
          ],
        });
        return HttpResponse.json(fileReady);
      }),
      http.put("https://upload.example.test/relay-source", async ({ request }) => {
        expect(request.headers.get("authorization")).toBeNull();
        expect(request.headers.get("content-length")).toBe("4");
        expect(request.headers.get("content-type")).toBe("image/jpg");
        expect(new Uint8Array(await request.arrayBuffer())).toEqual(bytes);
        return new HttpResponse(null, { status: 200 });
      }),
    );

    await expect(
      client(observedFetch).upload(bytes, {
        fileName: "source.jpg",
        contentType: "image/jpeg",
      }),
    ).resolves.toBe("file-source-123");
    expect(signals).toHaveLength(2);
  });

  it("does not leak API keys, signed query strings, or source bytes in upload errors", async () => {
    const privateText = "PRIVATE_SOURCE_BYTES";
    const bytes = new TextEncoder().encode(privateText);
    const errorFixture = structuredClone(fileReady);
    errorFixture.data.files[0]!.requests[0]!.headers["Content-Length"] = String(bytes.byteLength);

    server.use(
      http.post(`${apiOrigin}/s2s/v2.0/file/cloth-v3`, () => HttpResponse.json(errorFixture)),
      http.put("https://upload.example.test/relay-source", () =>
        HttpResponse.json({ internal: "do not expose" }, { status: 500 }),
      ),
    );

    let captured: unknown;
    try {
      await client().upload(bytes, { fileName: "source.jpg", contentType: "image/jpeg" });
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(YouCamError);
    const rendered = String(captured);
    expect(rendered).not.toContain(apiKey.slice(0, 12));
    expect(rendered).not.toContain("X-Amz-Signature");
    expect(rendered).not.toContain(privateText);
  });
});

describe("YouCam Clothes v3 tasks", () => {
  it("creates a task with returned file IDs and the garment category", async () => {
    server.use(
      http.post(`${apiOrigin}/s2s/v2.0/task/cloth-v3`, async ({ request }) => {
        expect(request.headers.get("authorization")).toBe(`Bearer ${apiKey}`);
        await expect(request.json()).resolves.toEqual({
          src_file_id: "source-file-id",
          ref_file_id: "reference-file-id",
          garment_category: "full_body",
        });
        return HttpResponse.json(taskCreated);
      }),
    );

    await expect(
      client().createTask({
        sourceFileId: "source-file-id",
        referenceFileId: "reference-file-id",
        garmentCategory: "full_body",
      }),
    ).resolves.toBe("task-123");
  });

  it.each([
    [taskRunning, { status: "processing" }],
    [
      taskSuccess,
      {
        status: "success",
        resultUrl: "https://results.example.test/relay-result.jpg?token=redacted",
      },
    ],
    [taskEngineError, { status: "error", code: "invalid_reference" }],
  ] as const)("normalizes a documented task response", async (fixture, expected) => {
    server.use(
      http.get(`${apiOrigin}/s2s/v2.0/task/cloth-v3/:taskId`, () => HttpResponse.json(fixture)),
    );

    await expect(client().getTask("task-123")).resolves.toEqual(expected);
  });

  it("rejects malformed successful responses instead of casting them", async () => {
    server.use(
      http.get(`${apiOrigin}/s2s/v2.0/task/cloth-v3/:taskId`, () =>
        HttpResponse.json({ status: 200, data: { task_status: "success", results: {} } }),
      ),
    );

    await expect(client().getTask("task-123")).rejects.toMatchObject({
      code: "invalid_upstream_response",
      retryable: false,
    });
  });

  it("normalizes HTTP 429 as retryable without exposing the upstream body", async () => {
    server.use(
      http.post(`${apiOrigin}/s2s/v2.0/task/cloth-v3`, () =>
        HttpResponse.json(rateLimited, { status: 429 }),
      ),
    );

    await expect(
      client().createTask({
        sourceFileId: "source-file-id",
        referenceFileId: "reference-file-id",
        garmentCategory: "full_body",
      }),
    ).rejects.toMatchObject({ code: "rate_limited", retryable: true });
  });
});

describe("client boundary", () => {
  it("refuses to place bearer credentials on a non-official API origin", () => {
    expect(
      () =>
        new YouCamClothesV3Client({
          apiKey,
          baseUrl: "https://attacker.example.test",
        }),
    ).toThrow("official YouCam API origin");
  });

  it("aborts an upstream request after exactly fifteen seconds", async () => {
    vi.useFakeTimers();
    try {
      const stalledFetch: typeof fetch = async (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
      const request = client(stalledFetch).getTask("task-123");
      const rejection = expect(request).rejects.toMatchObject({
        code: "transient_upstream",
        retryable: true,
      });

      await vi.advanceTimersByTimeAsync(14_999);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);

      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("documented engine error normalization", () => {
  it.each([
    ["error_pose", "invalid_source"],
    ["error_invalid_src", "invalid_source"],
    ["error_below_min_image_size", "invalid_source"],
    ["error_invalid_ref", "invalid_reference"],
    ["error_apply_region_mismatch", "invalid_reference"],
    ["error_nsfw_content_detected", "unsafe_content"],
    ["error_download_image", "download_failed"],
    ["invalid_parameter", "engine_failed"],
    ["exceed_max_filesize", "engine_failed"],
    ["error_editing_failed", "engine_failed"],
    ["unknown_internal_error", "engine_failed"],
    ["future_unknown_code", "engine_failed"],
  ] as const)("maps %s to %s", (upstream, normalized) => {
    expect(normalizeEngineError(upstream)).toBe(normalized);
  });

  it("marks only rate limiting and transient upstream failures retryable", () => {
    expect(isRetryableYouCamError("rate_limited")).toBe(true);
    expect(isRetryableYouCamError("transient_upstream")).toBe(true);
    expect(isRetryableYouCamError("engine_failed")).toBe(false);
    expect(isRetryableYouCamError("invalid_upstream_response")).toBe(false);
  });
});
