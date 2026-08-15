import sharp from "sharp";
import { expect, test } from "@playwright/test";

import { failOnePreview, resetApplicationState } from "./helpers/app-state";
import {
  createBrief,
  enterAsShopper,
  fillBrief,
  waitForReadyOffers,
} from "./helpers/journey";

test.beforeEach(async () => resetApplicationState());

test("shopper request and provider acceptance converge on one confirmed reservation", async ({
  browser,
}) => {
  const shopperContext = await browser.newContext();
  const shopper = await shopperContext.newPage();
  await enterAsShopper(shopper);
  await createBrief(shopper);
  await waitForReadyOffers(shopper);

  const selectedTitle = await shopper.getByRole("article").first().getByRole("heading").innerText();
  const requestButton = shopper.getByRole("button", { name: `Request ${selectedTitle}` });
  await requestButton.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(shopper).toHaveURL(/\/reservations\/[0-9a-f-]+$/);
  await expect(shopper.getByRole("status")).toContainText("Request sent");

  const providerContext = await browser.newContext();
  const provider = await providerContext.newPage();
  await provider.goto("/");
  await provider.getByRole("link", { name: "Supply your closet" }).click();
  await expect(provider).toHaveURL(/\/provider$/);
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
  await expect(provider.getByText("Current reservation state: Confirmed")).toBeAttached();

  await shopper.reload();
  await expect(shopper.getByText("Current reservation state: Confirmed")).toBeAttached();
  await expect(shopper.getByText(/no payment has been collected/i)).toBeVisible();
  await shopperContext.close();
  await providerContext.close();
});

test("invalid photo preserves fields, and a no-match brief widens without another upload", async ({
  page,
}) => {
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
  await expect(page.getByLabel("Event date")).toHaveValue("2026-09-20");
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
  await expect(shopper.getByRole("button", { name: /^Request / })).toHaveCount(2);

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
