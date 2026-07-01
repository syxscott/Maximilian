/**
 * Tests for the Maximilian API client used by the TUI. We stub `fetch` and
 * verify the right URL / headers / HTTP method are constructed. The responses
 * themselves are validated by the API server (Zod) and the dashboard's own
 * runtime checks — the TUI client is a thin typed wrapper, so we only test
 * the wiring here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMaximilianClient } from "../src/api";

function makeResponse(body: unknown, init?: { ok?: boolean; status?: number; statusText?: string }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: init?.statusText ?? "OK",
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as Response;
}

describe("createMaximilianClient", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("calls /api/health with GET and no auth header when token is unset", async () => {
    const fetchMock = vi.fn(async () => Promise.resolve(makeResponse({ status: "ok", providers: [], defaultProvider: "anthropic", evolution: "enabled", dagsMode: "off", metaAgent: "off", telemetry: "on" })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createMaximilianClient("http://localhost:3001");
    const result = await client.health();

    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0]!;
    expect(call[0]).toBe("http://localhost:3001/api/health");
    const init = call[1] as RequestInit;
    expect(init.method).toBe("GET");
    const headers = init.headers as Record<string, string>;
    expect(headers["authorization"]).toBeUndefined();
    expect(result.status).toBe("ok");
  });

  it("injects Authorization: Bearer <token> when token is provided", async () => {
    const fetchMock = vi.fn(async () => Promise.resolve(makeResponse({ status: "ok", providers: [], defaultProvider: "", evolution: "", dagsMode: "", metaAgent: "", telemetry: "" })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createMaximilianClient("http://localhost:3001", "secret-token-123");
    await client.health();

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer secret-token-123");
    expect(headers["content-type"]).toBe("application/json");
  });

  it("posts the message body to /api/chat", async () => {
    const fetchMock = vi.fn(async () => Promise.resolve(makeResponse({ workspaceId: "ws-1", planId: "plan-1", status: "planning" })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createMaximilianClient("http://localhost:3001");
    const result = await client.chat("hello world");

    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0]!;
    expect(call[0]).toBe("http://localhost:3001/api/chat");
    const init = call[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ message: "hello world" }));
    expect(result.workspaceId).toBe("ws-1");
  });

  it("URL-encodes the range query param for usage summary", async () => {
    const fetchMock = vi.fn(async () => Promise.resolve(makeResponse({
      range: "today",
      totalRequests: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheCreationTokens: 0,
      realTotalTokens: 0,
      totalCostUsd: 0,
      successRate: 0,
      cacheHitRate: 0,
      unpricedRequestCount: 0,
      latency: { p50Ms: 0, p95Ms: 0, p99Ms: 0, avgMs: 0, sampleCount: 0 },
    })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createMaximilianClient("http://localhost:3001");
    await client.getUsageSummary("today");

    expect(fetchMock.mock.calls[0]![0]).toBe("http://localhost:3001/api/obs/usage/summary?range=today");
  });

  it("surfaces non-2xx responses as an Error with status + body excerpt", async () => {
    const fetchMock = vi.fn(async () => Promise.resolve(makeResponse("evolution_disabled", { ok: false, status: 503, statusText: "Service Unavailable" })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createMaximilianClient("http://localhost:3001");
    await expect(client.listExecutions()).rejects.toThrow(/503.*evolution_disabled/);
  });

  it("exposes all five typed endpoints as methods", () => {
    const client = createMaximilianClient("http://localhost:3001");
    expect(typeof client.health).toBe("function");
    expect(typeof client.listExecutions).toBe("function");
    expect(typeof client.listPendingProposals).toBe("function");
    expect(typeof client.getUsageSummary).toBe("function");
    expect(typeof client.chat).toBe("function");
  });
});
