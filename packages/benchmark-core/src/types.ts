/**
 * Phase 9 — Benchmark Core types.
 *
 * Zod schemas for benchmark tasks, results, and suite aggregates.
 * All validation is execution-based — no mocks.
 */

import { z } from "zod";

// ── Benchmark Task ──────────────────────────────────────────────────────────

export const BenchmarkDomainSchema = z.enum(["database", "devops", "frontend"]);
export type BenchmarkDomain = z.infer<typeof BenchmarkDomainSchema>;

export const BenchmarkDifficultySchema = z.enum(["easy", "medium", "hard"]);
export type BenchmarkDifficulty = z.infer<typeof BenchmarkDifficultySchema>;

/**
 * Database-specific context: DDL to initialize the sandbox, a gold-standard
 * query, and the expected result rows from executing that query.
 */
export const DatabaseTaskContextSchema = z.object({
  ddl: z.string().describe("CREATE TABLE + INSERT statements to initialize the sandbox DB"),
  goldQuery: z.string().describe("Reference SQL that produces the correct result"),
  goldResult: z.array(z.record(z.unknown())).describe("Expected rows from executing goldQuery"),
});
export type DatabaseTaskContext = z.infer<typeof DatabaseTaskContextSchema>;

/**
 * DevOps-specific context: initial files to write to the sandbox, assertions
 * to check against the final file system state.
 */
export const DevOpsTaskContextSchema = z.object({
  initialFiles: z.record(z.string()).describe("Map of relative path → content to pre-populate the sandbox"),
  assertions: z.array(z.object({
    path: z.string().describe("Relative file path to check"),
    check: z.enum(["exists", "not_exists", "contains", "matches", "executable"]),
    value: z.string().optional().describe("Expected content (for contains/matches)"),
  })).describe("Post-execution assertions against the sandbox file system"),
});
export type DevOpsTaskContext = z.infer<typeof DevOpsTaskContextSchema>;

/**
 * Frontend-specific context: structural queries to validate against
 * the generated component code.
 */
export const FrontendTaskContextSchema = z.object({
  requirements: z.array(z.string()).describe("List of structural requirements to validate"),
  structuralQueries: z.array(z.object({
    pattern: z.string().describe("Regex pattern to search for in the code"),
    required: z.boolean().describe("Whether this pattern must be present"),
    label: z.string().describe("Human-readable label for this check"),
  })).describe("Structural validation queries"),
  componentType: z.string().describe("Expected component type (e.g. 'react', 'html')"),
});
export type FrontendTaskContext = z.infer<typeof FrontendTaskContextSchema>;

/**
 * A single benchmark task. The `expectedOutputAssertion` is an async function
 * that receives the agent's raw output string and returns true if it's acceptable.
 */
export const BenchmarkTaskSchema = z.object({
  id: z.string(),
  domain: BenchmarkDomainSchema,
  difficulty: BenchmarkDifficultySchema,
  input: z.string().describe("The user prompt / requirement given to the agent"),
  context: z.record(z.unknown()).describe("Domain-specific data (e.g. DatabaseTaskContext)"),
  expectedOutputAssertion: z
    .function()
    .args(z.string())
    .returns(z.promise(z.boolean())),
});
export type BenchmarkTask = z.infer<typeof BenchmarkTaskSchema>;

// ── Benchmark Result ────────────────────────────────────────────────────────

export const TokenUsageSchema = z.object({
  prompt: z.number().int().nonnegative(),
  completion: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const BenchmarkResultSchema = z.object({
  taskId: z.string(),
  passed: z.boolean(),
  quality: z.number().min(0).max(1).describe("0 = fail, 1 = exact match, 0.5 = partial"),
  latencyMs: z.number().nonnegative(),
  tokenUsage: TokenUsageSchema,
  acceptanceScore: z.number().min(0).max(1).describe("Simulated user acceptance"),
  output: z.string().describe("Raw agent output (the generated SQL or explanation)"),
  error: z.string().optional(),
});
export type BenchmarkResult = z.infer<typeof BenchmarkResultSchema>;

// ── Suite Result ────────────────────────────────────────────────────────────

export const AggregateMetricsSchema = z.object({
  passRate: z.number().min(0).max(1),
  avgQuality: z.number().min(0).max(1),
  avgLatencyMs: z.number().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  avgAcceptance: z.number().min(0).max(1),
});
export type AggregateMetrics = z.infer<typeof AggregateMetricsSchema>;

export const BenchmarkSuiteResultSchema = z.object({
  suiteId: z.string(),
  results: z.array(BenchmarkResultSchema),
  aggregateMetrics: AggregateMetricsSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
});
export type BenchmarkSuiteResult = z.infer<typeof BenchmarkSuiteResultSchema>;

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Compute aggregate metrics from a list of results. */
export function computeAggregate(results: BenchmarkResult[]): AggregateMetrics {
  if (results.length === 0) {
    return { passRate: 0, avgQuality: 0, avgLatencyMs: 0, totalTokens: 0, avgAcceptance: 0 };
  }
  const passed = results.filter((r) => r.passed).length;
  const totalLatency = results.reduce((s, r) => s + r.latencyMs, 0);
  const totalTokens = results.reduce((s, r) => s + r.tokenUsage.total, 0);
  const totalQuality = results.reduce((s, r) => s + r.quality, 0);
  const totalAcceptance = results.reduce((s, r) => s + r.acceptanceScore, 0);

  return {
    passRate: round2(passed / results.length),
    avgQuality: round2(totalQuality / results.length),
    avgLatencyMs: round2(totalLatency / results.length),
    totalTokens,
    avgAcceptance: round2(totalAcceptance / results.length),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
