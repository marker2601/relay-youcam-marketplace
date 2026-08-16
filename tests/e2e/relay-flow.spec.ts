import sharp from "sharp";
import { expect, test } from "@playwright/test";

import { failOnePreview, resetApplicationState } from "./helpers/app-state";
import {
  createBrief,
  enterAsProvider,
  enterAsShopper,
  fillBrief,
  futureChicagoEventDate,
  validEventDate,
  waitForReadyOffers,
} from "./helpers/journey";

test.beforeEach(async () => resetApplicationState());

test("a declined primary activates an independent backup and reaches Event ready", async ({
  browser,
}) => {
  const shopperContext = await browser.newContext();
  const shopper = await shopperContext.newPage();
  await enterAsShopper(shopper);
  await createBrief(shopper);
  await waitForReadyOffers(shopper);

  const primary = shopper.locator('article[data-assurance-role="primary"]');
  const backup = shopper.locator('article[data-assurance-role="backup"]');
  const primaryProviderId = await primary.getAttribute("data-provider-id");
  const backupProviderId = await backup.getAttribute("data-provider-id");
  expect(primaryProviderId).toBeTruthy();
  expect(backupProviderId).toBeTruthy();
  expect(primaryProviderId).not.toBe(backupProviderId);
  await expect(shopper.getByRole("button", { name: /^Request / })).toHaveCount(1);
  await expect(backup.getByRole("button", { name: /^Request / })).toHaveCount(0);

  await primary.getByRole("button", { name: /^Request / }).click();
  await expect(shopper).toHaveURL(/\/reservations\/[0-9a-f-]+$/);
  const primaryReservationUrl = shopper.url();

  const primaryContext = await browser.newContext();
  const primaryProvider = await primaryContext.newPage();
  await enterAsProvider(primaryProvider, primaryProviderId!);
  await primaryProvider.getByRole("link", { name: "Review request" }).click();
  await primaryProvider.getByLabel(/Type DECLINE/).fill("DECLINE");
  await primaryProvider.getByRole("button", { name: "Decline request" }).click();
  await expect(primaryProvider.getByText("This request has a final decision.")).toBeVisible();

  await shopper.reload();
  await shopper.getByRole("button", { name: "Activate backup look" }).click();
  await expect(shopper).not.toHaveURL(primaryReservationUrl);
  await expect(shopper).toHaveURL(/\/reservations\/[0-9a-f-]+$/);

  const backupContext = await browser.newContext();
  const backupProvider = await backupContext.newPage();
  await enterAsProvider(backupProvider, backupProviderId!);
  await backupProvider.getByRole("link", { name: "Review request" }).click();
  await backupProvider.getByLabel(/Type ACCEPT/).fill("ACCEPT");
  await backupProvider.getByRole("button", { name: "Accept request" }).click();
  await expect(backupProvider.getByText("This request has a final decision.")).toBeVisible();

  await shopper.reload();
  await expect(shopper.getByRole("heading", { name: "Event ready" })).toBeVisible();
  await expect(shopper.getByText(/no payment has been collected/i)).toBeVisible();
  await shopperContext.close();
  await primaryContext.close();
  await backupContext.close();
});

test("shopper request and provider acceptance converge on one confirmed reservation", async ({
  browser,
}) => {
  const shopperContext = await browser.newContext();
  const shopper = await shopperContext.newPage();
  await enterAsShopper(shopper);
  await createBrief(shopper);
  await waitForReadyOffers(shopper);

  const primary = shopper.locator('article[data-assurance-role="primary"]');
  const primaryProviderId = await primary.getAttribute("data-provider-id");
  expect(primaryProviderId).toBeTruthy();
  const requestButton = primary.getByRole("button", { name: /^Request / });
  await requestButton.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(shopper).toHaveURL(/\/reservations\/[0-9a-f-]+$/);
  await expect(shopper.getByRole("status")).toContainText("Awaiting owner confirmation");

  const providerContext = await browser.newContext();
  const provider = await providerContext.newPage();
  await enterAsProvider(provider, primaryProviderId!);
  await provider.getByRole("link", { name: "Review request" }).click();
  await provider.getByLabel(/Type ACCEPT/).fill("ACCEPT");
  const accept = provider.getByRole("button", { name: "Accept request" });
  const acceptResponse = provider.waitForResponse(
    (response) => response.url().endsWith("/accept") && response.request().method() === "POST",
  );
  await accept.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  expect((await acceptResponse).status()).toBe(200);
  await provider.reload();
  await expect(provider.getByText("Current reservation state: Event ready")).toBeAttached();

  await shopper.reload();
  await expect(shopper.getByText("Current reservation state: Event ready")).toBeAttached();
  await expect(shopper.getByText(/no payment has been collected/i)).toBeVisible();
  await shopperContext.close();
  await providerContext.close();
});

test("invalid photo preserves fields, and a no-match brief widens without another upload", async ({
  page,
}) => {
  expect(futureChicagoEventDate(new Date("2026-12-31T05:59:59.000Z"))).toBe("2027-01-29");
  expect(futureChicagoEventDate(new Date("2026-12-31T06:00:00.000Z"))).toBe("2027-01-30");
  await enterAsShopper(page);
  await fillBrief(page, { budgetMin: "1", budgetMax: "2" });
  const tinyPng = await sharp({
    create: { width: 120, height: 120, channels: 3, background: "#176b51" },
  })
    .png()
    .toBuffer();
  await page.getByLabel("Full-body photo").setInputFiles({
    name: "too-small.png",
    mimeType: "image/png",
    buffer: tinyPng,
  });
  await page.getByRole("button", { name: "Find my matches" }).click();
  await expect(page.locator(".form-error")).toContainText(/512 pixels/i);
  await expect(page.getByLabel("Event date")).toHaveValue(validEventDate);
  await expect(page.getByLabel("Maximum budget (USD)")).toHaveValue("2");

  await page.getByLabel("Full-body photo").setInputFiles(
    await import("./helpers/journey").then((module) => module.validPhotoPath),
  );
  await page.getByRole("button", { name: "Find my matches" }).click();
  await expect(page.getByRole("heading", { name: "No strong matches yet" })).toBeVisible();
  await page.getByLabel("Maximum budget (USD)").fill("120");
  await page.getByRole("button", { name: "Search again" }).click();
  await waitForReadyOffers(page);
});

test("partial failure, unauthorized direct access, and privacy deletion remain isolated", async ({
  browser,
}) => {
  const shopperContext = await browser.newContext();
  const shopper = await shopperContext.newPage();
  await enterAsShopper(shopper);
  const briefId = await createBrief(shopper);
  await waitForReadyOffers(shopper);
  await failOnePreview(briefId);
  await shopper.reload();
  await expect(shopper.getByText(/provider needs to replace this listing image/i)).toBeVisible();
  await expect(shopper.getByRole("button", { name: /^Request / })).toHaveCount(1);

  const providerContext = await browser.newContext();
  const provider = await providerContext.newPage();
  await provider.goto("/");
  await provider.getByRole("link", { name: "Supply your closet" }).click();
  const forbiddenRead = await provider.request.get(`/api/briefs/${briefId}`);
  expect(forbiddenRead.status()).toBe(401);

  await shopper.getByText("Privacy and image deletion").click();
  await shopper.getByLabel(/Delete my uploaded photo/).check();
  await shopper.getByRole("button", { name: "Delete my Relay images" }).click();
  await expect(shopper.getByText(/Relay has deleted its stored copies/)).toBeVisible();
  const deletedRead = await shopper.request.get(`/api/briefs/${briefId}`);
  expect(deletedRead.status()).toBe(404);
  await shopper.reload();
  await expect(shopper.getByRole("heading", { name: "Your Relay shortlist" })).toHaveCount(0);
  await shopperContext.close();
  await providerContext.close();
});

test("the marketplace has no horizontal overflow at a 320px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await enterAsShopper(page);
  await expect(page.getByRole("heading", { name: "What are you dressing for?" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});
