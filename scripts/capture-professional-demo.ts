import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium, expect, type Locator, type Page } from "@playwright/test";

import { seedIds } from "./seed";
import { resetApplicationState } from "../tests/e2e/helpers/app-state";
import { fillBrief, waitForReadyOffers } from "../tests/e2e/helpers/journey";

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? "https://relay-youcam-marketplace.vercel.app";
const assetRoot = path.resolve("docs/submission/assets");
const rawRoot = path.join(assetRoot, "professional-raw");
const rawVideo = path.join(rawRoot, "relay-production-journey.webm");
const manifestPath = path.join(rawRoot, "relay-production-journey.json");

type Scene = { name: string; start: number; end: number };

await mkdir(rawRoot, { recursive: true });
await resetApplicationState();

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  baseURL,
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: "light",
  recordVideo: { dir: rawRoot, size: { width: 1600, height: 900 } },
});
const page = await context.newPage();
const video = page.video();
const zero = Date.now();
const scenes: Scene[] = [];

const seconds = () => (Date.now() - zero) / 1000;
const hold = (milliseconds: number) => page.waitForTimeout(milliseconds);

async function ensureCursor(targetPage: Page): Promise<void> {
  await targetPage.evaluate(() => {
    if (document.querySelector("[data-relay-demo-cursor]")) return;
    const cursor = document.createElement("div");
    cursor.dataset.relayDemoCursor = "true";
    Object.assign(cursor.style, {
      position: "fixed",
      zIndex: "2147483647",
      width: "24px",
      height: "24px",
      borderRadius: "999px",
      background: "rgba(20, 111, 81, 0.92)",
      border: "3px solid white",
      boxShadow: "0 2px 12px rgba(0,0,0,.28)",
      pointerEvents: "none",
      left: "34px",
      top: "34px",
      transition:
        "left 420ms cubic-bezier(.2,.8,.2,1), top 420ms cubic-bezier(.2,.8,.2,1), transform 160ms ease",
    });
    document.body.append(cursor);
  });
}

async function moveTo(locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await ensureCursor(page);
  const box = await locator.boundingBox();
  if (!box) throw new Error("Could not locate demo target");
  await page.evaluate(
    ({ x, y }) => {
      const cursor = document.querySelector<HTMLElement>("[data-relay-demo-cursor]");
      if (!cursor) return;
      cursor.style.left = `${x - 12}px`;
      cursor.style.top = `${y - 12}px`;
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  await hold(650);
}

async function click(locator: Locator): Promise<void> {
  await moveTo(locator);
  await page.evaluate(() => {
    const cursor = document.querySelector<HTMLElement>("[data-relay-demo-cursor]");
    if (cursor) cursor.style.transform = "scale(.62)";
  });
  await locator.click();
  await hold(180);
  await page.evaluate(() => {
    const cursor = document.querySelector<HTMLElement>("[data-relay-demo-cursor]");
    if (cursor) cursor.style.transform = "scale(1)";
  });
}

async function record(name: string, action: () => Promise<void>): Promise<void> {
  const start = seconds();
  await action();
  scenes.push({ name, start, end: seconds() });
}

async function become(userId: string, destination: string): Promise<void> {
  const response = await page.request.post("/api/demo/session", {
    data: { userId },
    maxRedirects: 0,
  });
  if (response.status() !== 303) {
    throw new Error(`Demo session failed: ${response.status()}`);
  }
  await page.goto(destination, { waitUntil: "networkidle" });
  await ensureCursor(page);
}

try {
  await record("hero", async () => {
    await page.goto("/", { waitUntil: "networkidle" });
    await ensureCursor(page);
    await hold(2500);
    await moveTo(page.getByRole("link", { name: "Shop as a guest" }));
    await hold(1200);
  });

  await record("brief", async () => {
    await click(page.getByRole("link", { name: "Shop as a guest" }));
    await expect(page).toHaveURL(/\/request\/new$/);
    await fillBrief(page);
    await page.getByLabel("Event date").scrollIntoViewIfNeeded();
    await hold(1800);
    await page.getByLabel("Full-body photo").scrollIntoViewIfNeeded();
    await hold(1600);
    await moveTo(page.getByRole("button", { name: "Find my matches" }));
    await hold(1000);
    await click(page.getByRole("button", { name: "Find my matches" }));
    await expect(page).toHaveURL(/\/briefs\/[0-9a-f-]+$/, { timeout: 30_000 });
  });

  await waitForReadyOffers(page);
  const primary = page.locator('article[data-assurance-role="primary"]');
  const backup = page.locator('article[data-assurance-role="backup"]');
  const primaryProviderId = await primary.getAttribute("data-provider-id");
  const backupProviderId = await backup.getAttribute("data-provider-id");
  if (!primaryProviderId || !backupProviderId || primaryProviderId === backupProviderId) {
    throw new Error("Production plan did not produce independent primary and backup providers");
  }

  await record("shortlist", async () => {
    await page.locator("h1").scrollIntoViewIfNeeded();
    await hold(2200);
    await primary.scrollIntoViewIfNeeded();
    await hold(2600);
    await backup.scrollIntoViewIfNeeded();
    await hold(2600);
    await primary.scrollIntoViewIfNeeded();
    await moveTo(primary.getByRole("button", { name: /^Request / }));
    await hold(1000);
  });

  let primaryReservationUrl = "";
  await record("primary-request", async () => {
    await click(primary.getByRole("button", { name: /^Request / }));
    await expect(page).toHaveURL(/\/reservations\/[0-9a-f-]+$/);
    primaryReservationUrl = page.url();
    await expect(page.getByRole("status")).toContainText("Awaiting owner confirmation");
    await page.getByRole("status").scrollIntoViewIfNeeded();
    await hold(3200);
  });

  await record("primary-decline", async () => {
    await become(primaryProviderId, "/provider");
    await page.locator(".privacy-note").scrollIntoViewIfNeeded();
    await hold(1800);
    await click(page.getByRole("link", { name: "Review request" }));
    await hold(1200);
    await page.getByLabel(/Type DECLINE/).fill("DECLINE");
    await moveTo(page.getByRole("button", { name: "Decline request" }));
    await hold(700);
    await click(page.getByRole("button", { name: "Decline request" }));
    await expect(page.getByText("This request has a final decision.")).toBeVisible();
    await hold(2200);
  });

  let backupReservationUrl = "";
  await record("backup-activate", async () => {
    await become(seedIds.shopper, primaryReservationUrl);
    await expect(page.getByRole("heading", { name: "Backup available" })).toBeVisible();
    await page.getByRole("heading", { name: "Backup available" }).scrollIntoViewIfNeeded();
    await hold(2400);
    await moveTo(page.getByRole("button", { name: "Activate backup look" }));
    await hold(800);
    await click(page.getByRole("button", { name: "Activate backup look" }));
    await expect(page).not.toHaveURL(primaryReservationUrl);
    backupReservationUrl = page.url();
    await expect(page.getByRole("status")).toContainText("Awaiting owner confirmation");
    await hold(2400);
  });

  await record("backup-accept", async () => {
    await become(backupProviderId, "/provider");
    await hold(1200);
    await click(page.getByRole("link", { name: "Review request" }));
    await page.getByLabel(/Type ACCEPT/).fill("ACCEPT");
    await moveTo(page.getByRole("button", { name: "Accept request" }));
    await hold(700);
    await click(page.getByRole("button", { name: "Accept request" }));
    await expect(page.getByText("This request has a final decision.")).toBeVisible();
    await hold(2200);
  });

  await record("event-ready", async () => {
    await become(seedIds.shopper, backupReservationUrl);
    await expect(page.getByRole("heading", { name: "Event ready" })).toBeVisible();
    await page.getByRole("heading", { name: "Event ready" }).scrollIntoViewIfNeeded();
    await hold(3600);
    await page.getByText(/no payment has been collected/i).scrollIntoViewIfNeeded();
    await hold(2600);
  });
} finally {
  await context.close();
  if (video) await video.saveAs(rawVideo);
  await browser.close();
}

await writeFile(
  manifestPath,
  `${JSON.stringify({ baseURL, capturedAt: new Date().toISOString(), scenes }, null, 2)}\n`,
  "utf8",
);

console.log(JSON.stringify({ rawVideo, manifestPath, scenes }, null, 2));
