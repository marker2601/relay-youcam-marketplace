import type { GarmentCategory } from "@/lib/domain/contracts";
import {
  YouCamError,
  normalizeEngineError,
  normalizeHttpError,
  type NormalizedYouCamError,
} from "@/lib/youcam/errors";
import {
  fileRegistrationResponseSchema,
  taskCreatedResponseSchema,
  taskStatusResponseSchema,
} from "@/lib/youcam/schemas";

export interface ClothesV3Client {
  upload(
    bytes: Uint8Array,
    input: { fileName: string; contentType: "image/jpeg" | "image/png" },
  ): Promise<string>;
  createTask(input: {
    sourceFileId: string;
    referenceFileId: string;
    garmentCategory: GarmentCategory;
  }): Promise<string>;
  getTask(taskId: string): Promise<
    | { status: "processing" }
    | { status: "success"; resultUrl: string }
    | { status: "error"; code: NormalizedYouCamError }
  >;
}

export interface YouCamClothesV3ClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const officialOrigin = "https://yce-api-01.makeupar.com";

export class YouCamClothesV3Client implements ClothesV3Client {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: YouCamClothesV3ClientOptions) {
    const parsedBaseUrl = new URL(options.baseUrl ?? officialOrigin);
    if (parsedBaseUrl.origin !== officialOrigin) {
      throw new Error("Bearer credentials require the official YouCam API origin");
    }
    if (options.apiKey.length < 20) {
      throw new Error("A valid YouCam API key is required");
    }

    this.apiKey = options.apiKey;
    this.baseUrl = parsedBaseUrl.origin;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch {
      throw new YouCamError("transient_upstream");
    } finally {
      clearTimeout(timeout);
    }
  }

  private async apiRequest(path: string, init: RequestInit): Promise<Response> {
    return this.request(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  }

  private async parseJson(response: Response): Promise<unknown> {
    if (!response.ok) {
      throw new YouCamError(normalizeHttpError(response.status));
    }

    try {
      return await response.json();
    } catch {
      throw new YouCamError("invalid_upstream_response");
    }
  }

  async upload(
    bytes: Uint8Array,
    input: { fileName: string; contentType: "image/jpeg" | "image/png" },
  ): Promise<string> {
    const youCamContentType = input.contentType === "image/jpeg" ? "image/jpg" : "image/png";
    const registrationResponse = await this.apiRequest("/s2s/v2.0/file/cloth-v3", {
      method: "POST",
      body: JSON.stringify({
        files: [
          {
            content_type: youCamContentType,
            file_name: input.fileName,
            file_size: bytes.byteLength,
          },
        ],
      }),
    });
    const registration = fileRegistrationResponseSchema.safeParse(
      await this.parseJson(registrationResponse),
    );
    if (!registration.success) {
      throw new YouCamError("invalid_upstream_response");
    }

    const file = registration.data.data.files[0]!;
    const uploadRequest = file.requests[0]!;
    const uploadResponse = await this.request(uploadRequest.url, {
      method: "PUT",
      headers: uploadRequest.headers,
      body: Uint8Array.from(bytes).buffer,
    });
    if (!uploadResponse.ok) {
      throw new YouCamError(normalizeHttpError(uploadResponse.status));
    }

    return file.file_id;
  }

  async createTask(input: {
    sourceFileId: string;
    referenceFileId: string;
    garmentCategory: GarmentCategory;
  }): Promise<string> {
    const response = await this.apiRequest("/s2s/v2.0/task/cloth-v3", {
      method: "POST",
      body: JSON.stringify({
        src_file_id: input.sourceFileId,
        ref_file_id: input.referenceFileId,
        garment_category: input.garmentCategory,
      }),
    });
    const parsed = taskCreatedResponseSchema.safeParse(await this.parseJson(response));
    if (!parsed.success) {
      throw new YouCamError("invalid_upstream_response");
    }

    return parsed.data.data.task_id;
  }

  async getTask(taskId: string): ReturnType<ClothesV3Client["getTask"]> {
    const response = await this.apiRequest(
      `/s2s/v2.0/task/cloth-v3/${encodeURIComponent(taskId)}`,
      { method: "GET" },
    );
    const parsed = taskStatusResponseSchema.safeParse(await this.parseJson(response));
    if (!parsed.success) {
      throw new YouCamError("invalid_upstream_response");
    }

    const data = parsed.data.data;
    if (data.task_status === "success") {
      return { status: "success", resultUrl: data.results.url };
    }
    if (data.task_status === "error") {
      return { status: "error", code: normalizeEngineError(data.error) };
    }
    return { status: "processing" };
  }
}
