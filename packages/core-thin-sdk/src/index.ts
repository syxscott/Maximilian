// index.ts — public barrel for @max/core-thin-sdk.
//
// Re-exports types and the process supervision primitives (`Supervisor`,
// `healthCheck`) used by Maximilian to embed / monitor `opencode serve`.

export type {
  AgentPart,
  AssistantMessage,
  CommandExecutedEvent,
  EventEnvelope,
  FilePart,
  HealthResponse,
  MessagePart,
  MessagePartDeltaEvent,
  MessagePartUpdatedEvent,
  MessageUpdatedEvent,
  ModelRef,
  Part,
  PartBase,
  PermissionAskedEvent,
  PromptAdmitted,
  PromptInput,
  ProjectInfo,
  QuestionAskedEvent,
  ReasoningPart,
  RevertState,
  SendPromptResult,
  ServerConnectedEvent,
  Session,
  SessionCompactedEvent,
  SessionCreateInput,
  SessionCreatedEvent,
  SessionDeletedEvent,
  SessionErrorEvent,
  SessionIdleEvent,
  SessionListResponse,
  SessionLocation,
  SessionMessage,
  SessionPromptInput,
  SessionUpdatedEvent,
  StreamEvent,
  TextPart,
  TextPartOutput,
  TodoUpdatedEvent,
  ToolPart,
  ToolState,
  TokenUsage,
  TopEvent,
  UserMessage,
} from "./types.js";

export {
  InvalidRequestError,
  NotFoundError,
  OpencodeError,
  ServiceUnavailableError,
  UnauthorizedError,
  errorFromResponse,
} from "./errors.js";

export { healthCheck, type HealthCheckOptions, type HealthResult } from "./health.js";

export {
  Supervisor,
  type ReadyInfo,
  type SupervisorEvents,
  type SupervisorOptions,
} from "./supervisor.js";

// EventBridge: subscribes to opencode's SSE stream and dispatches events
// into Maximilian's EventStore via a normalized mapping table.
export {
  EventBridge,
  createEventBridge,
  type EventBridgeSdk,
  type EventBridgeOptions,
  type EventBridgeMetrics,
} from "./event-bridge.js";

export {
  OPENCODE_EVENT_MAP,
  buildMappingIndex,
  mapperFor,
  mapOpencodeEvent,
  isOpencodeEvent,
  type OpencodeEvent,
  type OpencodeEventMapping,
  type MappedEventDraft,
} from "./event-mapping.js";
