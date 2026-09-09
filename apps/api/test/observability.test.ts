/**
 * Observability smoke tests — verifies the metrics + OTel wiring produces
 * the formats Prometheus / OTLP collectors expect.
 *
 * These run against the production telemetry module (not a mock) so we
 * catch breaking changes to metric names, label shapes, or the SDK boot
 * sequence. We deliberately do NOT spin up the full Hono app here — the
 * metrics endpoint is just `collectMetrics()` rendered as a string.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  collectMetrics,
  metricsContentType,
  httpRequestTotal,
  taskTotal,
  llmTokensTotal,
  activeTasks,
  metricsRegistry,
} from "@max/telemetry";
import { initOtel } from "@max/telemetry";

describe("Prometheus metrics surface", () => {
  it("returns text/plain Prometheus exposition format", async () => {
    const body = await collectMetrics();
    // Prometheus text format includes the `# HELP` and `# TYPE` lines.
    expect(body).toMatch(/^# HELP /m);
    expect(body).toMatch(/^# TYPE /m);
    // The content type should be the prom-client default.
    expect(metricsContentType()).toContain("text/plain");
  });

  it("includes all expected metric names registered in the module", async () => {
    const body = await collectMetrics();
    expect(body).toContain("maximilian_requests_total");
    expect(body).toContain("maximilian_request_duration_seconds");
    expect(body).toContain("maximilian_tasks_total");
    expect(body).toContain("maximilian_task_duration_seconds");
    expect(body).toContain("maximilian_active_tasks");
    expect(body).toContain("maximilian_llm_tokens_total");
    expect(body).toContain("maximilian_llm_call_duration_seconds");
    expect(body).toContain("maximilian_llm_errors_total");
  });

  it("includes node-level default metrics (process_*, nodejs_*)", async () => {
    const body = await collectMetrics();
    // prom-client's default metrics are prefixed with maximilian_node_.
    expect(body).toMatch(/maximilian_node_/);
  });

  it("records httpRequestTotal increments as labeled samples", async () => {
    httpRequestTotal.inc({ method: "GET", route: "/test", status: "200" });
    const body = await collectMetrics();
    // The sample line should look like:
    //   maximilian_requests_total{method="GET",route="/test",status="200"} 1
    expect(body).toMatch(
      /maximilian_requests_total\{[^}]*method="GET"[^}]*route="\/test"[^}]*status="200"[^}]*\} 1/,
    );
  });

  it("records task + LLM metric increments", async () => {
    taskTotal.inc({ agentRole: "coder", status: "completed" });
    llmTokensTotal.inc({ provider: "openai", model: "gpt-4o", kind: "input" }, 123);
    activeTasks.set(7);

    const body = await collectMetrics();
    expect(body).toMatch(/maximilian_tasks_total\{[^}]*agentRole="coder"[^}]*\}/);
    expect(body).toMatch(/maximilian_llm_tokens_total\{[^}]*provider="openai"[^}]*\} 123/);
    expect(body).toMatch(/maximilian_active_tasks 7/);
  });

  it("exposes the registry for advanced consumers (Prometheus + OTel bridges)", () => {
    const reg = metricsRegistry();
    expect(reg).toBeDefined();
    expect(typeof reg.metrics).toBe("function");
  });
});

describe("OTel SDK initialization", () => {
  it("is a no-op when enabled: false (no SDK boot, no error)", () => {
    expect(() => initOtel({
      serviceName: "maximilian-test",
      enabled: false,
    })).not.toThrow();
  });

  it("is idempotent — calling twice does not crash", () => {
    expect(() => {
      initOtel({ serviceName: "maximilian-test", enabled: false });
      initOtel({ serviceName: "maximilian-test", enabled: false });
    }).not.toThrow();
  });
});

describe("/api/metrics endpoint shape", () => {
  it("renders as a Hono Response with the right Content-Type", async () => {
    // Tiny standalone app mirroring the production endpoint, minus auth.
    const app = new Hono();
    app.get("/api/metrics", async (c) => {
      const body = await collectMetrics();
      return new Response(body, {
        headers: { "Content-Type": metricsContentType(), "Cache-Control": "no-store" },
      });
    });

    // Bump a metric so we can assert a non-zero sample.
    httpRequestTotal.inc({ method: "GET", route: "/api/metrics", status: "200" });

    const res = await app.request("/api/metrics");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.text();
    expect(body).toContain("maximilian_requests_total");
  });
});