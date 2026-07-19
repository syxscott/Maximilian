/**
 * ACP (Agent-Client Protocol) interfaces (borrowed from OpenHands).
 *
 * ACP is the wire protocol between editor/IDE and coding agent.
 * Reference: https://agentclientprotocol.com/
 *
 * Two layers:
 *   1. ACP adapter     — client<->agent JSON-RPC / HTTP+WS / stdio
 *   2. Backend adapter — Process / Docker / VM / Cloud sandbox execution
 *
 * OpenHands reference:
 *   https://docs.openhands.dev/usage/acp/openhands-acp-runtime
 *
 * A2A (Agent-to-Agent) layer borrows from Google A2A v0.3.0 spec:
 *   - Structured content parts (text | data) — kourai-khryseai/agents/hephaestus/messaging.py
 *   - contextId / taskId for streaming conversations — multi-agent-patterns/README.md
 *   - .well-known/agent-card discovery — mcp-server/src/agent_card.py:36-61
 *   - 5 patterns namespace: card-discovery | delegation | tool-bridge | federation | event-mesh
 */

/** ACP message types for client<->agent communication. */
export type AcpMessageType =
  | "initialize"
  | "session/new"
  | "session/load"
  | "session/prompt"
  | "session/update"
  | "session/cancel"
  | "session/cost"
  | "session/close"
  | "error";

export interface AcpMessage {
  jsonrpc: "2.0";
  id?: string;
  method: AcpMessageType;
  params?: Record<string, unknown>;
}

// ── A2A message types (borrowed pattern namespace from multi-agent-patterns) ─
//
// Each method below belongs to a pattern. The handler in a2a-handler.ts uses
// the pattern to decide which redaction / pre-screen / span attributes apply.
//
//   card-discovery  — agent/card, agent/list, /.well-known/agent-card
//   delegation      — agent/send, agent/send/resp, agent/notify
//   tool-bridge     — agent/tool/invoke
//   federation      — agent/send (cross-org), redacts PII before egress
//   event-mesh      — agent/notify (subscribe / unsubscribe)
//
/** @pattern card-discovery | delegation | tool-bridge | federation | event-mesh */
export type AcpA2AMessageType =
  | "agent/send"          // delegation: synchronous request, returns delivery ack
  | "agent/send/resp"     // delegation: synchronous request, returns recipient's response
  | "agent/notify"        // event-mesh: fire-and-forget broadcast
  | "agent/clarify"       // delegation: ask recipient for input_required before delivering
  | "agent/card"          // card-discovery: fetch one agent's card by id
  | "agent/list"          // card-discovery: list agents of a given type
  | "agent/tool/invoke";  // tool-bridge: invoke a tool on a remote agent

// ── Structured content parts (borrowed from kourai-khryseai/messaging.py:23-27) ─

export type A2ADataPart = {
  kind: "data";
  /** RFC 2046 mime type, e.g. "application/json", "image/png". */
  mimeType: string;
  /** Arbitrary structured value. */
  value: Record<string, unknown>;
};

export type A2ATextPart = {
  kind: "text";
  /** Plain text or Markdown. */
  text: string;
};

export type A2APart = A2ATextPart | A2ADataPart;

export type A2AContent = {
  /** Ordered list of parts. Mixed text/data is allowed. */
  parts: ReadonlyArray<A2APart>;
};

// ── A2A v0.3.0 Agent Card (borrowed from mcp-server + kourai) ───────────────

export type A2AAuthScheme = "bearer" | "apiKey" | "none";

export type A2AInputMode = "text" | "data" | "file";
export type A2AOutputMode = "text" | "data" | "file";

export interface A2ASkill {
  /** Stable id, max 64 chars. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Description, max 200 chars (see awesome-a2a-hub/README.md:17-57). */
  description: string;
  /** Free-form tags, 1-6 entries. */
  tags: ReadonlyArray<string>;
  /** Optional usage examples. */
  examples?: ReadonlyArray<string>;
  inputModes?: ReadonlyArray<A2AInputMode>;
  outputModes?: ReadonlyArray<A2AOutputMode>;
}

export interface A2AAgentCard {
  /** A2A spec version this card targets. */
  protocolVersion: "0.3.0";
  /** Human-readable agent name. */
  name: string;
  /** Optional URL the agent is reachable at (for HTTP deployments). */
  url?: string;
  /** Description, max 200 chars. */
  description: string;
  /** Wire bindings this agent supports. */
  supportedInterfaces: ReadonlyArray<{
    protocolVersion: "0.3.0";
    transport: "jsonrpc" | "grpc" | "http+sse";
  }>;
  /** Authentication schemes supported. */
  authentication: {
    schemes: ReadonlyArray<A2AAuthScheme>;
  };
  /** Default I/O modes if not specified per skill. */
  defaultInputModes: ReadonlyArray<A2AInputMode>;
  defaultOutputModes: ReadonlyArray<A2AOutputMode>;
  /** Skills this agent advertises. */
  skills: ReadonlyArray<A2ASkill>;
}

// ── A2A v0.3.0 request envelope ─────────────────────────────────────────────

export interface AcpA2AMessage {
  jsonrpc: "2.0";
  id?: string;
  method: AcpA2AMessageType;
  params: {
    from: string;
    to: string;
    content: A2AContent;
    /** Optional task identifier for streaming conversations. */
    taskId?: string;
    /** Optional context id shared across the whole conversation thread. */
    contextId?: string;
    /** Optional message id for idempotency. */
    messageId?: string;
    /** Optional: pattern namespace (set by caller if known). */
    pattern?: "card-discovery" | "delegation" | "tool-bridge" | "federation" | "event-mesh";
    /** Optional: cost/pricing metadata (placeholder for x402 ecosystem). */
    cost?: {
      model: "per-call" | "per-token" | "subscription";
      amount?: number;
      currency?: string;
    };
  };
}

// ── A2A v0.3.0 response envelope (borrowed from mcp-server/a2a_bridge.py:545-558) ─

export type A2ATaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "failed"
  | "canceled";

export interface A2AAgentCardPayload {
  agent: string;
  card: A2AAgentCard;
}

export interface A2AAgentListPayload {
  type: string;
  agents: ReadonlyArray<{ id: string; type: string; status?: string }>;
}

export interface A2AResult {
  /** True if the message was delivered to the recipient's `receiver`. */
  delivered: boolean;
  /** When the recipient's receiver returned structured data, attach it. */
  data?: unknown;
  /** A2A task state mirror (e.g. "completed" if response was returned). */
  status?: A2ATaskState;
  /** For agent/clarify: signals recipient is awaiting user response. */
  awaiting?: "user-response";
  /** For agent/card: the agent's full card. */
  card?: A2AAgentCard;
  /** For agent/list: matching agents. */
  agents?: ReadonlyArray<{ id: string; type: string; status?: string }>;
  /** Optional human-readable note. */
  message?: string;
  /** Optional classify hint from pre-screening. */
  classified?: string;
}

export interface A2AError {
  /** JSON-RPC error code (extends JSON-RPC 2.0 spec). */
  code: number;
  message: string;
  /** Optional structured error data. */
  data?: {
    /** A2A task state when this error was generated. */
    state?: A2ATaskState;
    /** task_id echo for client correlation. */
    taskId?: string;
    /** A2A artifact parts on error, if any. */
    parts?: ReadonlyArray<A2APart>;
  };
}

export interface AcpA2AResponse {
  jsonrpc: "2.0";
  id?: string;
  result?: A2AResult;
  error?: A2AError;
}

// ── ACP event types emitted by the agent. ───────────────────────────────────

export type AcpEventType =
  | "agent/status"
  | "agent/message"
  | "agent/tool/call"
  | "agent/tool/result"
  | "agent/error"
  | "session/loaded"
  | "agent/a2a/sent"
  | "agent/a2a/received"
  | "agent/a2a/input_required"   // recipient signals user input needed
  | "agent/a2a/clarified"        // user responded to a clarification
  | "agent/a2a/tool_invoked"     // tool-bridge pattern: a tool was invoked
  | "agent/a2a/tool_result"      // tool-bridge pattern: tool returned a result
  | "agent/a2a/redacted"         // federation pattern: PII was redacted before egress
  | "agent/a2a/delivered"        // low-level: a single delivery was confirmed
  | "agent/a2a/timeout"          // low-level: delivery timeout (5s by default)
  | "agent/a2a/classify"         // low-level: pre-screen result for the message
  | "agent/a2a/span";            // low-level: tracing span opened/closed

export interface AcpEvent {
  type: AcpEventType;
  payload: unknown;
  sessionId?: string;
  timestamp?: number;
  /** Optional: distributed-tracing id for correlating logs across the A2A mesh. */
  traceId?: string;
  /** Optional: span id for the event. */
  spanId?: string;
}
