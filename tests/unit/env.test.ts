import { describe, expect, it } from "vitest";

import { getServerEnv } from "@/lib/config/env";

const validBase = {
  DATABASE_URL: "postgresql://relay:relay_local@localhost:54329/relay",
  SESSION_SECRET: "replace-with-at-least-32-characters",
  S3_ENDPOINT: "http://localhost:9000",
  S3_REGION: "us-east-1",
  S3_BUCKET: "relay-media",
  S3_ACCESS_KEY_ID: "relay_local",
  S3_SECRET_ACCESS_KEY: "relay_local_secret",
  S3_FORCE_PATH_STYLE: "true",
  APP_TIME_ZONE: "America/Chicago",
  DEMO_MODE: "true",
  YOUCAM_BASE_URL: "https://yce-api-01.makeupar.com",
} satisfies Record<string, string | undefined>;

describe("getServerEnv", () => {
  it.each([
    "DATABASE_URL",
    "SESSION_SECRET",
    "S3_ENDPOINT",
    "S3_REGION",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
  ] as const)("reports a missing %s setting", (field) => {
    const source = { ...validBase, YOUCAM_MODE: "fake" };
    delete source[field];

    expect(() => getServerEnv(source)).toThrowError(field);
  });

  it("requires an API key in live YouCam mode", () => {
    expect(() => getServerEnv({ ...validBase, YOUCAM_MODE: "live" })).toThrowError(
      "YOUCAM_API_KEY",
    );
  });

  it("does not require an API key in fake YouCam mode", () => {
    expect(getServerEnv({ ...validBase, YOUCAM_MODE: "fake" }).YOUCAM_MODE).toBe("fake");
  });
});
