/**
 * Phase 9 — Benchmark Core types.
 *
 * Zod schemas for benchmark tasks, results, and suite aggregates.
 * All validation is execution-based — no mocks.
 */

import { z } from "zod"

// ── Benchmark Task ──────────────────────────────────────────────────────────

export const BenchmarkDomainSchema = z.enum(["database", "devops", "frontend"])
export type BenchmarkDomain = z.infer<typeof BenchmarkDomainSchema>

export const BenchmarkDifficultySchema = z.enum(["easy", "medium", "hard"])
export type BenchmarkDifficulty = z.infer<typeof BenchmarkDifficultySchema>

/**
 * Database-specific context: DDL to initialize the sandbox, a gold-standard
 * query, and the expected result rows from executing that query.
 */
export const DatabaseTaskContextSchema = z.object({
  ddl: z.string().describe("CREATE TABLE + INSERT statements to initialize the sandbox DB"),
  goldQuery: z.string().describe("Reference SQL that produces the correct result"),
  goldResult: z
    .array(z.record(z.string(), z.unknown()))
    .describe("Expected rows from executing goldQuery"),
})
export type DatabaseTaskContext = z.infer<typeof DatabaseTaskContextSchema>

/**
 * DevOps-specific context: initial files to write to the sandbox, assertions
 * to check against the final file system state.
 */
export const DevOpsTaskContextSchema = z.object({
  initialFiles: z
    .record(z.string(), z.string())
    .describe("Map of relative path → content to pre-populate the sandbox"),
  assertions: z
    .array(
      z.object({
        path: z.string().describe("Relative file path to check"),
        check: z.enum(["exists", "not_exists", "contains", "matches", "executable"]),
        value: z.string().optional().describe("Expected content (for contains/matches)"),
      }),
    )
    .describe("Post-execution assertions against the sandbox file system"),
})
export type DevOpsTaskContext = z.infer<typeof DevOpsTaskContextSchema>

/**
 * Frontend-specific context: structural queries to validate against
 * the generated component code.
 */
export const FrontendTaskContextSchema = z.object({
  requirements: z.array(z.string()).describe("List of structural requirements to validate"),
  structuralQueries: z
    .array(
      z.object({
        pattern: z.string().describe("Regex pattern to search for in the code"),
        required: z.boolean().describe("Whether this pattern must be present"),
        label: z.string().describe("Human-readable label for this check"),
      }),
    )
    .describe("Structural validation queries"),
  componentType: z.string().describe("Expected component type (e.g. 'react', 'html')"),
})
export type FrontendTaskContext = z.infer<typeof FrontendTaskContextSchema>

/**
 * A single benchmark task. The `expectedOutputAssertion` is an async function
 * that receives the agent's raw output string and returns true if it's acceptable.
 */
export const BenchmarkTaskSchema = z.object({
  id: z.string(),
  domain: BenchmarkDomainSchema,
  difficulty: BenchmarkDifficultySchema,
  input: z.string().describe("The user prompt / requirement given to the agent"),
  context: z
    .record(z.string(), z.unknown())
    .describe("Domain-specific data (e.g. DatabaseTaskContext)"),
  expectedOutputAssertion: z.function({
    input: [z.string()],
    output: z.promise(z.boolean()),
  }),
  /**
   * Validator dispatch for this case (verify.py `check_type` array): names
   * resolved through the ValidatorRegistry. Absent → registry defaults.
   */
  checkType: z.array(z.string()).optional(),
  /** External ground-truth label: this case SHOULD trigger tool calls. */
  expectedToolCall: z.boolean().optional(),
  /** Tool definitions sent with the request (OpenAI function format). */
  tools: z
    .array(
      z.object({
        type: z.string().optional(),
        function: z.object({
          name: z.string(),
          description: z.string().optional(),
          parameters: z.record(z.string(), z.unknown()).optional(),
        }),
      }),
    )
    .optional(),
})
export type BenchmarkTask = z.infer<typeof BenchmarkTaskSchema>

// ── Benchmark Result ────────────────────────────────────────────────────────

export const TokenUsageSchema = z.object({
  prompt: z.number().int().nonnegative(),
  completion: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
})
export type TokenUsage = z.infer<typeof TokenUsageSchema>

export const BenchmarkResultSchema = z.object({
  taskId: z.string(),
  passed: z.boolean(),
  quality: z.number().min(0).max(1).describe("0 = fail, 1 = exact match, 0.5 = partial"),
  latencyMs: z.number().nonnegative(),
  tokenUsage: TokenUsageSchema,
  acceptanceScore: z.number().min(0).max(1).describe("Simulated user acceptance"),
  output: z.string().describe("Raw agent output (the generated SQL or explanation)"),
  error: z.string().optional(),
  // ── Additive (verify.py borrowing): validator / drift fields ─────────────
  /** Stable request hash — incremental reruns skip successful cases by it. */
  hash: z.string().optional(),
  /** Position of the task in the suite run (verify.py data_index). */
  dataIndex: z.number().int().nonnegative().optional(),
  /** Per-case validator fields keyed by validator name (verify.py result.update). */
  validatorFields: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  /** Always-on check ran on this response (verify.py:393-395). */
  errorOnlyReasoningChecked: z.boolean().optional(),
  /** Reasoning present while content and tool calls are all empty. */
  errorOnlyReasoning: z.boolean().optional(),
})
export type BenchmarkResult = z.infer<typeof BenchmarkResultSchema>

// ── Suite Result ────────────────────────────────────────────────────────────

export const AggregateMetricsSchema = z.object({
  passRate: z.number().min(0).max(1),
  avgQuality: z.number().min(0).max(1),
  avgLatencyMs: z.number().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  avgAcceptance: z.number().min(0).max(1),
  // ── Additive (verify.py borrowing): validator summary hoists ─────────────
  // tool_calls confusion matrix (expected label × actual finish_reason)
  toolCallsTp: z.number().int().nonnegative().optional(),
  toolCallsFn: z.number().int().nonnegative().optional(),
  toolCallsFp: z.number().int().nonnegative().optional(),
  toolCallsTn: z.number().int().nonnegative().optional(),
  /** External label count (true + false) — preferred match-rate denominator. */
  expectedToolCallTotalCount: z.number().int().nonnegative().optional(),
  /** (TP + TN) / labeled total; absent when nothing is labeled. */
  toolCallsMatchRate: z.number().min(0).max(1).optional(),
  /** schema-valid / triggered; absent when the model never triggered. */
  toolCallsSchemaAccuracy: z.number().min(0).max(1).optional(),
  /** Cases where the model actually triggered tool calls. */
  toolCallsTriggeredCount: z.number().int().nonnegative().optional(),
  toolCallsCountDistribution: z.record(z.string(), z.number().int().nonnegative()).optional(),
  /** finish_reason values outside {tool_calls, stop} on labeled cases. */
  toolCallsFinishOthersDetail: z.record(z.string(), z.number().int().nonnegative()).optional(),
  // error-only-reasoning (always-on check)
  errorOnlyReasoningCheckedCount: z.number().int().nonnegative().optional(),
  errorOnlyReasoningCount: z.number().int().nonnegative().optional(),
  errorOnlyReasoningRate: z.number().min(0).max(1).optional(),
  // scenario key-order probe
  scenarioCheckCheckedCount: z.number().int().nonnegative().optional(),
  scenarioCheckValidCount: z.number().int().nonnegative().optional(),
  scenarioCheckInvalidCount: z.number().int().nonnegative().optional(),
  scenarioCheckPassRate: z.number().min(0).max(1).optional(),
})
export type AggregateMetrics = z.infer<typeof AggregateMetricsSchema>

export const BenchmarkSuiteResultSchema = z.object({
  suiteId: z.string(),
  results: z.array(BenchmarkResultSchema),
  aggregateMetrics: AggregateMetricsSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  /** Full per-validator summaries (aggregateMetrics hoists the headline fields). */
  validatorSummaries: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  /** Cases skipped by incremental rerun (hash match on a successful result). */
  skippedByHash: z.number().int().nonnegative().optional(),
})
export type BenchmarkSuiteResult = z.infer<typeof BenchmarkSuiteResultSchema>

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Compute aggregate metrics from a list of results. */
export function computeAggregate(results: BenchmarkResult[]): AggregateMetrics {
  if (results.length === 0) {
    return { passRate: 0, avgQuality: 0, avgLatencyMs: 0, totalTokens: 0, avgAcceptance: 0 }
  }
  const passed = results.filter((r) => r.passed).length
  const totalLatency = results.reduce((s, r) => s + r.latencyMs, 0)
  const totalTokens = results.reduce((s, r) => s + r.tokenUsage.total, 0)
  const totalQuality = results.reduce((s, r) => s + r.quality, 0)
  const totalAcceptance = results.reduce((s, r) => s + r.acceptanceScore, 0)

  // Always-on error-only-reasoning aggregation (verify.py:530-542) —
  // hoisted only when at least one result carried the check, so legacy
  // results aggregate to exactly the legacy shape.
  const checkedResults = results.filter((r) => r.errorOnlyReasoningChecked === true)
  const errorOnlyCheckedCount = checkedResults.length
  const errorOnlyCount = checkedResults.filter((r) => r.errorOnlyReasoning === true).length

  return {
    passRate: round2(passed / results.length),
    avgQuality: round2(totalQuality / results.length),
    avgLatencyMs: round2(totalLatency / results.length),
    totalTokens,
    avgAcceptance: round2(totalAcceptance / results.length),
    ...(errorOnlyCheckedCount > 0
      ? {
          errorOnlyReasoningCheckedCount: errorOnlyCheckedCount,
          errorOnlyReasoningCount: errorOnlyCount,
          errorOnlyReasoningRate: round2(errorOnlyCount / errorOnlyCheckedCount),
        }
      : {}),
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
