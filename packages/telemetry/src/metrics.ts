/**
 * Prometheus metrics for Maximilian.
 *
 * Default registry — register once at process start, then expose via the
 * /api/metrics endpoint. Counters and histograms are exposed as singletons.
 *
 * Naming convention: maximilian_<domain>_<verb>_<unit?>
 */

import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";

const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: "maximilian_node_" });

// ── HTTP request metrics ────────────────────────────────────────────────

export const httpRequestTotal = new Counter({
  name: "maximilian_requests_total",
  help: "Total HTTP requests received",
  registers: [registry],
  labelNames: ["method", "route", "status"] as const,
});

export const httpRequestDuration = new Histogram({
  name: "maximilian_request_duration_seconds",
  help: "HTTP request duration in seconds",
  registers: [registry],
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

// ── Workspace / task metrics ────────────────────────────────────────────

export const taskDuration = new Histogram({
  name: "maximilian_task_duration_seconds",
  help: "Agent task execution duration in seconds",
  registers: [registry],
  labelNames: ["agentRole", "status"] as const,
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],
});

export const taskTotal = new Counter({
  name: "maximilian_tasks_total",
  help: "Total tasks executed",
  registers: [registry],
  labelNames: ["agentRole", "status"] as const,
});

export const activeTasks = new Gauge({
  name: "maximilian_active_tasks",
  help: "Currently executing agent tasks (inc on task-start, dec on task-complete/task-failed)",
  registers: [registry],
});

// ── LLM metrics ──────────────────────────────────────────────────────────

export const llmTokensTotal = new Counter({
  name: "maximilian_llm_tokens_total",
  help: "Total LLM tokens consumed",
  registers: [registry],
  labelNames: ["provider", "model", "kind"] as const, // kind: "input" | "output"
});

export const llmCallDuration = new Histogram({
  name: "maximilian_llm_call_duration_seconds",
  help: "LLM call duration in seconds",
  registers: [registry],
  labelNames: ["provider", "model", "status"] as const,
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60],
});

export const llmErrorsTotal = new Counter({
  name: "maximilian_llm_errors_total",
  help: "Total LLM call errors",
  registers: [registry],
  labelNames: ["provider", "errorType"] as const,
});

// ── Phase 9 — SLO indicator metrics ──────────────────────────────────────

/**
 * TruthAudit verdicts, labelled by `verdict` ("correct" | "under_predicted"
 * | "over_predicted"). The SLO target is
 * `verdict="correct"` / `total_verdicts_total ≥ 0.8`. Computed by the
 * meta-system's TruthAudit when it emits a TruthReport.
 */
export const truthAuditVerdictsTotal = new Counter({
  name: "maximilian_truth_audit_verdicts_total",
  help: "TruthAudit verdicts, labelled by verdict kind",
  registers: [registry],
  labelNames: ["verdict"] as const,
});

/**
 * opencode sessions created vs sessions leaked (no `abortSession` call
 * before the workspace closed). The SLO target is
 * `opencode_session_leak_total / opencode_session_created_total < 0.0001`.
 * Phase 3 fixed the underlying leak (H6 + Phase 6) but the *measurement*
 * was added in Phase 9 so the SLO dashboard has data to chart.
 */
export const opencodeSessionsCreatedTotal = new Counter({
  name: "maximilian_opencode_sessions_created_total",
  help: "opencode sessions created",
  registers: [registry],
});

export const opencodeSessionsLeakedTotal = new Counter({
  name: "maximilian_opencode_sessions_leaked_total",
  help: "opencode sessions abandoned without an explicit abortSession (SessionProcessor leak)",
  registers: [registry],
});

/**
 * MetaOrchestrator cycle duration. The SLO target is P95 ≤ 60s. Wired
 * in `packages/meta-system/src/orchestrator.ts` cycle end. Exposed as a
 * histogram so dashboards can compute quantiles.
 */
export const metaCycleDuration = new Histogram({
  name: "maximilian_meta_cycle_duration_seconds",
  help: "MetaOrchestrator cycle duration in seconds",
  registers: [registry],
  buckets: [1, 5, 10, 30, 60, 120, 300, 600],
});

// ── Accessor ─────────────────────────────────────────────────────────────

export function metricsRegistry(): Registry {
  return registry;
}

export async function collectMetrics(): Promise<string> {
  return registry.metrics();
}

export function metricsContentType(): string {
  return registry.contentType;
}
