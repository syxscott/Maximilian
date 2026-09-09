// types.ts — request / response / event schemas for the opencode v2 protocol
// 借鉴 opencode: shapes mirror packages/protocol/src/groups/{session,message,event}.ts
// and packages/schema/src/session*.ts.
//
// Where the spec says "depends on schema version", we model the most useful
// common case and leave a doc-comment cross-reference.

// ── Generic Refs ───────────────────────────────────────────────────────────

export interface ModelRef {
  id: string;
  providerID: string;
  variant?: string;
}

export interface TokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}

export interface SessionLocation {
  directory: string;
  workspaceID?: string;
}

export interface ProjectInfo {
  id: string;
  directory: string;
}

export interface RevertState {
  messageID: string;
  partID?: string;
  snapshot?: string;
  diff?: string;
}

// ── Sessions ───────────────────────────────────────────────────────────────

export interface Session {
  id: string;
  parentID?: string;
  projectID: string;
  agent?: string;
  model?: ModelRef;
  cost: number;
  tokens: TokenUsage;
  time: { created: number; updated: number; archived?: number };
  title: string;
  location?: SessionLocation;
  subpath?: string;
  revert?: RevertState;
}

// ── Sessions: v1 Paged Responses ───────────────────────────────────────────

export interface SessionListResponse {
  data: Session[];
}

// ── Prompt Input ──────────────────────────────────────────────────────────

export interface TextPart {
  type: "text";
  text: string;
}

export interface FilePart {
  type: "file";
  mime: string;
  url: string;
  filename?: string;
}

export interface AgentPart {
  type: "agent";
  name: string;
}

export type MessagePart = TextPart | FilePart | AgentPart;

export interface PromptInput {
  text: string;
  files?: Array<{
    uri: string;
    mime: string;
    name?: string;
    description?: string;
    source?: { start: number; end: number; text: string };
  }>;
  agents?: Array<{ name: string; source?: { value: string } }>;
}

// ── Messages (output) ──────────────────────────────────────────────────────

export interface PartBase {
  id: string;
  messageID: string;
  sessionID: string;
}

export interface TextPartOutput extends PartBase {
  type: "text";
  text: string;
}

export type ToolState = "pending" | "running" | "completed" | "error";

export interface ToolPart extends PartBase {
  type: "tool";
  tool: string;
  callID: string;
  state: ToolState;
  input: unknown;
  output?: unknown;
  error?: string;
}

export interface ReasoningPart extends PartBase {
  type: "reasoning";
  text: string;
}

export type Part = TextPartOutput | ToolPart | ReasoningPart;

export interface MessageBase {
  id: string;
  sessionID: string;
}

export interface UserMessage extends MessageBase {
  role: "user";
  parts: MessagePart[];
  time: { created: number; completed?: number };
}

export interface AssistantMessage extends MessageBase {
  role: "assistant";
  parentID: string;
  agent: string;
  model: ModelRef;
  parts: Part[];
  cost: number;
  tokens: TokenUsage;
  finish?: string;
  error?: { type: string; message: string };
  time: { created: number; completed?: number };
}

export type SessionMessage = UserMessage | AssistantMessage;

// ── Session Input (admission receipt) ──────────────────────────────────────

export interface PromptAdmitted {
  admittedSeq: number;
  id: string;
  sessionID: string;
  prompt: PromptInput;
  delivery: "steer" | "queue";
  timeCreated: number;
  promotedSeq?: number;
}

// ── Send-prompt request inputs ─────────────────────────────────────────────

export interface SessionCreateInput {
  parentID?: string;
  title?: string;
  agent?: string;
  model?: ModelRef;
}

export interface SessionPromptInput {
  parts: MessagePart[];
  model?: { providerID: string; modelID: string };
  agent?: string;
  id?: string;
  delivery?: "steer" | "queue";
  resume?: boolean;
}

export interface SendPromptResult {
  info: AssistantMessage;
  parts: Part[];
}

// ── Events ─────────────────────────────────────────────────────────────────

export interface EventEnvelope<T = unknown> {
  /** "evt_<ascending>" */
  id: string;
  /** Discriminator (e.g. "session.created", "message.part.updated"). */
  type: string;
  data: T;
  metadata?: Record<string, unknown>;
  durable?: { aggregateID: string; seq: number; version: number };
  location?: SessionLocation;
}

export interface StreamEvent {
  type: string;
  timestamp?: number;
  sessionID?: string;
  messageID?: string;
  // The remainder is discriminator-specific; consumers narrow on `type`.
  [key: string]: unknown;
}

// ── Top-10 (per task spec) Event Payloads ──────────────────────────────────

export interface ServerConnectedEvent {
  type: "server.connected";
}

export interface SessionCreatedEvent {
  type: "session.created";
  sessionID: string;
  info: Session;
}

export interface SessionUpdatedEvent {
  type: "session.updated";
  sessionID: string;
  info: Session;
}

export interface SessionDeletedEvent {
  type: "session.deleted";
  sessionID: string;
  info: Session;
}

export interface SessionCompactedEvent {
  type: "session.compacted";
  sessionID: string;
}

export interface SessionIdleEvent {
  type: "session.idle" | "session.status";
  sessionID: string;
  status?: { type: "idle" } | { type: "retry"; attempt: number; message: string } | { type: "busy" };
}

export interface MessageUpdatedEvent {
  type: "message.updated";
  sessionID: string;
  info: SessionMessage;
}

export interface MessagePartUpdatedEvent {
  type: "message.part.updated";
  sessionID: string;
  part: Part;
  time?: number;
}

export interface MessagePartDeltaEvent {
  type: "message.part.delta";
  sessionID: string;
  messageID: string;
  partID: string;
  field: string;
  delta: string;
}

export interface SessionErrorEvent {
  type: "session.error";
  sessionID?: string;
  error: { type: string; message: string };
}

export interface PermissionAskedEvent {
  type: "permission.asked" | "permission.v2.asked";
  id: string;
  sessionID: string;
  permission?: string;
  action?: string;
  patterns?: string[];
  resources?: string[];
  metadata?: Record<string, unknown>;
  tool?: { messageID: string; callID: string };
}

export interface QuestionAskedEvent {
  type: "question.asked" | "question.v2.asked";
  id: string;
  sessionID: string;
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
  }>;
  tool?: { messageID: string; callID: string };
}

export interface CommandExecutedEvent {
  type: "command.executed";
  name: string;
  sessionID: string;
  arguments: string;
  messageID: string;
}

export interface TodoUpdatedEvent {
  type: "todo.updated";
  sessionID: string;
  todos: Array<unknown>;
}

export type TopEvent =
  | ServerConnectedEvent
  | SessionCreatedEvent
  | SessionUpdatedEvent
  | SessionDeletedEvent
  | SessionCompactedEvent
  | SessionIdleEvent
  | MessageUpdatedEvent
  | MessagePartUpdatedEvent
  | MessagePartDeltaEvent
  | SessionErrorEvent
  | PermissionAskedEvent
  | QuestionAskedEvent
  | CommandExecutedEvent
  | TodoUpdatedEvent;

// ── Health ─────────────────────────────────────────────────────────────────

export interface HealthResponse {
  healthy: true;
}
