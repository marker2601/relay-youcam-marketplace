import { describe, expect, it } from "vitest";

import { canReadMedia } from "@/app/api/media/[mediaId]/route";
import type { DemoSession } from "@/lib/auth/demo-session";

type MediaRecord = Parameters<typeof canReadMedia>[1];

const shopper: DemoSession = {
  userId: "shopper-a",
  role: "shopper",
  expiresAt: Date.now() + 60_000,
};
const provider: DemoSession = {
  userId: "provider-a",
  role: "provider",
  expiresAt: Date.now() + 60_000,
};

function media(overrides: Partial<MediaRecord>): MediaRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    ownerUserId: "provider-a",
    kind: "listing_garment",
    objectKey: "private/key.png",
    contentType: "image/png",
    byteSize: 100,
    briefId: null,
    listingId: "22222222-2222-4222-8222-222222222222",
    jobId: null,
    deletionStatus: "active",
    deletionErrorCode: null,
    createdAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe("media authorization", () => {
  it("lets a provider read only media they own", () => {
    expect(canReadMedia(provider, media({ ownerUserId: provider.userId }))).toBe(true);
    expect(canReadMedia(provider, media({ ownerUserId: "provider-b" }))).toBe(false);
  });

  it("never lets a provider read a shopper brief source", () => {
    expect(
      canReadMedia(
        provider,
        media({
          ownerUserId: provider.userId,
          kind: "brief_source",
          listingId: null,
          briefId: "33333333-3333-4333-8333-333333333333",
        }),
      ),
    ).toBe(false);
  });

  it("lets a shopper read their source and authenticated catalog garments", () => {
    expect(
      canReadMedia(
        shopper,
        media({
          ownerUserId: shopper.userId,
          kind: "brief_source",
          listingId: null,
          briefId: "33333333-3333-4333-8333-333333333333",
        }),
      ),
    ).toBe(true);
    expect(canReadMedia(shopper, media({ ownerUserId: provider.userId }))).toBe(true);
  });
});
