/**
 * OpencodeTraceCollector — tests with mocked SDK.
 *
 * Verifies that the collector:
 *   1. Fetches messages via the injected `TraceCollectorSdk` (no network).
 *   2. Normalizes user + assistant messages (text, tokens, cost, errors).
 *   3. Aggregates tool calls (deduped by callID).
 *   4. Computes durationMs + token totals correctly.
 *   5. Produces a TraceSchema-valid output.
 *
 * 借鉴 opencode: the SDK shape mirrors `OpencodeSdk.listMessages(client, sessionID)`
 * — by injecting a mock that satisfies `TraceCollectorSdk`, the test stays
 * hermetic and doesn't depend on a live `opencode serve` process.
 */

import { describe, it, expect } from "vitest";
import type { SessionMessage, AssistantMessage, UserMessage } from "@max/core-thin-sdk";
import { TraceSchema } from "../src/opencode-trace-collector.js";
import {
  OpencodeTraceCollector,
  type TraceCollectorSdk,
} from "../src/opencode-trace-collector.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeUserMessage(id: string, text: string, time: { created: number; completed?: number }): UserMessage {
  return {
    id,
    sessionID: "sess-1",
    role: "user",
    parts: [{ type: "text", text }],
    time,
  };
}

function makeAssistantMessage(
  id: string,
  text: string,
  opts: {
    callIDs?: string[];
    cost?: number;
    tokens?: { input: number; output: number; reasoning?: number; cache?: { read?: number; write?: number } };
    errored?: boolean;
    time: { created: number; completed?: number };
  },
): AssistantMessage {
  const parts: AssistantMessage["parts"] = [{ type: "text", id: `p-${id}-t`, messageID: id, sessionID: "sess-1", text }];
  if (opts.callIDs) {
    for (const callID of opts.callIDs) {
      parts.push({
        type: "tool",
        id: `p-${id}-${callID}`,
        messageID: id,
        sessionID: "sess-1",
        tool: "bash",
        callID,
        state: "completed",
        input: { command: "ls" },
        output: "ok",
      });
    }
  }
  return {
    id,
    sessionID: "sess-1",
    role: "assistant",
    parentID: "user-1",
    agent: "build",
    model: { id: "claude-sonnet-4-20250514", providerID: "anthropic" },
    parts,
    cost: opts.cost ?? 0,
    tokens: {
      input: opts.tokens?.input ?? 0,
      output: opts.tokens?.output ?? 0,
      reasoning: opts.tokens?.reasoning ?? 0,
      cache: {
        read: opts.tokens?.cache?.read ?? 0,
        write: opts.tokens?.cache?.write ?? 0,
      },
    },
    error: opts.errored ? { type: "rate_limit", message: "too many" } : undefined,
    time: opts.time,
  };
}

function mockSdk(messages: SessionMessage[]): TraceCollectorSdk & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    listMessages: async (sessionID: string) => {
      calls.push(sessionID);
      return messages;
    },
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("OpencodeTraceCollector", () => {
  it("throws when constructed without sdk and wireTo is not called", async () => {
    const c = new OpencodeTraceCollector();
    await expect(c.collectTrace("s1", "w1")).rejects.toThrow(/no SDK wired/);
  });

  it("throws when sessionId is missing", async () => {
    const c = new OpencodeTraceCollector({ sdk: mockSdk([]) });
    await expect(c.collectTrace("", "w1")).rejects.toThrow(/sessionId/);
  });

  it("throws when workspaceId is missing", async () => {
    const c = new OpencodeTraceCollector({ sdk: mockSdk([]) });
    await expect(c.collectTrace("s1", "")).rejects.toThrow(/workspaceId/);
  });

  it("returns an empty trace for a session with no messages", async () => {
    const sdk = mockSdk([]);
    const c = new OpencodeTraceCollector({ sdk });
    const trace = await c.collectTrace("sess-empty", "ws-1");
    expect(trace.sessionId).toBe("sess-empty");
    expect(trace.workspaceId).toBe("ws-1");
    expect(trace.messages).toEqual([]);
    expect(trace.toolCalls).toEqual([]);
    expect(trace.durationMs).toBe(0);
    expect(trace.tokens.input).toBe(0);
    expect(trace.tokens.output).toBe(0);
    expect(sdk.calls).toEqual(["sess-empty"]);
  });

  it("normalizes user + assistant messages with text and tokens", async () => {
    const messages: SessionMessage[] = [
      makeUserMessage("u-1", "Please write a function", { created: 1000, completed: 1000 }),
      makeAssistantMessage("a-1", "Sure, here's one...", {
        cost: 0.0042,
        tokens: { input: 50, output: 120, cache: { read: 30 } },
        time: { created: 1010, completed: 1500 },
      }),
    ];
    const c = new OpencodeTraceCollector({ sdk: mockSdk(messages) });
    const trace = await c.collectTrace("sess-1", "ws-42");

    expect(trace.messages).toHaveLength(2);
    const [userMsg, asstMsg] = trace.messages;
    expect(userMsg?.role).toBe("user");
    expect(userMsg?.text).toBe("Please write a function");
    expect(asstMsg?.role).toBe("assistant");
    expect(asstMsg?.model).toBe("claude-sonnet-4-20250514");
    expect(asstMsg?.provider).toBe("anthropic");
    expect(asstMsg?.costUSD).toBeCloseTo(0.0042);
    expect(asstMsg?.errored).toBe(false);
    expect(trace.tokens.input).toBe(50);
    expect(trace.tokens.output).toBe(120);
    expect(trace.tokens.cacheRead).toBe(30);
    expect(trace.totalCostUSD).toBeCloseTo(0.0042);
    expect(trace.durationMs).toBe(1500 - 1000);
  });

  it("extracts tool calls from assistant parts and dedupes by callID", async () => {
    const messages: SessionMessage[] = [
      makeUserMessage("u-1", "Run ls", { created: 1000, completed: 1000 }),
      makeAssistantMessage("a-1", "Running ls...", {
        callIDs: ["call-1", "call-2"],
        cost: 0.001,
        time: { created: 1010, completed: 1200 },
      }),
      makeAssistantMessage("a-2", "Done.", {
        callIDs: ["call-2"], // duplicate — should be deduped
        cost: 0.0005,
        time: { created: 1210, completed: 1300 },
      }),
    ];
    const c = new OpencodeTraceCollector({ sdk: mockSdk(messages) });
    const trace = await c.collectTrace("sess-2", "ws-1");

    expect(trace.toolCalls).toHaveLength(2);
    const ids = trace.toolCalls.map((t) => t.callID).sort();
    expect(ids).toEqual(["call-1", "call-2"]);
    expect(trace.totalCostUSD).toBeCloseTo(0.0015);
  });

  it("marks assistant messages with errors as errored", async () => {
    const messages: SessionMessage[] = [
      makeUserMessage("u-1", "Do thing", { created: 1000, completed: 1000 }),
      makeAssistantMessage("a-1", "Trying...", {
        errored: true,
        time: { created: 1010, completed: 1100 },
      }),
    ];
    const c = new OpencodeTraceCollector({ sdk: mockSdk(messages) });
    const trace = await c.collectTrace("sess-3", "ws-1");

    expect(trace.messages[1]?.errored).toBe(true);
  });

  it("aggregates tokens across multiple assistant turns", async () => {
    const messages: SessionMessage[] = [
      makeUserMessage("u-1", "step 1", { created: 1000, completed: 1000 }),
      makeAssistantMessage("a-1", "ok", {
        tokens: { input: 10, output: 20, reasoning: 5, cache: { read: 1, write: 2 } },
        time: { created: 1010, completed: 1100 },
      }),
      makeAssistantMessage("a-2", "ok 2", {
        tokens: { input: 30, output: 40, reasoning: 0, cache: { read: 4, write: 5 } },
        time: { created: 1110, completed: 1200 },
      }),
    ];
    const c = new OpencodeTraceCollector({ sdk: mockSdk(messages) });
    const trace = await c.collectTrace("sess-4", "ws-1");
    expect(trace.tokens.input).toBe(40);
    expect(trace.tokens.output).toBe(60);
    expect(trace.tokens.reasoning).toBe(5);
    expect(trace.tokens.cacheRead).toBe(5);
    expect(trace.tokens.cacheWrite).toBe(7);
  });

  it("emits a schema-valid Trace object", async () => {
    const messages: SessionMessage[] = [
      makeUserMessage("u-1", "hi", { created: 1_000_000, completed: 1_000_000 }),
      makeAssistantMessage("a-1", "hello", {
        cost: 0.0001,
        time: { created: 1_000_010, completed: 1_000_500 },
      }),
    ];
    const c = new OpencodeTraceCollector({ sdk: mockSdk(messages) });
    const trace = await c.collectTrace("sess-5", "ws-1");
    const parsed = TraceSchema.parse(trace);
    expect(parsed.sessionId).toBe("sess-5");
    expect(parsed.workspaceId).toBe("ws-1");
    expect(parsed.collectedAt).toMatch(/T.*Z/);
  });

  it("propagates the configured agentRole onto the trace", async () => {
    const c = new OpencodeTraceCollector({
      sdk: mockSdk([]),
      agentRole: "backend",
    });
    const trace = await c.collectTrace("sess-6", "ws-1");
    expect(trace.agentRole).toBe("backend");
  });
});