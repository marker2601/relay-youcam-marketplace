import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { listings, users } from "@/lib/db/schema";
import { seedRelay } from "../../scripts/seed";
import {
  closeTestDatabase,
  migrateTestDatabase,
  resetTestDatabase,
  testDb,
} from "../helpers/test-db";

beforeAll(migrateTestDatabase);
beforeEach(resetTestDatabase);
afterAll(closeTestDatabase);

describe("Relay demo seed", () => {
  it("is idempotent and creates the complete fictional market", async () => {
    const uploadAsset = async () => undefined;

    await seedRelay(testDb, { uploadAsset });
    await seedRelay(testDb, { uploadAsset });

    const seededUsers = await testDb.select().from(users);
    const seededListings = await testDb.select().from(listings);
    expect(seededUsers.filter((user) => user.demoRole === "shopper")).toHaveLength(1);
    expect(seededUsers.filter((user) => user.demoRole === "provider")).toHaveLength(3);
    expect(seededListings).toHaveLength(5);
  });

  it("provides at least three hard-filter matches for the canonical brief", async () => {
    await seedRelay(testDb, { uploadAsset: async () => undefined });

    const seededListings = await testDb.select().from(listings);
    const compatible = seededListings.filter((listing) => {
      const measurements = listing.measurements;
      return (
        listing.status === "active" &&
        listing.garmentCategory === "full_body" &&
        listing.rentalPriceCents <= 12_000 &&
        listing.serviceRadiusMiles >= 15 &&
        measurements.bustTenthsCm >= 920 &&
        measurements.bustTenthsCm <= 1_020 &&
        measurements.waistTenthsCm >= 740 &&
        measurements.waistTenthsCm <= 840 &&
        measurements.hipsTenthsCm >= 1_000 &&
        measurements.hipsTenthsCm <= 1_100
      );
    });

    expect(compatible).toHaveLength(3);
  });

  it("uploads only the three repository-owned garment source files", async () => {
    const sourcePaths: string[] = [];
    await seedRelay(testDb, {
      uploadAsset: async (input) => {
        sourcePaths.push(input.sourcePath);
      },
    });

    expect(new Set(sourcePaths)).toEqual(
      new Set([
        "public/demo/garments/emerald-midi.png",
        "public/demo/garments/midnight-jumpsuit.png",
        "public/demo/garments/burgundy-maxi.png",
      ]),
    );
  });
});
