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
 */

/** ACP message types for client<->agent communication. */
export type AcpMessageType =
  | "initialize"
  | "session/new"
  | "session/load"
  | "session/prompt"
  | "session/update"
  | "session/cancel"
  | "session/close"
  | "error";

export interface AcpMessage {
  jsonrpc: "2.0";
  id?: string;
  method: AcpMessageType;
  params?: Record<string, unknown>;
}

// Agent-to-Agent message types
export type AcpA2AMessageType =
  | "agent/send"        // A→B 请求，单向
  | "agent/send/resp"  // A→B 带响应
  | "agent/notify";     // 单向通知

export interface AcpA2AMessage {
  jsonrpc: "2.0";
  id?: string;
  method: AcpA2AMessageType;
  params: {
    from: string;      // 发送方 agent id
    to: string;        // 接收方 agent id
    content: unknown;  // 消息内容
  };
}

export interface AcpA2AResponse {
  jsonrpc: "2.0";
  id?: string;
  result?: {
    delivered: boolean;
    error?: string;
  };
}

/** ACP event types emitted by the agent. */
export type AcpEventType =
  | "agent/status"
  | "agent/message"
  | "agent/tool/call"
  | "agent/tool/result"
  | "agent/error"
  | "session/loaded"
  | "agent/a2a/sent"
  | "agent/a2a/received";

export interface AcpEvent {
  type: AcpEventType;
  payload: unknown;
  sessionId?: string;
  timestamp?: number;
}
