import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  test(`the ledger and the check fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Verify both lanes" })).toBeVisible();
    await expect(page.getByText("Refused before broadcast; there is no hash.").first()).toBeVisible();
    let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await page.getByRole("link", { name: "Check" }).click();
    await expect(page.getByRole("heading", { name: /both lanes/i })).toBeVisible();
    // Two desks: the fUSD ledger's seven scenes and the QOR ledger's six scenes.
    await expect(page.getByText("Nothing has been read from the testnet yet.")).toHaveCount(2);
    await expect(page.getByText("Nothing has been read from the testnet yet.").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Verify/ }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Spoofed receipt example" })).toBeVisible();
    await expect(page.getByText("Rejected: qor143f0ghn8slqguwez73087dvq8lqnuuukqdu9fl is not the ledger", { exact: false })).toBeVisible();
    overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test("the light theme stays on after leaving the page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Switch to light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("link", { name: "Check" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("button", { name: "Switch to dark" })).toBeVisible();
});
