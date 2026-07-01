/**
 * Tests for cost control: task budgets, tenant quotas, rate-limit awareness.
 */

import { describe, it, expect } from "vitest";
import {
  TaskBudget, TenantQuota, RateLimitTracker, CostGuard,
  BudgetExceededError, QuotaExceededError,
  computeCost, DEFAULT_PRICING,
} from "../src/cost-control.js";

describe("computeCost", () => {
  it("calculates USD from token counts using pricing table", () => {
    // Claude 3.5 Sonnet: $3/M input, $15/M output
    // 100k input + 50k output = 0.30 + 0.75 = $1.05
    const cost = computeCost({ input: 100_000, output: 50_000 }, DEFAULT_PRICING, "anthropic", "claude-3-5-sonnet-20241022");
    expect(cost).toBeCloseTo(1.05, 4);
  });

  it("returns 0 for unknown provider/model with no wildcard", () => {
    const cost = computeCost({ input: 1000, output: 1000 }, [], "x", "y");
    expect(cost).toBe(0);
  });

  it("uses wildcard pricing when available", () => {
    const cost = computeCost({ input: 1_000_000, output: 0 }, DEFAULT_PRICING, "openrouter", "any-model");
    expect(cost).toBe(2);
  });
});

describe("TaskBudget", () => {
  it("accumulates token usage and cost", () => {
    const b = new TaskBudget("t1", { budgetUsd: 1.0, pricing: [] });
    b.record({ input: 1000, output: 0 });
    b.record({ input: 0, output: 1000 });
    expect(b.totalTokens()).toBe(2000);
    expect(b.callCount()).toBe(2);
    // With empty pricing, cost is 0
    expect(b.consumedUsd()).toBe(0);
  });

  it("throws BudgetExceededError when USD cap is exceeded", () => {
    const b = new TaskBudget("t1", {
      budgetUsd: 0.01,
      pricing: [{ provider: "x", model: "y", inputPer1M: 10, outputPer1M: 10 }],
    });
    // 100 input tokens = $0.001, under cap
    b.record({ input: 100, output: 0 }, "x", "y");
    // 10k input tokens = $0.10, over cap
    expect(() => b.record({ input: 10_000, output: 0 }, "x", "y")).toThrow(BudgetExceededError);
  });

  it("throws BudgetExceededError when token cap is exceeded", () => {
    const b = new TaskBudget("t1", { budgetUsd: 1.0, maxTokens: 1000, pricing: [] });
    b.record({ input: 600, output: 0 });
    expect(() => b.record({ input: 0, output: 500 }, undefined, undefined)).toThrow(BudgetExceededError);
  });

  it("reports remaining budget and tokens", () => {
    const b = new TaskBudget("t1", { budgetUsd: 1.0, maxTokens: 1000, pricing: [] });
    b.record({ input: 100, output: 200 });
    expect(b.remainingTokens()).toBe(700);
    expect(b.remainingBudgetUsd()).toBe(1.0); // pricing is empty → no cost
  });
});

describe("TenantQuota", () => {
  it("accumulates spend and rejects when cap exceeded", () => {
    const q = new TenantQuota({ monthlyCapUsd: 1.0 });
    q.charge("acme", 0.5);
    q.charge("acme", 0.4);
    expect(q.consumed("acme")).toBeCloseTo(0.9, 4);
    expect(() => q.charge("acme", 0.2)).toThrow(QuotaExceededError);
  });

  it("isolates tenants", () => {
    const q = new TenantQuota({ monthlyCapUsd: 1.0 });
    q.charge("acme", 0.9);
    expect(() => q.charge("acme", 0.2)).toThrow(QuotaExceededError);
    // beta has its own budget
    q.charge("beta", 0.5);
    expect(q.consumed("beta")).toBe(0.5);
  });

  it("resets on month change", () => {
    let now = new Date("2026-06-15T00:00:00Z");
    const q = new TenantQuota({ monthlyCapUsd: 1.0, now: () => now });
    q.charge("acme", 0.9);
    expect(q.consumed("acme")).toBe(0.9);
    // Advance to next month
    now = new Date("2026-07-01T00:00:00Z");
    q.charge("acme", 0.5);
    expect(q.consumed("acme")).toBe(0.5);
  });

  it("rejects negative charges", () => {
    const q = new TenantQuota();
    expect(() => q.charge("acme", -1)).toThrow(/non-negative/);
  });

  it("snapshot includes all tenants", () => {
    const q = new TenantQuota({ monthlyCapUsd: 10 });
    q.charge("a", 1);
    q.charge("b", 2);
    const snap = q.snapshot();
    expect(snap.length).toBe(2);
    const a = snap.find((s) => s.tenantId === "a");
    expect(a?.consumedUsd).toBe(1);
    expect(a?.remainingUsd).toBe(9);
  });
});

describe("RateLimitTracker", () => {
  it("returns no backoff initially", () => {
    const t = new RateLimitTracker();
    expect(t.shouldBackoff("anthropic").backoff).toBe(false);
  });

  it("extends backoff on 429 and resets on success", async () => {
    const t = new RateLimitTracker({ defaultBackoffMs: 100, maxBackoffMs: 1000 });
    const backoff = t.record429("anthropic");
    expect(backoff).toBe(100);
    expect(t.shouldBackoff("anthropic").backoff).toBe(true);

    // Second 429 doubles the window
    const b2 = t.record429("anthropic");
    expect(b2).toBe(200);
    expect(t.shouldBackoff("anthropic").retryInMs).toBeGreaterThan(0);

    // Success resets
    t.recordSuccess("anthropic");
    expect(t.shouldBackoff("anthropic").backoff).toBe(false);
  });

  it("caps backoff at maxBackoffMs", () => {
    const t = new RateLimitTracker({ defaultBackoffMs: 100, maxBackoffMs: 500 });
    t.record429("p"); // 100
    t.record429("p"); // 200
    t.record429("p"); // 400
    t.record429("p"); // 500 (capped from 800)
    const state = t.getState("p");
    expect(state?.consecutive429s).toBe(4);
    // 5th would be 1000 → capped to 500
    t.record429("p");
    const { retryInMs } = t.shouldBackoff("p");
    expect(retryInMs).toBeLessThanOrEqual(500);
  });
});

describe("CostGuard", () => {
  it("preflight passes when no quota and no rate limit", () => {
    const g = new CostGuard({ tenantId: "acme", taskId: "t1", role: "general" });
    expect(g.preflight().ok).toBe(true);
  });

  it("preflight fails on quota exhaustion", () => {
    const q = new TenantQuota({ monthlyCapUsd: 0.5 });
    q.charge("acme", 0.5);
    const g = new CostGuard({ tenantId: "acme", taskId: "t1", role: "general", quota: q });
    const r = g.preflight();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("quota");
  });

  it("preflight fails when rate-limited", () => {
    const r = new RateLimitTracker({ defaultBackoffMs: 1000 });
    r.record429("anthropic");
    const g = new CostGuard({ tenantId: "acme", taskId: "t1", role: "general", rateLimit: r, provider: "anthropic" });
    const result = g.preflight();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("ratelimit");
      expect(result.retryInMs).toBeGreaterThan(0);
    }
  });

  it("recordUsage charges quota and updates budget", () => {
    const q = new TenantQuota({ monthlyCapUsd: 10 });
    // Use a known provider/model from DEFAULT_PRICING
    const g = new CostGuard({
      tenantId: "acme", taskId: "t1", role: "general",
      quota: q, provider: "anthropic",
      taskBudget: { budgetUsd: 100, maxTokens: 5_000_000 },
    });
    // Claude 3.5 Sonnet: $3/M input, $15/M output. 1M input = $3.
    g.recordUsage({ input: 1_000_000, output: 0 }, "anthropic", "claude-3-5-sonnet-20241022");
    expect(q.consumed("acme")).toBeCloseTo(3.0, 3);
    expect(g.taskBudget.consumedUsd()).toBeCloseTo(3.0, 3);
  });
});
