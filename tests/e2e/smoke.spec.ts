import { expect, test } from "@playwright/test";

test("the public Relay entry point can open the shopper journey", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Relay is the reliability layer for time-sensitive fashion.",
    }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Shop as a guest" }).click();
  await expect(page).toHaveURL(/\/request\/new$/);
  await expect(page.getByRole("heading", { name: "What are you dressing for?" })).toBeVisible();
  await expect(page.getByLabel("Event time (Chicago)")).toBeVisible();
});
