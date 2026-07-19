// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * A2AHandler — real A2A v0.3.0-compatible message handler.
 *
 * Implements the 5 borrowed patterns:
 *   - card-discovery : agent/card, agent/list
 *   - delegation     : agent/send, agent/send/resp, agent/clarify
 *   - event-mesh     : agent/notify (fire-and-forget)
 *   - tool-bridge    : agent/tool/invoke
 *   - federation     : apply redaction on agent/send for cross-org traffic
 *
 * Each network op is wrapped in `withSpan` (kourai-khryseai) and every
 * message is pre-screened with `quickClassify` (kourai Aidos) to short-
 * circuit noop / binary content.
 *
 * Federation redaction uses `redactPayload` (multi-agent-patterns) before
 * `routeMessage` is called. Blocked messages return a structured error.
 */

import { performance } from "node:perf_hooks";
import type { AgentRegistry } from "../orchestration/agent-registry.js";
import type { EventBus } from "../event-bus.js";
import type {
  AcpA2AMessage,
  AcpA2AResponse,
  A2AAgentCard,
  A2AContent,
  A2APart,
  A2ATaskState,
} from "./index.js";
import { quickClassify, type QuickClassify } from "./quick-classify.js";
import { redactPayload, DEFAULT_REDACTION_POLICIES, type RedactionPolicy } from "./redact.js";
import { fallbackCardFor, buildAgentIndex, validateAgentCard } from "./agent-card.js";
import { withSpan } from "./tracing.js";

/** JSON-RPC 2.0 standard error codes we use. */
const ERR_PARSE = -32700;
const ERR_INVALID_REQUEST = -32600;
const ERR_METHOD_NOT_FOUND = -32601;
const ERR_INVALID_PARAMS = -32602;
const ERR_INTERNAL = -32603;
const ERR_APPLICATION = -32000;
const ERR_BLOCKED = -32001;

export interface A2AHandlerOptions {
  /** Federation redaction policies. Default: DEFAULT_REDACTION_POLICIES. */
  redactionPolicies?: ReadonlyArray<RedactionPolicy>;
  /** Federation: skip redaction if `from` is in this allowlist (e.g. "self"). */
  trustedSenders?: ReadonlyArray<string>;
  /** Default message id when caller omits it. */
  defaultMessageId?: () => string;
}

export class A2AHandler {
  private readonly redactionPolicies: ReadonlyArray<RedactionPolicy>;
  private readonly trustedSenders: ReadonlyArray<string>;
  private readonly defaultMessageId: () => string;

  constructor(
    private registry: AgentRegistry,
    private eventBus: EventBus<any>,
    opts: A2AHandlerOptions = {},
  ) {
    this.redactionPolicies = opts.redactionPolicies ?? DEFAULT_REDACTION_POLICIES;
    this.trustedSenders = opts.trustedSenders ?? ["self", "local"];
    this.defaultMessageId = opts.defaultMessageId ?? (() => Math.random().toString(36).slice(2));
  }

  /**
   * Entry point. Routes to the correct sub-handler and applies the
   * pre-screening + withSpan wrapping uniformly.
   */
  async handle(msg: AcpA2AMessage): Promise<AcpA2AResponse> {
    if (!msg || msg.jsonrpc !== "2.0") {
      return {
        jsonrpc: "2.0",
        id: msg?.id,
        error: { code: ERR_INVALID_REQUEST, message: "jsonrpc must be 2.0" },
      };
    }
    if (!msg.params) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: ERR_INVALID_PARAMS, message: "params is required" },
      };
    }

    return withSpan<AcpA2AResponse>(
      `a2a.${msg.method}`,
      this.eventBus as EventBus<any> | undefined,
      { attributes: { method: msg.method, from: msg.params.from, to: msg.params.to } },
      async (spanCtx): Promise<AcpA2AResponse> => {
        switch (msg.method) {
          case "agent/send":
            return this.handleSend(msg, spanCtx.traceId, spanCtx.spanId);
          case "agent/send/resp":
            return this.handleSendResp(msg, spanCtx.traceId, spanCtx.spanId);
          case "agent/notify":
            return this.handleNotify(msg, spanCtx.traceId, spanCtx.spanId);
          case "agent/clarify":
            return this.handleClarify(msg, spanCtx.traceId, spanCtx.spanId);
          case "agent/card":
            return this.handleCard(msg, spanCtx.traceId, spanCtx.spanId);
          case "agent/list":
            return this.handleList(msg, spanCtx.traceId, spanCtx.spanId);
          case "agent/tool/invoke":
            return this.handleToolInvoke(msg, spanCtx.traceId, spanCtx.spanId);
          default:
            return {
              jsonrpc: "2.0",
              id: msg.id,
              error: { code: ERR_METHOD_NOT_FOUND, message: `Unknown method: ${msg.method}` },
            };
        }
      },
    ).catch((err): AcpA2AResponse => {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        error: {
          code: ERR_INTERNAL,
          message: err instanceof Error ? err.message : String(err),
        },
      };
    });
  }

  // ── Pre-screening helper ─────────────────────────────────────────────

  private preScreen(
    msg: AcpA2AMessage,
  ): { classify: QuickClassify; content: A2AContent; redacted: number; blocked: number } {
    const classify = quickClassify(msg.params.content);
    this.eventBus?.publish({
      type: "agent/a2a/classify",
      payload: { method: msg.method, classify, from: msg.params.from, to: msg.params.to },
      timestamp: Date.now(),
    });

    if (classify === "sensitive" || !this.trustedSenders.includes(msg.params.from)) {
      const result = redactPayload(msg.params.content, this.redactionPolicies, msg.params.from);
      if (result.redactedCount > 0) {
        this.eventBus?.publish({
          type: "agent/a2a/redacted",
          payload: {
            from: msg.params.from,
            to: msg.params.to,
            redactedCount: result.redactedCount,
          },
          timestamp: Date.now(),
        });
      }
      if (result.blockedCount > 0) {
        this.eventBus?.publish({
          type: "agent/a2a/redacted",
          payload: {
            from: msg.params.from,
            to: msg.params.to,
            blockedCount: result.blockedCount,
            blockedFields: result.blockedFields,
          },
          timestamp: Date.now(),
        });
        return {
          classify,
          content: result.content,
          redacted: result.redactedCount,
          blocked: result.blockedCount,
        };
      }
      return {
        classify,
        content: result.content,
        redacted: result.redactedCount,
        blocked: 0,
      };
    }
    return { classify, content: msg.params.content, redacted: 0, blocked: 0 };
  }

  // ── agent/send — synchronous request, returns delivery ack ──────────

  private async handleSend(
    msg: AcpA2AMessage,
    traceId: string,
    spanId: string,
  ): Promise<AcpA2AResponse> {
    const { from, to, taskId, messageId } = msg.params;
    const screened = this.preScreen(msg);

    if (screened.blocked > 0) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        error: {
          code: ERR_BLOCKED,
          message: `Federation policy blocked ${screened.blocked} field(s); redacted before delivery`,
          data: { state: "failed" as A2ATaskState, ...(taskId !== undefined ? { taskId } : {}) },
        },
      };
    }

    if (screened.classify === "noop") {
      this.eventBus?.publish({
        type: "agent/a2a/received",
        payload: { from, to, content: screened.content, classified: "noop" },
        timestamp: Date.now(),
        traceId,
        spanId,
      });
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: { delivered: true, classified: "noop", status: "completed" },
      };
    }

    const id = messageId ?? this.defaultMessageId();
    const payload = partsToPayload(screened.content);
    const delivered = await this.registry.routeMessage(from, to, payload, id);
    const status: A2ATaskState = delivered ? "completed" : "failed";

    this.eventBus?.publish({
      type: "agent/a2a/received",
      payload: { from, to, content: screened.content, delivered, classified: screened.classify },
      timestamp: Date.now(),
      traceId,
      spanId,
    });
    this.eventBus?.publish({
      type: "agent/a2a/sent",
      payload: { from, to, messageId: id, delivered },
      timestamp: Date.now(),
      traceId,
      spanId,
    });

    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: { delivered, status, classified: screened.classify },
    };
  }

  // ── agent/send/resp — same as send but expects a structured response ──

  private async handleSendResp(
    msg: AcpA2AMessage,
    traceId: string,
    spanId: string,
  ): Promise<AcpA2AResponse> {
    const base = await this.handleSend(msg, traceId, spanId);
    if (base.error) return base;
    if (!base.result?.delivered) return base;

    const recipient = this.registry.get(msg.params.to);
    if (!recipient?.receiver) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: { ...base.result, message: "no receiver attached" },
      };
    }

    try {
      const out = await recipient.receiver(
        msg.params.from,
        partsToPayload(msg.params.content),
      );
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: { ...base.result, data: out, status: "completed" },
      };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          delivered: true,
          status: "failed",
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  // ── agent/notify — fire-and-forget broadcast ─────────────────────────

  private async handleNotify(
    msg: AcpA2AMessage,
    traceId: string,
    spanId: string,
  ): Promise<AcpA2AResponse> {
    const { from, to, messageId } = msg.params;
    const screened = this.preScreen(msg);

    if (screened.blocked > 0) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: ERR_BLOCKED, message: "federation policy blocked notification" },
      };
    }

    const id = messageId ?? this.defaultMessageId();
    const promise = this.registry.routeMessage(from, to, partsToPayload(screened.content), id);
    promise.catch((err) => {
      this.eventBus?.publish({
        type: "agent/a2a/timeout",
        payload: {
          from,
          to,
          messageId: id,
          error: err instanceof Error ? err.message : String(err),
        },
        timestamp: Date.now(),
        traceId,
        spanId,
      });
    });

    this.eventBus?.publish({
      type: "agent/a2a/received",
      payload: { from, to, content: screened.content, classified: screened.classify },
      timestamp: Date.now(),
      traceId,
      spanId,
    });

    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: { delivered: true, classified: screened.classify, status: "submitted" },
    };
  }

  // ── agent/clarify — kourai-khryseai M13 CONFIRM_ORDER gate ───────────

  private async handleClarify(
    msg: AcpA2AMessage,
    traceId: string,
    spanId: string,
  ): Promise<AcpA2AResponse> {
    const { from, to, taskId, contextId } = msg.params;

    this.eventBus?.publish({
      type: "agent/a2a/input_required",
      payload: { from, to, content: msg.params.content, taskId, contextId },
      timestamp: Date.now(),
      traceId,
      spanId,
    });

    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        delivered: true,
        status: "input-required",
        awaiting: "user-response",
        message: "Recipient is awaiting user input; will publish agent/a2a/clarified on response",
        ...(taskId !== undefined ? { taskId } : {}),
        ...(contextId !== undefined ? { contextId } : {}),
      },
    };
  }

  // ── agent/card — kourai-khryseai fallback_card_for pattern ──────────

  private async handleCard(
    msg: AcpA2AMessage,
    traceId: string,
    spanId: string,
  ): Promise<AcpA2AResponse> {
    const { from, to } = msg.params;
    const card: A2AAgentCard | null = fallbackCardFor(this.registry, to);
    if (!card) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: ERR_METHOD_NOT_FOUND, message: `agent "${to}" not registered` },
      };
    }
    const v = validateAgentCard(card);

    this.eventBus?.publish({
      type: "agent/a2a/received",
      payload: { from, to, classified: "card" },
      timestamp: Date.now(),
      traceId,
      spanId,
    });

    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        delivered: true,
        status: "completed",
        card,
        classified: v.ok ? "card-valid" : "card-invalid",
        ...(v.ok ? {} : { message: v.errors.join("; ") }),
      },
    };
  }

  // ── agent/list — list all agents of a given type ────────────────────

  private async handleList(
    msg: AcpA2AMessage,
    traceId: string,
    spanId: string,
  ): Promise<AcpA2AResponse> {
    const { from, to } = msg.params;
    const typeFilter = to.length > 0 ? to : undefined;
    const agents = typeFilter ? this.registry.listByType(typeFilter) : this.registry.list();
    const projected = agents.map((a) => {
      const out: { id: string; type: string; status?: string } = { id: a.id, type: a.type };
      if (a.status !== undefined) out.status = a.status;
      return out;
    });

    this.eventBus?.publish({
      type: "agent/a2a/received",
      payload: { from, to, classified: "list" },
      timestamp: Date.now(),
      traceId,
      spanId,
    });

    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        delivered: true,
        status: "completed",
        agents: projected,
        classified: "list",
      },
    };
  }

  // ── agent/tool/invoke — tool-bridge pattern ─────────────────────────

  private async handleToolInvoke(
    msg: AcpA2AMessage,
    traceId: string,
    spanId: string,
  ): Promise<AcpA2AResponse> {
    const { from, to, taskId, contextId } = msg.params;
    const toolPayload = extractToolInvocation(msg.params.content);
    if (!toolPayload) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: ERR_INVALID_PARAMS, message: "agent/tool/invoke requires a data part with { toolName, args }" },
      };
    }

    const recipient = this.registry.get(to);
    if (!recipient) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: ERR_METHOD_NOT_FOUND, message: `agent "${to}" not registered` },
      };
    }

    const toolImpl = (recipient.metadata?.tools as Record<string, (args: unknown) => Promise<unknown> | unknown> | undefined)?.[
      toolPayload.toolName
    ];
    if (!toolImpl) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: ERR_METHOD_NOT_FOUND, message: `tool "${toolPayload.toolName}" not found on agent "${to}"` },
      };
    }

    const startMs = performance.now();
    let data: unknown;
    let status: A2ATaskState = "completed";
    try {
      data = await toolImpl(toolPayload.args);
    } catch (err) {
      data = { error: err instanceof Error ? err.message : String(err) };
      status = "failed";
    }
    const durationMs = performance.now() - startMs;

    this.eventBus?.publish({
      type: "agent/a2a/tool_invoked",
      payload: { from, to, toolName: toolPayload.toolName, durationMs },
      timestamp: Date.now(),
      traceId,
      spanId,
    });
    this.eventBus?.publish({
      type: "agent/a2a/tool_result",
      payload: { from, to, toolName: toolPayload.toolName, data, status, durationMs },
      timestamp: Date.now(),
      traceId,
      spanId,
    });

    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        delivered: true,
        status,
        data,
        classified: "tool",
        ...(taskId !== undefined ? { taskId } : {}),
        ...(contextId !== undefined ? { contextId } : {}),
      },
    };
  }

  // ── Convenience: build a card index for the API layer ───────────────

  buildIndex() {
    return buildAgentIndex(this.registry);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function partsToPayload(content: A2AContent): unknown {
  const text = firstText(content);
  return {
    parts: content.parts,
    ...(text !== undefined ? { text } : {}),
  };
}

function firstText(content: A2AContent): string | undefined {
  for (const part of content.parts) {
    if (part.kind === "text") return part.text;
  }
  return undefined;
}

function extractToolInvocation(content: A2AContent): { toolName: string; args: unknown } | null {
  for (const part of content.parts) {
    if (part.kind === "data") {
      const v = part.value as Record<string, unknown> | undefined;
      if (v && typeof v.toolName === "string") {
        return { toolName: v.toolName, args: v.args };
      }
    }
  }
  return null;
}
