/**
 * @max/telemetry — Phase 10 Observability Infrastructure.
 *
 * Full-lifecycle telemetry for execution traces and evolution events.
 * Self-contained package with zero dependencies on other @max/ packages.
 */

// Types
export {
  AgentMessageSchema,
  TeamGraphNodeSchema,
  AssignedTeamGraphSchema,
  ExecutionTraceSchema,
  ProposalTypeSchema,
  SimulatedScoresSchema,
  GovernanceVerdictSchema,
  RolloutStatusSchema,
  EvolutionTraceSchema,
  TelemetryConfigSchema,
  type AgentMessage,
  type TeamGraphNode,
  type AssignedTeamGraph,
  type ExecutionTrace,
  type ProposalType,
  type SimulatedScores,
  type GovernanceVerdict,
  type RolloutStatus,
  type EvolutionTrace,
  type TelemetryConfig,
} from "./types.js";

// Collector
export { TelemetryCollector } from "./collector.js";

// Logger
export { getLogger, resetLogger } from "./logger.js";

// OpenTelemetry
export { initOtel, getTracer, withSpan, context, trace } from "./otel.js";

// Prometheus metrics
export {
  metricsRegistry,
  collectMetrics,
  metricsContentType,
  httpRequestTotal,
  httpRequestDuration,
  taskDuration,
  taskTotal,
  activeWorkspaces,
  llmTokensTotal,
  llmCallDuration,
  llmErrorsTotal,
} from "./metrics.js";
