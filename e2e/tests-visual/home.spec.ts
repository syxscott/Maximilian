import { test, expect } from "@playwright/test"

/**
 * Visual regression tests for the dashboard.
 *
 * Each test loads a stable page and asserts the rendered pixels
 * match the committed baseline in `__screenshots__/`. To re-baseline
 * after an intentional UI change:
 *
 *   pnpm --filter @max/e2e exec playwright test tests-visual --update-snapshots
 *
 * NOTE: tests are tagged `@visual` and currently skipped at the default
 * run level because baselines have not been committed yet. Run them
 * explicitly with `--grep "@visual"` after the first baseline generation.
 */

test.describe("@visual dashboard visual regression", () => {
  test("home page matches baseline", async ({ page }) => {
    test.skip(true, "baseline screenshots not yet committed; run --update-snapshots first")
    await page.goto("/")
    await expect(page.getByRole("main")).toBeVisible()
    await expect(page).toHaveScreenshot("home.png", { fullPage: true })
  })

  test("workspaces list matches baseline", async ({ page }) => {
    test.skip(true, "baseline screenshots not yet committed; run --update-snapshots first")
    await page.goto("/workspaces")
    await expect(page.getByRole("heading", { name: /workspaces/i })).toBeVisible()
    await expect(page).toHaveScreenshot("workspaces-list.png")
  })

  test("meta-system dashboard matches baseline", async ({ page }) => {
    test.skip(true, "baseline screenshots not yet committed; run --update-snapshots first")
    await page.goto("/meta-system")
    await expect(page.getByRole("heading", { name: /meta-system/i })).toBeVisible()
    await expect(page).toHaveScreenshot("meta-system.png", { fullPage: true })
  })

  test("settings page matches baseline", async ({ page }) => {
    test.skip(true, "baseline screenshots not yet committed; run --update-snapshots first")
    await page.goto("/settings")
    await expect(page.getByRole("heading", { name: /settings/i })).toBeVisible()
    await expect(page).toHaveScreenshot("settings.png")
  })
})

test.describe("@visual theme variants", () => {
  test("home page in dark mode", async ({ page }) => {
    test.skip(true, "baseline screenshots not yet committed; run --update-snapshots first")
    await page.goto("/")
    await page.evaluate(() => document.documentElement.classList.add("theme-dark"))
    await expect(page.getByRole("main")).toBeVisible()
    await expect(page).toHaveScreenshot("home-dark.png", { fullPage: true })
  })
})