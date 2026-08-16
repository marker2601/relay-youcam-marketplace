import { expect, test } from "@playwright/test";

import { resetApplicationState } from "./helpers/app-state";
import { createBrief, enterAsShopper, waitForReadyOffers } from "./helpers/journey";

test.beforeEach(async () => resetApplicationState());

test("landmarks, labels, focus, live updates, and touch targets remain operable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Get started" })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Shop as a guest" })).toBeFocused();
  const focusOutline = await page.getByRole("link", { name: "Shop as a guest" }).evaluate(
    (element) => Number.parseFloat(getComputedStyle(element).outlineWidth),
  );
  expect(focusOutline).toBeGreaterThanOrEqual(3);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/request\/new$/);

  const labels = [
    "Event date",
    "Event time (Chicago)",
    "Minimum budget (USD)",
    "Maximum budget (USD)",
    "Size label",
    "Bust (cm)",
    "Waist (cm)",
    "Hips (cm)",
    "Full-body photo",
  ];
  for (const label of labels) await expect(page.getByLabel(label)).toBeVisible();
  const interactiveSizes = await page.locator("button, a, input, select").evaluateAll((elements) =>
    elements
      .filter(
        (element) =>
          getComputedStyle(element).display !== "none" &&
          element.getAttribute("aria-label") !== "Open Next.js Dev Tools",
      )
      .map((element) => ({
        tag: element.tagName,
        name: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "",
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
      })),
  );
  expect(
    interactiveSizes.filter(
      (size) => (size.tag !== "INPUT" || size.width > 30) && size.height < 44,
    ),
  ).toEqual([]);

  const briefId = await createBrief(page);
  await expect(page.getByRole("status")).toContainText(/matches found|preparing/i);
  await waitForReadyOffers(page);
  await expect(page.getByRole("status")).toContainText("All 3 previews are ready");
  const imageAlts = await page.locator("main img").evaluateAll((images) =>
    images.map((image) => image.getAttribute("alt")),
  );
  expect(imageAlts.filter((alt) => !alt || alt.length <= 10)).toEqual([]);
  expect(await page.getByRole("dialog").count()).toBe(0);
  expect(briefId).toMatch(/^[0-9a-f-]+$/);
});

test("mobile content remains readable, ordered, and motion-safe", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await enterAsShopper(page);
  const headings = await page.locator("h1, h2, h3").evaluateAll((elements) =>
    elements.map((element) => Number(element.tagName.slice(1))),
  );
  expect(headings[0]).toBe(1);
  expect(headings.every((level, index) => index === 0 || level <= headings[index - 1]! + 1)).toBe(
    true,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= 320)).toBe(true);
});
