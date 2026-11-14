/**
 * @max/benchmark-core — Phase 9 Benchmark Infrastructure.
 *
 * Execution-based evaluation of Maximilian's multi-agent teams vs single-LLM baseline.
 * No mocks — all validation runs against real SQLite sandboxes and real LLM calls.
 */

// Types
export {
  BenchmarkTaskSchema,
  BenchmarkDomainSchema,
  BenchmarkDifficultySchema,
  DatabaseTaskContextSchema,
  BenchmarkResultSchema,
  TokenUsageSchema,
  BenchmarkSuiteResultSchema,
  AggregateMetricsSchema,
  computeAggregate,
  type BenchmarkTask,
  type BenchmarkDomain,
  type BenchmarkDifficulty,
  type DatabaseTaskContext,
  type BenchmarkResult,
  type TokenUsage,
  type BenchmarkSuiteResult,
  type AggregateMetrics,
  type DevOpsTaskContext,
  type FrontendTaskContext,
} from "./types.js"

// Runner
export { DatabaseRunner, type SqlExecutionResult } from "./runners/database-runner.js"

// Evaluator
export { BenchmarkEvaluator, type EvaluatorDeps } from "./evaluator.js"

// Bridge to SimulationEngine
export {
  toRoleProfile,
  aggregateToRoleProfile,
  computeBenchmarkDelta,
  type RoleProfile,
} from "./bridge.js"

// Bridge implementation (CachingBenchmarkBridge)
export { CachingBenchmarkBridge } from "./bridge-impl.js"

// Domain-specific runners
export { DevOpsRunner, type DevOpsExecutionResult } from "./runners/devops-runner.js"
export {
  FrontendRunner,
  type FrontendValidationResult,
  type StructuralFinding,
} from "./runners/frontend-runner.js"

// ── Validator layer (verify.py borrowing) ───────────────────────────────────
export type {
  CaseValidator,
  JsonSchemaObject,
  ObservedToolCall,
  ToolDefinition,
  ValidatorCaseContext,
  ValidatorCaseRun,
  ValidatorFields,
  ValidatorMessageSlice,
} from "./validators/types.js"
export { ValidatorRegistry, type ResolveOptions } from "./validators/registry.js"
export {
  ToolCallsValidator,
  type ToolCallsSummary,
  type ToolCallsValidateFields,
} from "./validators/tool-calls.js"
export {
  ScenarioCheckValidator,
  extractActualOrder,
  extractExpectedOrder,
  stripThinkBlocks,
  type ScenarioCheckSummary,
  type ScenarioCheckValidateFields,
} from "./validators/scenario-check.js"
export {
  isErrorOnlyReasoning,
  runErrorOnlyReasoningCheck,
  summarizeErrorOnlyReasoning,
  type ErrorOnlyReasoningFields,
  type ErrorOnlyReasoningSummary,
} from "./validators/error-only-reasoning.js"
export {
  validateAgainstSchema,
  summarizeSchemaIssues,
  type SchemaIssue,
} from "./validators/json-schema.js"
export { extractMessageFromRaw, extractToolsFromRaw } from "./validators/protocol.js"

// ── Trigger drift + incremental rerun ───────────────────────────────────────
export {
  classifyFinishReason,
  compareWithBaseline,
  computeTriggerF1,
  sampleFromResult,
  suitesToTriggerSamples,
  type LoopComparison,
  type LoopComparisonInput,
  type TriggerComparisonReport,
  type TriggerF1Result,
  type TriggerSample,
} from "./trigger-drift.js"
export {
  canonicalJson,
  loadPersistedResults,
  prepareBenchmarkRequest,
  saveResultsJsonl,
  stableHash,
} from "./persistence.js"
