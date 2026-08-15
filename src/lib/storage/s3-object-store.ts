import { randomUUID } from "node:crypto";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { ObjectStore } from "@/lib/storage/object-store";

export interface S3ObjectStoreOptions {
  client: S3Client;
  bucket: string;
}

type ImageExtension = "jpg" | "png";
type IdFactory = () => string;

function assertSafeKey(key: string): void {
  if (
    key.length === 0 ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error("Object key must be an opaque relative path");
  }
}

function assertPathSegment(value: string): void {
  if (!/^[a-zA-Z0-9-]+$/.test(value)) {
    throw new Error("Storage path segment is invalid");
  }
}

export function createBriefSourceKey(
  briefId: string,
  extension: ImageExtension,
  idFactory: IdFactory = randomUUID,
): string {
  assertPathSegment(briefId);
  const objectId = idFactory();
  assertPathSegment(objectId);
  return `briefs/${briefId}/source/${objectId}.${extension}`;
}

export function createListingGarmentKey(
  listingId: string,
  extension: ImageExtension,
  idFactory: IdFactory = randomUUID,
): string {
  assertPathSegment(listingId);
  const objectId = idFactory();
  assertPathSegment(objectId);
  return `listings/${listingId}/garment/${objectId}.${extension}`;
}

export function createJobResultKey(
  jobId: string,
  idFactory: IdFactory = randomUUID,
): string {
  assertPathSegment(jobId);
  const objectId = idFactory();
  assertPathSegment(objectId);
  return `jobs/${jobId}/result/${objectId}.jpg`;
}

export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(options: S3ObjectStoreOptions) {
    if (options.bucket.trim().length === 0) {
      throw new Error("S3 bucket is required");
    }
    this.client = options.client;
    this.bucket = options.bucket;
  }

  async putPrivate(input: Parameters<ObjectStore["putPrivate"]>[0]): Promise<void> {
    assertSafeKey(input.key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.bytes,
        ContentLength: input.bytes.byteLength,
        ContentType: input.contentType,
        CacheControl: "private, no-store",
      }),
    );
  }

  async getPrivate(key: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    assertSafeKey(key);
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
    if (!result.Body) {
      throw new Error("Private object body was unavailable");
    }

    return {
      bytes: await result.Body.transformToByteArray(),
      contentType: result.ContentType ?? "application/octet-stream",
    };
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  async createReadUrl(key: string, expiresInSeconds: number): Promise<string> {
    assertSafeKey(key);
    if (
      !Number.isInteger(expiresInSeconds) ||
      expiresInSeconds < 1 ||
      expiresInSeconds > 300
    ) {
      throw new RangeError("Signed read expiry must be between 1 and 300 seconds");
    }

    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
      { expiresIn: expiresInSeconds },
    );
  }
}
