import { expect, test } from "@playwright/test";

test("verify both lanes against the live testnet", async ({ page }) => {
  test.skip(process.env.HAVEN_LIVE_VERIFY !== "1", "Set HAVEN_LIVE_VERIFY=1 to read the testnet.");
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/verify");
  await page.getByRole("button", { name: "Verify both lanes" }).click();
  await expect(page.getByText(/Checking \d+ of/)).toBeVisible();
  await expect(page.getByText("Both lanes agree. The Native receipt names this payout.").first()).toBeVisible({ timeout: 170_000 });
  await expect(page.getByText("Could not reach the testnet")).toHaveCount(0);
  await expect(page.getByText("Refused before broadcast; there is no hash.").first()).toBeVisible();
  let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 1440, height: 900 });
  overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
