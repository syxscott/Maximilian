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
} from "./types.js";

// Runner
export {
  DatabaseRunner,
  type SqlExecutionResult,
} from "./runners/database-runner.js";

// Evaluator
export {
  BenchmarkEvaluator,
  type EvaluatorDeps,
} from "./evaluator.js";

// Bridge to SimulationEngine
export {
  toRoleProfile,
  aggregateToRoleProfile,
  computeBenchmarkDelta,
  type RoleProfile,
} from "./bridge.js";

// Bridge implementation (CachingBenchmarkBridge)
export { CachingBenchmarkBridge } from "./bridge-impl.js";

// Domain-specific runners
export { DevOpsRunner, type DevOpsExecutionResult } from "./runners/devops-runner.js";
export { FrontendRunner, type FrontendValidationResult, type StructuralFinding } from "./runners/frontend-runner.js";
