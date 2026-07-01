import { test, expect, type Route } from "@playwright/test";

/**
 * Mock the API surface that the dashboard touches on first load. E2E tests
 * should not depend on a live API or LLM keys.
 */
const mockHealth = {
  status: "ok",
  version: "0.1.0",
  database: "connected",
};

const mockWorkspaces: { items: unknown[]; nextCursor: null; total: number } = {
  items: [
    {
      id: "ws-1",
      userRequest: "Build a todo app",
      status: "completed",
      createdAt: "2026-06-25T10:00:00Z",
      updatedAt: "2026-06-25T10:05:00Z",
    },
  ],
  nextCursor: null,
  total: 1,
};

const mockProviders = {
  items: [
    { id: "anthropic", name: "Anthropic", configured: true, models: ["claude-3-5-sonnet"] },
    { id: "openai", name: "OpenAI", configured: false, models: ["gpt-4o"] },
  ],
};

const mockGovernance = {
  maxAgents: 8,
  maxCapabilities: 32,
  maxDepth: 4,
  requireReviewForBirth: true,
  minUsageForBirth: 5,
  hitlRiskThreshold: 0.4,
  hitlAlwaysForActions: ["retire"],
};

const mockExecutions = { items: [], nextCursor: null, total: 0 };

async function stubApi(route: Route) {
  const url = new URL(route.request().url());
  const path = url.pathname;
  // Only intercept /api/* paths, leave Vite dev resources alone
  if (!path.startsWith("/api/") && path !== "/api") {
    return route.fallback();
  }
  if (path === "/api/health") {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockHealth) });
  }
  if (path.startsWith("/api/workspaces") && route.request().method() === "GET") {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockWorkspaces) });
  }
  if (path.startsWith("/api/providers")) {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockProviders) });
  }
  if (path.startsWith("/api/executions")) {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockExecutions) });
  }
  if (path.startsWith("/api/governance/config")) {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockGovernance) });
  }
  if (path === "/api/obs/leaderboard" || path.startsWith("/api/obs/")) {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ timeline: [], evolutions: [], count: 0 }) });
  }
  if (path === "/api/agents" || path.startsWith("/api/agents")) {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
  }
  return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
}

test.describe("Dashboard", () => {
  test("loads the app root", async ({ page }) => {
    const consoleErrors: string[] = [];
    const consoleAll: string[] = [];
    page.on("console", (msg) => {
      consoleAll.push(`[${msg.type()}] ${msg.text()}`);
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

    await page.route("**/*", stubApi);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const rootHtml = await page.locator("#root").innerHTML();
    const bodyText = await page.locator("body").innerText();
    if (rootHtml.trim() === "") {
      throw new Error(
        `root is empty. bodyText: ${bodyText.slice(0, 200)}\nconsole: ${consoleAll.join("\n")}`,
      );
    }
    expect(rootHtml.length).toBeGreaterThan(10);
  });

  test("navigates between tabs", async ({ page }) => {
    await page.route("**/*", stubApi);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => document.querySelectorAll('[role="tab"]').length > 0,
      { timeout: 15_000 },
    );

    const tabs = page.getByRole("tab");
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThanOrEqual(3);

    for (let i = 0; i < tabCount; i++) {
      await tabs.nth(i).click();
      const active = tabs.nth(i);
      await expect(active).toHaveAttribute("data-state", "active");
    }
  });

  test("chat panel validates empty input", async ({ page }) => {
    await page.route("**/*", stubApi);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("textarea", { timeout: 15_000 });
    const textarea = page.locator("textarea").first();
    const sendButton = page.getByRole("button", { name: /send/i }).first();
    await expect(sendButton).toBeDisabled();
    await textarea.fill("build something");
    await expect(sendButton).toBeEnabled();
  });
});
