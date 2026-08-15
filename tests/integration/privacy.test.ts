import { randomUUID } from "node:crypto";

import { S3Client } from "@aws-sdk/client-s3";
import { afterAll, describe, expect, it } from "vitest";

import {
  S3ObjectStore,
  createBriefSourceKey,
  createJobResultKey,
  createListingGarmentKey,
} from "@/lib/storage/s3-object-store";

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

afterAll(() => client.destroy());

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
