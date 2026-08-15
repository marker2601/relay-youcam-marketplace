import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 120_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: process.platform === "win32" ? "npm.cmd run dev" : "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ?? "postgresql://relay:relay_local@localhost:54329/relay",
      SESSION_SECRET:
        process.env.SESSION_SECRET ?? "relay-playwright-session-secret-32-characters",
      S3_ENDPOINT: process.env.S3_ENDPOINT ?? "http://localhost:59000",
      S3_REGION: process.env.S3_REGION ?? "us-east-1",
      S3_BUCKET: process.env.S3_BUCKET ?? "relay-media",
      S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? "relay_local",
      S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? "relay_local_secret",
      S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE ?? "true",
      APP_TIME_ZONE: "America/Chicago",
      DEMO_MODE: "true",
      YOUCAM_MODE: "fake",
      YOUCAM_BASE_URL: "https://yce-api-01.makeupar.com",
    },
  },
});
