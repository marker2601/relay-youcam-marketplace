import "dotenv/config";

import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { sql } from "drizzle-orm";

import { createDatabaseConnection, type Database } from "@/lib/db/client";
import { listings, mediaObjects, users } from "@/lib/db/schema";
import type { GarmentMeasurements, TenthsCm } from "@/lib/domain/contracts";

const cm = (value: number) => value as TenthsCm;

export const seedIds = {
  shopper: "30000000-0000-4000-8000-000000000001",
  peerJordan: "30000000-0000-4000-8000-000000000002",
  peerPriya: "30000000-0000-4000-8000-000000000003",
  boutique: "30000000-0000-4000-8000-000000000004",
  emeraldMedia: "30000000-0000-4000-8000-000000000010",
  navyMedia: "30000000-0000-4000-8000-000000000011",
  burgundyMedia: "30000000-0000-4000-8000-000000000012",
  premiumMedia: "30000000-0000-4000-8000-000000000013",
  petiteMedia: "30000000-0000-4000-8000-000000000014",
  emeraldListing: "30000000-0000-4000-8000-000000000020",
  navyListing: "30000000-0000-4000-8000-000000000021",
  burgundyListing: "30000000-0000-4000-8000-000000000022",
  premiumListing: "30000000-0000-4000-8000-000000000023",
  petiteListing: "30000000-0000-4000-8000-000000000024",
} as const;

export interface SeedAssetUpload {
  sourcePath: string;
  objectKey: string;
  contentType: "image/png";
}

export interface SeedOptions {
  uploadAsset: (input: SeedAssetUpload) => Promise<void>;
}

const usersSeed = [
  { id: seedIds.shopper, demoRole: "shopper" as const, displayName: "Maya Chen", providerType: null },
  {
    id: seedIds.peerJordan,
    demoRole: "provider" as const,
    displayName: "Jordan Lee",
    providerType: "peer" as const,
  },
  {
    id: seedIds.peerPriya,
    demoRole: "provider" as const,
    displayName: "Priya Shah",
    providerType: "peer" as const,
  },
  {
    id: seedIds.boutique,
    demoRole: "provider" as const,
    displayName: "West Loop Wardrobe",
    providerType: "boutique" as const,
  },
];

const assetSeeds = [
  {
    mediaId: seedIds.emeraldMedia,
    listingId: seedIds.emeraldListing,
    providerId: seedIds.boutique,
    sourcePath: "public/demo/garments/emerald-midi.png",
    objectKey: "demo/garments/emerald-midi.png",
  },
  {
    mediaId: seedIds.navyMedia,
    listingId: seedIds.navyListing,
    providerId: seedIds.peerJordan,
    sourcePath: "public/demo/garments/midnight-jumpsuit.png",
    objectKey: "demo/garments/midnight-jumpsuit.png",
  },
  {
    mediaId: seedIds.burgundyMedia,
    listingId: seedIds.burgundyListing,
    providerId: seedIds.peerPriya,
    sourcePath: "public/demo/garments/burgundy-maxi.png",
    objectKey: "demo/garments/burgundy-maxi.png",
  },
  {
    mediaId: seedIds.premiumMedia,
    listingId: seedIds.premiumListing,
    providerId: seedIds.boutique,
    sourcePath: "public/demo/garments/burgundy-maxi.png",
    objectKey: "demo/garments/burgundy-maxi-premium.png",
  },
  {
    mediaId: seedIds.petiteMedia,
    listingId: seedIds.petiteListing,
    providerId: seedIds.peerJordan,
    sourcePath: "public/demo/garments/emerald-midi.png",
    objectKey: "demo/garments/emerald-midi-petite.png",
  },
] as const;

const compatibleMeasurements: GarmentMeasurements = {
  bustTenthsCm: cm(960),
  waistTenthsCm: cm(780),
  hipsTenthsCm: cm(1_040),
  lengthTenthsCm: cm(1_180),
};

const listingSeeds = [
  {
    id: seedIds.emeraldListing,
    providerId: seedIds.boutique,
    title: "Emerald Satin Midi",
    garmentCategory: "full_body" as const,
    sizeLabel: "M",
    measurements: compatibleMeasurements,
    condition: "excellent" as const,
    colorTags: ["emerald"],
    styleTags: ["formal", "minimal", "wedding_guest"],
    rentalPriceCents: 7_800,
    depositDisplayCents: 4_000,
    serviceRadiusMiles: 20,
    locationBand: "west" as const,
    garmentMediaId: seedIds.emeraldMedia,
    unavailableRanges: [],
    reliabilityBasisPoints: 9_300,
    status: "active" as const,
  },
  {
    id: seedIds.navyListing,
    providerId: seedIds.peerJordan,
    title: "Midnight Tailored Jumpsuit",
    garmentCategory: "full_body" as const,
    sizeLabel: "M",
    measurements: {
      bustTenthsCm: cm(970),
      waistTenthsCm: cm(790),
      hipsTenthsCm: cm(1_050),
      lengthTenthsCm: cm(1_420),
    },
    condition: "excellent" as const,
    colorTags: ["navy"],
    styleTags: ["formal", "polished", "wedding_guest"],
    rentalPriceCents: 6_500,
    depositDisplayCents: 3_000,
    serviceRadiusMiles: 18,
    locationBand: "west" as const,
    garmentMediaId: seedIds.navyMedia,
    unavailableRanges: [],
    reliabilityBasisPoints: 8_700,
    status: "active" as const,
  },
  {
    id: seedIds.burgundyListing,
    providerId: seedIds.peerPriya,
    title: "Burgundy One-Shoulder Maxi",
    garmentCategory: "full_body" as const,
    sizeLabel: "M",
    measurements: {
      bustTenthsCm: cm(980),
      waistTenthsCm: cm(800),
      hipsTenthsCm: cm(1_060),
      lengthTenthsCm: cm(1_500),
    },
    condition: "good" as const,
    colorTags: ["burgundy"],
    styleTags: ["formal", "statement", "gala"],
    rentalPriceCents: 9_200,
    depositDisplayCents: 4_500,
    serviceRadiusMiles: 16,
    locationBand: "loop" as const,
    garmentMediaId: seedIds.burgundyMedia,
    unavailableRanges: [],
    reliabilityBasisPoints: 8_900,
    status: "active" as const,
  },
  {
    id: seedIds.premiumListing,
    providerId: seedIds.boutique,
    title: "Burgundy Gala Reserve",
    garmentCategory: "full_body" as const,
    sizeLabel: "M",
    measurements: compatibleMeasurements,
    condition: "excellent" as const,
    colorTags: ["burgundy"],
    styleTags: ["formal", "statement", "gala"],
    rentalPriceCents: 15_000,
    depositDisplayCents: 7_500,
    serviceRadiusMiles: 20,
    locationBand: "north" as const,
    garmentMediaId: seedIds.premiumMedia,
    unavailableRanges: [],
    reliabilityBasisPoints: 9_500,
    status: "active" as const,
  },
  {
    id: seedIds.petiteListing,
    providerId: seedIds.peerJordan,
    title: "Emerald Petite Midi",
    garmentCategory: "full_body" as const,
    sizeLabel: "S",
    measurements: {
      bustTenthsCm: cm(880),
      waistTenthsCm: cm(700),
      hipsTenthsCm: cm(950),
      lengthTenthsCm: cm(1_100),
    },
    condition: "good" as const,
    colorTags: ["emerald"],
    styleTags: ["semi_formal", "minimal", "wedding_guest"],
    rentalPriceCents: 5_500,
    depositDisplayCents: 2_500,
    serviceRadiusMiles: 20,
    locationBand: "west" as const,
    garmentMediaId: seedIds.petiteMedia,
    unavailableRanges: [],
    reliabilityBasisPoints: 8_200,
    status: "active" as const,
  },
];

export async function seedRelay(db: Database, options: SeedOptions): Promise<void> {
  const assetByteSizes = new Map<string, number>();
  for (const asset of assetSeeds) {
    await options.uploadAsset({
      sourcePath: asset.sourcePath,
      objectKey: asset.objectKey,
      contentType: "image/png",
    });
    assetByteSizes.set(asset.mediaId, (await stat(asset.sourcePath)).size);
  }

  await db.transaction(async (transaction) => {
    for (const user of usersSeed) {
      await transaction
        .insert(users)
        .values(user)
        .onConflictDoUpdate({
          target: users.id,
          set: {
            demoRole: sql`excluded.demo_role`,
            displayName: sql`excluded.display_name`,
            providerType: sql`excluded.provider_type`,
          },
        });
    }

    for (const asset of assetSeeds) {
      await transaction
        .insert(mediaObjects)
        .values({
          id: asset.mediaId,
          ownerUserId: asset.providerId,
          kind: "listing_garment",
          objectKey: asset.objectKey,
          contentType: "image/png",
          byteSize: assetByteSizes.get(asset.mediaId) ?? 1,
          listingId: asset.listingId,
        })
        .onConflictDoUpdate({
          target: mediaObjects.id,
          set: {
            ownerUserId: sql`excluded.owner_user_id`,
            objectKey: sql`excluded.object_key`,
            byteSize: sql`excluded.byte_size`,
            listingId: sql`excluded.listing_id`,
            deletionStatus: "active",
            deletionErrorCode: null,
            deletedAt: null,
          },
        });
    }

    for (const listing of listingSeeds) {
      await transaction
        .insert(listings)
        .values(listing)
        .onConflictDoUpdate({
          target: listings.id,
          set: {
            providerId: sql`excluded.provider_id`,
            title: sql`excluded.title`,
            garmentCategory: sql`excluded.garment_category`,
            sizeLabel: sql`excluded.size_label`,
            measurements: sql`excluded.measurements`,
            condition: sql`excluded.condition`,
            colorTags: sql`excluded.color_tags`,
            styleTags: sql`excluded.style_tags`,
            rentalPriceCents: sql`excluded.rental_price_cents`,
            depositDisplayCents: sql`excluded.deposit_display_cents`,
            serviceRadiusMiles: sql`excluded.service_radius_miles`,
            locationBand: sql`excluded.location_band`,
            garmentMediaId: sql`excluded.garment_media_id`,
            unavailableRanges: sql`excluded.unavailable_ranges`,
            reliabilityBasisPoints: sql`excluded.reliability_basis_points`,
            status: "active",
          },
        });
    }
  });
}

async function uploadAssetToS3(input: SeedAssetUpload): Promise<void> {
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? "http://localhost:59000",
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "relay_local",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "relay_local_secret",
    },
  });
  await client.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET ?? "relay-media",
      Key: input.objectKey,
      Body: await readFile(input.sourcePath),
      ContentType: input.contentType,
    }),
  );
}

async function main(): Promise<void> {
  const connection = createDatabaseConnection(
    process.env.DATABASE_URL ?? "postgresql://relay:relay_local@localhost:54329/relay",
    { max: 1 },
  );
  try {
    await seedRelay(connection.db, { uploadAsset: uploadAssetToS3 });
  } finally {
    await connection.sql.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown seed failure";
    console.error(`Relay seed failed: ${message}`);
    process.exitCode = 1;
  });
}
