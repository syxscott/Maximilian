/**
 * Phase 3b — `OpencodeTraceCollector`.
 *
 * 借鉴 opencode: surface lifts `OpencodeSdk.listMessages` (the
 * `GET /api/session/{id}/message` endpoint from
 * `packages/sdk/js/src/v2/sdk.gen.ts`) into Maximilian's `Trace` shape so
 * ScholarEval's 8-dim scorer can read the *actual* session output rather
 * than relying on the in-memory `Result` blob.
 *
 * Why this exists:
 *   - The bridge (`EventBridge`) maps `session.idle` to a Maximilian event
 *     that triggers evolution scoring.
 *   - Evolution needs the full message + tool-call transcript to do
 *     grounded judging (what tools were invoked, in what order, with what
 *     input / output, how many tokens flowed).
 *   - `OpencodeSdk.listMessages` is the canonical source of that transcript
 *     — we don't re-derive it from SSE envelopes because the server is the
 *     one source of truth (envelopes can be dropped under back-pressure).
 *
 * Pure data fetch — no mutation, no caching, no LLM calls. The collector
 * is responsible only for *reading* the trace and shaping it.
 */

import { z } from "zod";
import { AgentRole } from "@max/core";
import { OpencodeSdk, type OpencodeHttpClient, type SessionMessage } from "@max/core-thin-sdk";

// ── Schemas ─────────────────────────────────────────────────────────────────

/**
 * One tool invocation observed during the session. We intentionally keep
 * this narrower than opencode's raw `tool:called` envelope so ScholarEval
 * doesn't depend on wire-format specifics.
 */
export const ToolCallSchema = z.object({
  /** Stable id from opencode (e.g. "call_abc123"). */
  callID: z.string(),
  /** Tool name (e.g. "bash", "edit", "read"). */
  tool: z.string(),
  /** Raw input the model handed to the tool. */
  input: z.unknown(),
  /** Final output / result if the tool completed; undefined if still pending. */
  output: z.unknown().optional(),
  /** Error message if the tool failed; undefined on success. */
  error: z.string().optional(),
  /** Wall-clock duration in ms (from tool.started → tool.success/failed). */
  durationMs: z.number().nonnegative().optional(),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

/**
 * One message in the session — either user or assistant. Modeled as a
 * normalized subset so ScholarEval can switch on `role` without
 * re-narrowing the v2 `SessionMessage` union.
 */
export const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  /** Assistant model identifier (e.g. "claude-sonnet-4-20250514"); undefined for user turns. */
  model: z.string().optional(),
  /** Provider identifier (e.g. "anthropic"); undefined for user turns. */
  provider: z.string().optional(),
  /** Joined text parts. */
  text: z.string(),
  /** Tool calls referenced by this assistant turn (callIDs that resolve to entries below). */
  toolCallIDs: z.array(z.string()).default([]),
  /** Cumulative cost reported by opencode for this assistant message (USD). */
  costUSD: z.number().nonnegative().default(0),
  /** True if the assistant message finished with an error. */
  errored: z.boolean().default(false),
  /** Server-reported created timestamp (epoch ms). */
  createdAt: z.number().optional(),
});
export type Message = z.infer<typeof MessageSchema>;

export const TokensSchema = z.object({
  input: z.number().int().nonnegative().default(0),
  output: z.number().int().nonnegative().default(0),
  reasoning: z.number().int().nonnegative().default(0),
  cacheRead: z.number().int().nonnegative().default(0),
  cacheWrite: z.number().int().nonnegative().default(0),
});
export type Tokens = z.infer<typeof TokensSchema>;

/**
 * One trace = one opencode session's worth of evidence. ScholarEval uses
 * this for 8-dim scoring; the evolution engine stores it alongside the
 * `MetricRecord` so postmortems can replay a failure.
 */
export const TraceSchema = z.object({
  sessionId: z.string(),
  workspaceId: z.string(),
  /** Agent role this session ran as. */
  agentRole: AgentRole.optional(),
  /** All messages, ordered oldest-first (matches `listMessages` server order). */
  messages: z.array(MessageSchema),
  /** All tool calls observed, keyed by `callID` (each appears at most once). */
  toolCalls: z.array(ToolCallSchema),
  /** Wall-clock session duration in ms (last `time.completed` - first `time.created`). */
  durationMs: z.number().nonnegative(),
  /** Token totals aggregated across all assistant turns. */
  tokens: TokensSchema,
  /** Sum of `cost` from every assistant message (USD). */
  totalCostUSD: z.number().nonnegative().default(0),
  /** ISO timestamp at which this trace was collected. */
  collectedAt: z.string(),
});
export type Trace = z.infer<typeof TraceSchema>;

// ── SDK contract ────────────────────────────────────────────────────────────

/**
 * Minimal subset of `@max/core-thin-sdk`'s opencode surface the collector
 * depends on. The real `OpencodeSdk.listMessages(client, sessionID)` exported
 * from `sdk.js` matches this signature exactly, so a real client can be
 * passed in production. Tests pass a mock that satisfies this same shape.
 *
 * 借鉴 opencode: typed narrow surface so the collector is testable without
 * spinning up an `opencode serve` process.
 */
export interface TraceCollectorSdk {
  listMessages(sessionID: string): Promise<SessionMessage[]>;
}

// ── Collector ───────────────────────────────────────────────────────────────

export interface OpencodeTraceCollectorOptions {
  /** Optional override for the SDK (used by tests). */
  sdk?: TraceCollectorSdk;
  /** Inject `agentRole` into every produced trace. Useful for downstream sorting. */
  agentRole?: AgentRole;
}

export class OpencodeTraceCollector {
  private readonly sdk: TraceCollectorSdk;
  private readonly agentRole?: AgentRole;

  constructor(opts: OpencodeTraceCollectorOptions = {}) {
    if (opts.sdk) {
      this.sdk = opts.sdk;
    } else {
      // Default wire-up: build a thin SDK bound to the provided client.
      // The caller is expected to pass the client via `wireTo()` once they
      // have one in scope — see `wireTo()` below.
      this.sdk = {
        listMessages: async () => {
          throw new Error(
            "OpencodeTraceCollector: no SDK wired; call `wireTo(client)` or pass `sdk` in the constructor",
          );
        },
      };
    }
    this.agentRole = opts.agentRole;
  }

  /**
   * Bind the collector to a real `OpencodeHttpClient`. Convenience for the
   * production wire-up path:
   *
   *   const collector = new OpencodeTraceCollector({ agentRole: "backend" });
   *   collector.wireTo(httpClient);
   */
  wireTo(client: OpencodeHttpClient): void {
    (this as unknown as { sdk: TraceCollectorSdk }).sdk = {
      listMessages: (sessionID) => OpencodeSdk.listMessages(client, sessionID),
    };
  }

  /**
   * Read all messages for a session and shape them into a `Trace`.
   * Pure function (over the SDK output); no I/O of its own beyond the
   * single SDK call.
   */
  async collectTrace(sessionId: string, workspaceId: string): Promise<Trace> {
    if (!sessionId) {
      throw new Error("OpencodeTraceCollector.collectTrace: `sessionId` is required");
    }
    if (!workspaceId) {
      throw new Error("OpencodeTraceCollector.collectTrace: `workspaceId` is required");
    }

    const raw = await this.sdk.listMessages(sessionId);

    const messages: Message[] = [];
    const toolCalls = new Map<string, ToolCall>();
    const tokens: Tokens = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
    let totalCost = 0;
    let earliest = Number.POSITIVE_INFINITY;
    let latest = 0;

    for (const m of raw) {
      const msg = normalizeMessage(m);
      messages.push(msg);

      if (msg.role === "assistant") {
        totalCost += msg.costUSD;
      }

      // Aggregate tokens from assistant turns.
      if (m.role === "assistant") {
        const t = m.tokens;
        if (t) {
          tokens.input += t.input ?? 0;
          tokens.output += t.output ?? 0;
          tokens.reasoning += t.reasoning ?? 0;
          tokens.cacheRead += t.cache?.read ?? 0;
          tokens.cacheWrite += t.cache?.write ?? 0;
        }
      }

      // Pull tool parts (any role can carry them, but in practice they're
      // only on assistant turns in opencode's v2 protocol).
      const parts = (m as { parts?: unknown }).parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          const tool = normalizeToolPart(part);
          if (tool) {
            toolCalls.set(tool.callID, tool);
          }
        }
      }

      const t = (m as { time?: { created?: number; completed?: number } }).time;
      if (t?.created !== undefined && t.created < earliest) earliest = t.created;
      if (t?.completed !== undefined && t.completed > latest) latest = t.completed;
    }

    const durationMs = Number.isFinite(earliest) && latest > earliest
      ? latest - earliest
      : 0;

    return TraceSchema.parse({
      sessionId,
      workspaceId,
      agentRole: this.agentRole,
      messages,
      toolCalls: Array.from(toolCalls.values()),
      durationMs,
      tokens,
      totalCostUSD: totalCost,
      collectedAt: new Date().toISOString(),
    });
  }
}

// ── Internal helpers ────────────────────────────────────────────────────────

function normalizeMessage(m: SessionMessage): Message {
  const parts = (m as { parts?: unknown[] }).parts ?? [];
  const textParts: string[] = [];
  const toolCallIDs: string[] = [];
  for (const p of parts) {
    if (!p || typeof p !== "object") continue;
    const obj = p as { type?: string; text?: string; callID?: string };
    if (obj.type === "text" && typeof obj.text === "string") {
      textParts.push(obj.text);
    } else if (obj.type === "tool" && typeof obj.callID === "string") {
      toolCallIDs.push(obj.callID);
    } else if (obj.type === "reasoning" && typeof obj.text === "string") {
      textParts.push(obj.text);
    }
  }

  if (m.role === "assistant") {
    const a = m as {
      model?: { id?: string; providerID?: string };
      cost?: number;
      error?: { type?: string; message?: string };
    };
    return MessageSchema.parse({
      id: m.id,
      role: "assistant",
      model: a.model?.id,
      provider: a.model?.providerID,
      text: textParts.join("\n"),
      toolCallIDs,
      costUSD: typeof a.cost === "number" ? a.cost : 0,
      errored: Boolean(a.error),
      createdAt: m.time?.created,
    });
  }

  return MessageSchema.parse({
    id: m.id,
    role: "user",
    text: textParts.join("\n"),
    toolCallIDs,
    createdAt: m.time?.created,
  });
}

function normalizeToolPart(part: unknown): ToolCall | undefined {
  if (!part || typeof part !== "object") return undefined;
  const p = part as {
    type?: string;
    callID?: string;
    tool?: string;
    input?: unknown;
    output?: unknown;
    error?: string;
    state?: string;
    time?: { started?: number; completed?: number };
  };
  if (p.type !== "tool") return undefined;
  if (typeof p.callID !== "string" || typeof p.tool !== "string") return undefined;

  let durationMs: number | undefined;
  if (typeof p.time?.started === "number" && typeof p.time?.completed === "number") {
    durationMs = Math.max(0, p.time.completed - p.time.started);
  }

  return ToolCallSchema.parse({
    callID: p.callID,
    tool: p.tool,
    input: p.input,
    output: p.output,
    error: p.error,
    durationMs,
  });
}