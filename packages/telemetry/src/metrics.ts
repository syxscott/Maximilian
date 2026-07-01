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

export const activeWorkspaces = new Gauge({
  name: "maximilian_active_workspaces",
  help: "Currently executing workspaces",
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
