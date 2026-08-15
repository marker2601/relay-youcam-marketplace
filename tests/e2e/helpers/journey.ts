import path from "node:path";

import { expect, type Page } from "@playwright/test";

export const validPhotoPath = path.resolve("public/demo/garments/emerald-midi.png");

export async function enterAsShopper(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("link", { name: "Shop as a guest" }).click();
  await expect(page).toHaveURL(/\/request\/new$/);
}

export async function fillBrief(
  page: Page,
  options: { budgetMin?: string; budgetMax?: string } = {},
): Promise<void> {
  await page.getByLabel("Event date").fill("2026-09-20");
  await page.getByLabel("Minimum budget (USD)").fill(options.budgetMin ?? "50");
  await page.getByLabel("Maximum budget (USD)").fill(options.budgetMax ?? "120");
  await page.getByLabel("Size label").fill("M");
  await page.getByLabel("Bust (cm)").fill("90");
  await page.getByLabel("Waist (cm)").fill("72");
  await page.getByLabel("Hips (cm)").fill("98");
  await page.getByLabel("Preferred colors").fill("emerald, navy, burgundy");
  await page.getByLabel("Style tags").fill("minimal, polished, statement");
  await page.getByLabel("Full-body photo").setInputFiles(validPhotoPath);
  await page.getByLabel(/I consent to Relay processing/).check();
}

export async function createBrief(page: Page): Promise<string> {
  await fillBrief(page);
  await page.getByRole("button", { name: "Find my matches" }).click();
  await expect(page).toHaveURL(/\/briefs\/[0-9a-f-]+$/, { timeout: 30_000 });
  return page.url().split("/").at(-1)!;
}

export async function waitForReadyOffers(page: Page, count = 3): Promise<void> {
  await expect(page.getByRole("button", { name: /^Request / })).toHaveCount(count, {
    timeout: 60_000,
  });
}
