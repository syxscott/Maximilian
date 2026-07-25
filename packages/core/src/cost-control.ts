/**
 * Cost control — token budgets, per-tenant quotas, and rate-limit awareness.
 *
 * Three layers of cost control:
 *
 *   1. Per-task budget (TaskBudget)
 *      Hard cap on tokens for a single task. When exceeded, the runtime
 *      aborts the task with a `BudgetExceeded` error.
 *
 *   2. Per-tenant monthly quota (TenantQuota)
 *      Cumulative token cap per calendar month per tenant. When hit, new
 *      tasks are rejected with a `QuotaExceeded` error. Implemented as
 *      an in-memory ledger; swap with Redis/Postgres for multi-instance
 *      deployments.
 *
 *   3. Rate-limit awareness (RateLimitTracker)
 *      Tracks recent 429 responses per provider. Before dispatching a call,
 *      the runtime checks if the provider is in a backoff window. This is
 *      a soft control: it can be bypassed, but it prevents retry storms
 *      after a burst of 429s.
 *
 * Costs are estimated from token counts using a per-model price table.
 * The defaults are USD per 1M tokens; update for production pricing.
 */

import type { AgentRole } from "./types.js";

// ── Pricing ─────────────────────────────────────────────────────────────────

export interface ModelPricing {
  /** Provider id. */
  provider: string;
  /** Model name, or "*" for a provider-wide default. */
  model: string;
  /** USD per 1M fresh input tokens. */
  inputPer1M: number;
  /** USD per 1M output tokens. */
  outputPer1M: number;
  /** USD per 1M tokens served from provider-side prompt cache. Anthropic
   *  charges ~10% of input rate for cache reads; OpenAI-style providers
   *  discount 50% for cached prompts. */
  cacheReadPer1M?: number;
  /** USD per 1M tokens written into provider-side cache. Anthropic charges
   *  ~125% of input rate for cache writes. */
  cacheCreationPer1M?: number;
}

/**
 * Default price table — USD per 1M tokens.
 * Sources: Anthropic pricing page (Nov 2025), OpenAI pricing page, DeepSeek API docs.
 * Update when providers publish new rates; new model fallbacks to the
 * provider-wide "*" entry or the global default below.
 */
export const DEFAULT_PRICING: ModelPricing[] = [
  // Anthropic — Claude 4.x family
  { provider: "anthropic", model: "claude-3-5-sonnet",       inputPer1M: 3,    outputPer1M: 15,   cacheReadPer1M: 0.30, cacheCreationPer1M: 3.75 },
  { provider: "anthropic", model: "claude-sonnet-4-20250514", inputPer1M: 3,    outputPer1M: 15,   cacheReadPer1M: 0.30, cacheCreationPer1M: 3.75 },
  { provider: "anthropic", model: "claude-opus-4-20250514",   inputPer1M: 15,   outputPer1M: 75,   cacheReadPer1M: 1.50, cacheCreationPer1M: 18.75 },
  { provider: "anthropic", model: "claude-3-5-sonnet-20241022", inputPer1M: 3,  outputPer1M: 15,   cacheReadPer1M: 0.30, cacheCreationPer1M: 3.75 },
  { provider: "anthropic", model: "claude-3-5-haiku-20241022",  inputPer1M: 0.8, outputPer1M: 4,   cacheReadPer1M: 0.08, cacheCreationPer1M: 1.00 },
  { provider: "anthropic", model: "claude-3-opus-20240229",     inputPer1M: 15, outputPer1M: 75 },
  // OpenAI
  { provider: "openai", model: "gpt-4o",       inputPer1M: 2.5,  outputPer1M: 10,    cacheReadPer1M: 1.25 },
  { provider: "openai", model: "gpt-4o-mini",  inputPer1M: 0.15, outputPer1M: 0.6,   cacheReadPer1M: 0.075 },
  { provider: "openai", model: "o3",           inputPer1M: 10,   outputPer1M: 40,    cacheReadPer1M: 2.5 },
  { provider: "openai", model: "o4-mini",      inputPer1M: 1.10, outputPer1M: 4.40,  cacheReadPer1M: 0.275 },
  { provider: "openai", model: "gpt-4-turbo",  inputPer1M: 10,   outputPer1M: 30 },
  // DeepSeek — OpenAI-compatible API
  { provider: "deepseek", model: "deepseek-chat",     inputPer1M: 0.27, outputPer1M: 1.10, cacheReadPer1M: 0.07 },
  { provider: "deepseek", model: "deepseek-reasoner", inputPer1M: 0.55, outputPer1M: 2.19, cacheReadPer1M: 0.14 },
  // OpenRouter — wildcard; pass-through per-request pricing mostly wins.
  { provider: "openrouter", model: "*", inputPer1M: 2, outputPer1M: 8, cacheReadPer1M: 0.5 },
  // Global fallback — never matched unless a provider explicitly opts in.
  { provider: "*", model: "*", inputPer1M: 1, outputPer1M: 4 },
];

export interface UsageBreakdown {
  /** Fresh input tokens (cache reads already excluded). */
  input: number;
  /** Output tokens. */
  output: number;
  /** Tokens served from provider cache. */
  cacheRead?: number;
  /** Tokens written into provider cache. */
  cacheCreation?: number;
}

/** Compute USD cost for a (provider, model, token counts) tuple. */
export function computeCost(
  usage: UsageBreakdown,
  pricing: ModelPricing[] = DEFAULT_PRICING,
  provider: string = "unknown",
  model: string = "unknown",
): number {
  const match =
    pricing.find((p) => p.provider === provider && (p.model === model || p.model === "*")) ??
    pricing.find((p) => p.provider === "*");
  if (!match) return 0;

  const cacheReadRate = match.cacheReadPer1M ?? match.inputPer1M;
  const cacheCreationRate = match.cacheCreationPer1M ?? match.inputPer1M;

  const inputCost = usage.input * match.inputPer1M;
  const outputCost = usage.output * match.outputPer1M;
  const cacheReadCost = (usage.cacheRead ?? 0) * cacheReadRate;
  const cacheCreationCost = (usage.cacheCreation ?? 0) * cacheCreationRate;

  return (inputCost + outputCost + cacheReadCost + cacheCreationCost) / 1_000_000;
}

// ── Per-task budget ─────────────────────────────────────────────────────────

export class BudgetExceededError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly budgetUsd: number,
    public readonly consumedUsd: number,
  ) {
    super(`task ${taskId} exceeded budget: $${consumedUsd.toFixed(4)} > $${budgetUsd.toFixed(4)}`);
    this.name = "BudgetExceededError";
  }
}

export interface TaskBudgetOptions {
  /** USD per task. Default: $0.50. */
  budgetUsd?: number;
  /** Hard cap on total tokens per task, regardless of cost. Default: 200_000. */
  maxTokens?: number;
  /** Pricing table. */
  pricing?: ModelPricing[];
}

/**
 * Tracks spend for a single task. Call `record(usage)` after each LLM call;
 * it throws `BudgetExceededError` if the budget is exceeded.
 */
export class TaskBudget {
  readonly taskId: string;
  readonly budgetUsd: number;
  readonly maxTokens: number;
  private readonly pricing: ModelPricing[];
  private readonly totalInput = { value: 0 };
  private readonly totalOutput = { value: 0 };
  private _consumedUsd = 0;
  private _callCount = 0;

  constructor(taskId: string, options: TaskBudgetOptions = {}) {
    this.taskId = taskId;
    this.budgetUsd = options.budgetUsd ?? 0.5;
    this.maxTokens = options.maxTokens ?? 200_000;
    this.pricing = options.pricing ?? DEFAULT_PRICING;
  }

  /** Record token usage for a single LLM call. Throws on budget breach. */
  record(usage: UsageBreakdown, provider?: string, model?: string): void {
    this.totalInput.value += usage.input;
    this.totalOutput.value += usage.output;
    this._consumedUsd += computeCost(usage, this.pricing, provider, model);
    this._callCount++;
    if (this.totalInput.value + this.totalOutput.value > this.maxTokens) {
      throw new BudgetExceededError(this.taskId, this.budgetUsd, this._consumedUsd);
    }
    if (this._consumedUsd > this.budgetUsd) {
      throw new BudgetExceededError(this.taskId, this.budgetUsd, this._consumedUsd);
    }
  }

  /** Total tokens consumed so far. */
  totalTokens(): number {
    return this.totalInput.value + this.totalOutput.value;
  }

  /** Total USD consumed so far. */
  consumedUsd(): number {
    return this._consumedUsd;
  }

  /** Number of LLM calls made. */
  callCount(): number {
    return this._callCount;
  }

  /** Tokens remaining. */
  remainingTokens(): number {
    return Math.max(0, this.maxTokens - this.totalTokens());
  }

  /** Budget remaining in USD. */
  remainingBudgetUsd(): number {
    return Math.max(0, this.budgetUsd - this._consumedUsd);
  }
}

// ── Per-tenant monthly quota ────────────────────────────────────────────────

export class QuotaExceededError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly monthlyCapUsd: number,
    public readonly consumedUsd: number,
  ) {
    super(`tenant ${tenantId} exceeded monthly quota: $${consumedUsd.toFixed(4)} > $${monthlyCapUsd.toFixed(4)}`);
    this.name = "QuotaExceededError";
  }
}

export interface TenantQuotaOptions {
  /** Monthly cap in USD. Default: $50. */
  monthlyCapUsd?: number;
  /** Optional clock function for tests. */
  now?: () => Date;
}

interface TenantLedger {
  monthKey: string;
  consumedUsd: number;
}

/**
 * Tracks monthly spend per tenant. In-memory; swap with Redis/Postgres for
 * multi-instance deployments. Resets automatically on month change.
 */
export class TenantQuota {
  private readonly monthlyCapUsd: number;
  private readonly now: () => Date;
  private readonly ledgers = new Map<string, TenantLedger>();

  constructor(options: TenantQuotaOptions = {}) {
    this.monthlyCapUsd = options.monthlyCapUsd ?? 50;
    this.now = options.now ?? (() => new Date());
  }

  private currentMonthKey(): string {
    const d = this.now();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  /**
   * Check whether the tenant can spend `usd` more dollars this month.
   * Throws `QuotaExceededError` if not.
   */
  charge(tenantId: string, usd: number): void {
    if (usd < 0) throw new Error("charge amount must be non-negative");
    const key = this.currentMonthKey();
    let ledger = this.ledgers.get(tenantId);
    if (!ledger || ledger.monthKey !== key) {
      ledger = { monthKey: key, consumedUsd: 0 };
      this.ledgers.set(tenantId, ledger);
    }
    if (ledger.consumedUsd + usd > this.monthlyCapUsd) {
      throw new QuotaExceededError(tenantId, this.monthlyCapUsd, ledger.consumedUsd);
    }
    ledger.consumedUsd += usd;
  }

  /** Read current spend for a tenant (0 if not seen this month). */
  consumed(tenantId: string): number {
    const key = this.currentMonthKey();
    const ledger = this.ledgers.get(tenantId);
    if (!ledger || ledger.monthKey !== key) return 0;
    return ledger.consumedUsd;
  }

  /** Monthly cap in USD (exposed for preflight checks). */
  get capUsd(): number {
    return this.monthlyCapUsd;
  }

  /** Reset a tenant's ledger (e.g. for plan upgrades). */
  reset(tenantId: string): void {
    this.ledgers.delete(tenantId);
  }

  /** Snapshot of all tenants and their current month spend. */
  snapshot(): Array<{ tenantId: string; consumedUsd: number; remainingUsd: number }> {
    const key = this.currentMonthKey();
    return [...this.ledgers.entries()].map(([tenantId, ledger]) => ({
      tenantId,
      consumedUsd: ledger.monthKey === key ? ledger.consumedUsd : 0,
      remainingUsd: Math.max(0, this.monthlyCapUsd - (ledger.monthKey === key ? ledger.consumedUsd : 0)),
    }));
  }
}

// ── Rate-limit awareness ────────────────────────────────────────────────────

export interface RateLimitTrackerOptions {
  /** Default backoff after a 429. Default: 30_000 ms. */
  defaultBackoffMs?: number;
  /** Maximum backoff after repeated 429s. Default: 120_000 ms. */
  maxBackoffMs?: number;
}

interface ProviderState {
  backoffUntil: number;
  consecutive429s: number;
  lastSeenAt: number;
}

/**
 * Tracks recent 429 responses per provider and exposes a `shouldBackoff()`
 * check. The runtime should call `shouldBackoff()` before dispatching any
 * LLM call; on 429 response, call `record429()` to extend the backoff.
 */
export class RateLimitTracker {
  private readonly defaultBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly states = new Map<string, ProviderState>();

  constructor(options: RateLimitTrackerOptions = {}) {
    this.defaultBackoffMs = options.defaultBackoffMs ?? 30_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 120_000;
  }

  /** Should the runtime back off this provider right now? */
  shouldBackoff(provider: string): { backoff: boolean; retryInMs: number } {
    const state = this.states.get(provider);
    if (!state) return { backoff: false, retryInMs: 0 };
    const now = Date.now();
    if (state.backoffUntil > now) {
      return { backoff: true, retryInMs: state.backoffUntil - now };
    }
    return { backoff: false, retryInMs: 0 };
  }

  /** Record a 429 response — extend the backoff window. */
  record429(provider: string): number {
    const now = Date.now();
    const state = this.states.get(provider) ?? { backoffUntil: 0, consecutive429s: 0, lastSeenAt: 0 };
    state.consecutive429s++;
    state.lastSeenAt = now;
    // Exponential backoff with cap: 30s, 60s, 120s, 120s, ...
    const backoff = Math.min(this.maxBackoffMs, this.defaultBackoffMs * Math.pow(2, state.consecutive429s - 1));
    state.backoffUntil = now + backoff;
    this.states.set(provider, state);
    return backoff;
  }

  /** Record a successful call — reset the 429 counter. */
  recordSuccess(provider: string): void {
    this.states.delete(provider);
  }

  /** Inspect state (for tests / dashboards). */
  getState(provider: string): { consecutive429s: number; backoffUntil: number; lastSeenAt: number } | undefined {
    const s = this.states.get(provider);
    if (!s) return undefined;
    return { ...s };
  }
}

// ── Convenience: cost-aware execution wrapper ──────────────────────────────

export interface CostGuardOptions {
  /** Required. */
  tenantId: string;
  /** Required. */
  taskId: string;
  /** Required. */
  role: AgentRole;
  /** Optional task budget override. */
  taskBudget?: TaskBudgetOptions;
  /** Quota tracker (shared). */
  quota?: TenantQuota;
  /** Rate-limit tracker (shared). */
  rateLimit?: RateLimitTracker;
  /** Provider that will be called. */
  provider?: string;
}

/**
 * Composite cost guard for a single task execution.
 * Use in the runtime:
 *
 *   const guard = new CostGuard({ tenantId, taskId, role, quota, rateLimit });
 *   const result = await guard.guard(() => provider.chat(messages));
 */
export class CostGuard {
  readonly taskBudget: TaskBudget;
  readonly tenantId: string;
  readonly taskId: string;
  readonly role: AgentRole;
  private readonly quota?: TenantQuota;
  private readonly rateLimit?: RateLimitTracker;
  private readonly provider?: string;

  constructor(options: CostGuardOptions) {
    this.tenantId = options.tenantId;
    this.taskId = options.taskId;
    this.role = options.role;
    this.quota = options.quota;
    this.rateLimit = options.rateLimit;
    this.provider = options.provider;
    this.taskBudget = new TaskBudget(options.taskId, options.taskBudget);
  }

  /** Throws QuotaExceededError or returns retry-after-ms if rate-limited. */
  preflight(): { ok: true } | { ok: false; retryInMs: number; reason: "quota" | "ratelimit" } {
    if (this.provider && this.rateLimit) {
      const { backoff, retryInMs } = this.rateLimit.shouldBackoff(this.provider);
      if (backoff) return { ok: false, retryInMs, reason: "ratelimit" };
    }
    if (this.quota) {
      // Check if there's any budget left. We use the consumed-vs-cap check
      // (rather than charge(0)) so a tenant at exactly the cap is also blocked.
      if (this.quota.consumed(this.tenantId) >= this.quota.capUsd) {
        return { ok: false, retryInMs: 0, reason: "quota" };
      }
    }
    return { ok: true };
  }

  /** Record token usage against both the task budget and tenant quota. */
  recordUsage(usage: UsageBreakdown, provider?: string, model?: string): number {
    const cost = computeCost(usage, undefined, provider ?? this.provider, model);
    if (this.quota) this.quota.charge(this.tenantId, cost);
    this.taskBudget.record(usage, provider, model);
    return cost;
  }
}
