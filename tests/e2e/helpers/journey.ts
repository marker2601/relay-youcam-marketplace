import path from "node:path";

import { expect, type Page } from "@playwright/test";

import { seedIds } from "../../../scripts/seed";

export const validPhotoPath = path.resolve("public/demo/garments/emerald-midi.png");

export function futureChicagoEventDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  const result = new Date(Date.UTC(part("year"), part("month") - 1, part("day") + 30));
  return result.toISOString().slice(0, 10);
}

export const validEventDate = futureChicagoEventDate();

const seedUserIds = [
  seedIds.shopper,
  seedIds.peerJordan,
  seedIds.peerPriya,
  seedIds.boutique,
] as const;

function isSeedUserId(userId: string): userId is (typeof seedUserIds)[number] {
  return seedUserIds.includes(userId as (typeof seedUserIds)[number]);
}

async function enterAsDemoUser(page: Page, userId: string): Promise<void> {
  if (!isSeedUserId(userId)) throw new Error(`Unknown Relay seed user: ${userId}`);
  const sessionResponse = await page.request.post("/api/demo/session", {
    data: { userId },
    maxRedirects: 0,
  });
  expect(sessionResponse.status()).toBe(303);
  const location = sessionResponse.headers().location;
  expect(location).toBeTruthy();
  const followedResponse = await page.goto(location!);
  expect(followedResponse?.status()).toBe(200);
}

export async function enterAsShopper(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("link", { name: "Shop as a guest" }).click();
  await expect(page).toHaveURL(/\/request\/new$/);
}

export async function enterAsProvider(page: Page, userId: string): Promise<void> {
  await enterAsDemoUser(page, userId);
  await page.goto("/provider");
  await expect(page).toHaveURL(/\/provider$/);
}

export async function fillBrief(
  page: Page,
  options: { budgetMin?: string; budgetMax?: string } = {},
): Promise<void> {
  await page.getByLabel("Event date").fill(validEventDate);
  await page.getByLabel("Event time (Chicago)").fill("19:00");
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
  await expect(page.locator('article[data-offer-status="ready"]')).toHaveCount(count, {
    timeout: 60_000,
  });
  await expect(
    page.locator('article[data-assurance-role="primary"]').getByRole("button", {
      name: /^Request /,
    }),
  ).toHaveCount(1);
}
