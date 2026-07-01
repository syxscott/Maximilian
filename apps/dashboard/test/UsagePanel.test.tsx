/**
 * Tests for UsagePanel — verifies the range buttons drive the API calls
 * and the summary cards / chart render with the right numbers.
 *
 * Note: we mock @/lib/api/hooks directly rather than `fetch`, because
 * React Query's internals + Zod validation + fetch stubs interact in
 * fragile ways under jsdom. The contract we care about is the UI.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as hooks from "../src/lib/api/hooks";
import { UsagePanel } from "../src/components/UsagePanel";
import type { UsageSummary, UsageDailyResponse } from "../src/api";

function makeSummary(overrides: Partial<UsageSummary> = {}): UsageSummary {
  return {
    range: "7d",
    totalRequests: 42,
    totalInputTokens: 100_000,
    totalOutputTokens: 50_000,
    totalCacheReadTokens: 80_000,
    totalCacheCreationTokens: 5_000,
    realTotalTokens: 75_000,
    totalCostUsd: 1.2345,
    successRate: 0.95,
    cacheHitRate: 0.8,
    unpricedRequestCount: 0,
    latency: { p50Ms: 800, p95Ms: 2400, p99Ms: 5200, avgMs: 1100, sampleCount: 42 },
    ...overrides,
  };
}

function makeDaily(): UsageDailyResponse {
  return {
    range: "7d",
    daily: [
      { date: "2026-06-09", requestCount: 5, totalInputTokens: 1000, totalOutputTokens: 500, totalCacheReadTokens: 0, totalCacheCreationTokens: 0, totalTokens: 1500, totalCostUsd: 0.1 },
      { date: "2026-06-15", requestCount: 10, totalInputTokens: 2000, totalOutputTokens: 1000, totalCacheReadTokens: 0, totalCacheCreationTokens: 0, totalTokens: 3000, totalCostUsd: 0.2 },
    ],
  };
}

function mockHooks(summary: UsageSummary, daily: UsageDailyResponse) {
  vi.spyOn(hooks, "useUsageSummary").mockReturnValue({
    data: summary,
    isLoading: false,
    error: null,
  } as never);
  vi.spyOn(hooks, "useUsageDaily").mockReturnValue({
    data: daily,
    isLoading: false,
  } as never);
}

function renderWithClient() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <UsagePanel />
    </QueryClientProvider>,
  );
}

describe("UsagePanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders range buttons and default 7d summary", async () => {
    mockHooks(makeSummary(), makeDaily());
    renderWithClient();

    expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "30d" })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("$1.2345")).toBeInTheDocument();
    });
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("95.0%")).toBeInTheDocument();
    expect(screen.getByText("80.0%")).toBeInTheDocument();
  });

  it("switches range when a button is clicked", async () => {
    const summary7d = makeSummary();
    const summary30d = makeSummary({
      range: "30d",
      totalRequests: 200,
      totalCostUsd: 9.99,
    });
    const daily7d = makeDaily();
    const daily30d: UsageDailyResponse = { range: "30d", daily: [] };

    vi.spyOn(hooks, "useUsageSummary").mockImplementation(((range: string) => {
      return range === "30d"
        ? ({ data: summary30d, isLoading: false, error: null } as never)
        : ({ data: summary7d, isLoading: false, error: null } as never);
    }) as never);
    vi.spyOn(hooks, "useUsageDaily").mockImplementation(((range: string) => {
      return range === "30d"
        ? ({ data: daily30d, isLoading: false } as never)
        : ({ data: daily7d, isLoading: false } as never);
    }) as never);

    renderWithClient();

    // Initially shows 7d data
    await waitFor(() => {
      expect(screen.getByText("$1.2345")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "30d" }));

    // After click, the panel should re-render with 30d data
    await waitFor(() => {
      expect(screen.getByText("$9.9900")).toBeInTheDocument();
    });
  });

  it("flags unpriced requests with an alert card", async () => {
    mockHooks(
      makeSummary({
        unpricedRequestCount: 3,
        totalCostUsd: 0,
      }),
      makeDaily(),
    );
    renderWithClient();

    await waitFor(() => {
      const unpricedLabels = screen.getAllByText("Unpriced");
      expect(unpricedLabels.length).toBeGreaterThan(0);
    });
    // The "Unpriced" MetricCard carries the destructive class so the operator notices.
    const label = screen.getByText("Unpriced");
    const card = label.closest("div")?.parentElement;
    expect(card?.className ?? "").toContain("destructive");
  });
});
