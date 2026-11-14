/**
 * Phase 9 — Benchmark Evaluator.
 *
 * Runs a suite of benchmark tasks against two environments:
 *   1. Baseline: single LLM call via Provider.chat()
 *   2. Maximilian: dynamic team via DAGS.compose() + AgentRuntime
 *
 * Supports 3 domains: database, devops, frontend.
 * Captures 4 key metrics per task: Quality, Latency, Cost, Acceptance.
 * All execution is real — no mocks.
 *
 * Validator layer (borrowing MiniMax-Provider-Verifier verify.py): after
 * the runner produces a per-case result, the case's validators run and
 * their fields merge into `result.validatorFields`; the error-only-
 * reasoning check runs ALWAYS (verify.py:105-125,393-395). Suite-level
 * validator summaries merge into `aggregateMetrics` (first-class fields)
 * and `validatorSummaries` (full dump).
 *
 * Incremental rerun (verify.py:27-30,432-477): with `persistPath` set,
 * successful cases are skipped by stable request hash, only failed/new
 * cases are sent, and results are written back sorted by data_index with
 * the summary recomputed. Without `persistPath` behaviour is unchanged.
 */

import { randomUUID } from "node:crypto"
import type { Provider } from "@max/providers"
import type { DAGS } from "@max/dags"
import { DatabaseRunner } from "./runners/database-runner.js"
import { DevOpsRunner } from "./runners/devops-runner.js"
import { FrontendRunner } from "./runners/frontend-runner.js"
import {
  computeAggregate,
  type AggregateMetrics,
  type BenchmarkTask,
  type BenchmarkResult,
  type BenchmarkSuiteResult,
  type TokenUsage,
  type DatabaseTaskContext,
  type DevOpsTaskContext,
  type FrontendTaskContext,
} from "./types.js"
import { ValidatorRegistry } from "./validators/registry.js"
import { ToolCallsValidator } from "./validators/tool-calls.js"
import { isErrorOnlyReasoning } from "./validators/error-only-reasoning.js"
import { extractMessageFromRaw } from "./validators/protocol.js"
import type {
  CaseValidator,
  ToolDefinition,
  ValidatorCaseContext,
  ValidatorCaseRun,
  ValidatorFields,
} from "./validators/types.js"
import {
  loadPersistedResults,
  prepareBenchmarkRequest,
  saveResultsJsonl,
  stableHash,
} from "./persistence.js"

export interface EvaluatorDeps {
  provider: Provider
  dags: DAGS
  dbRunner?: DatabaseRunner
  devopsRunner?: DevOpsRunner
  frontendRunner?: FrontendRunner
  /**
   * Per-case validators (verify.py VALIDATOR_REGISTRY dispatch). Default:
   * [ToolCallsValidator]; an explicit empty array disables validators.
   */
  validators?: readonly CaseValidator[]
  /**
   * Results JSONL path for incremental reruns. Unset → no persistence,
   * behaviour unchanged (every case runs).
   */
  persistPath?: string
  /** Warning sink for unknown check types / validator failures. */
  onValidatorWarning?: (message: string) => void
}

export class BenchmarkEvaluator {
  private dbRunner: DatabaseRunner
  private devopsRunner: DevOpsRunner
  private frontendRunner: FrontendRunner
  private registry: ValidatorRegistry

  constructor(private deps: EvaluatorDeps) {
    this.dbRunner = deps.dbRunner ?? new DatabaseRunner()
    this.devopsRunner = deps.devopsRunner ?? new DevOpsRunner()
    this.frontendRunner = deps.frontendRunner ?? new FrontendRunner()
    // verify.py:83 — default validator list is [ToolCallsValidator()].
    this.registry = new ValidatorRegistry(...(deps.validators ?? [new ToolCallsValidator()]))
  }

  /**
   * Evaluate a suite of tasks. Returns a full BenchmarkSuiteResult.
   * With `persistPath` wired, runs incrementally against the existing
   * results file (successful cases skipped by request hash).
   */
  async evaluate(tasks: BenchmarkTask[]): Promise<BenchmarkSuiteResult> {
    const suiteId = `suite-${randomUUID().slice(0, 8)}`
    const startedAt = new Date().toISOString()
    const persistPath = this.deps.persistPath

    const existingByHash = new Map<string, BenchmarkResult>()
    if (persistPath) {
      for (const prior of await loadPersistedResults(persistPath)) {
        if (prior.hash) existingByHash.set(prior.hash, prior)
      }
    }

    const results: BenchmarkResult[] = []
    let skippedByHash = 0

    for (let dataIndex = 0; dataIndex < tasks.length; dataIndex++) {
      const task = tasks[dataIndex]!
      const hash = stableHash(
        prepareBenchmarkRequest({
          id: task.id,
          domain: task.domain,
          difficulty: task.difficulty,
          input: task.input,
          context: task.context,
          systemPrompt: getSystemPrompt(task.domain),
          userMessage: buildUserMessage(task),
        }),
      )
      // Skip only SUCCESSFUL prior results (verify.py:452-454); failed and
      // changed (new hash) cases rerun.
      const prior = existingByHash.get(hash)
      if (prior && prior.passed === true && prior.error === undefined) {
        results.push({ ...prior, hash, dataIndex })
        skippedByHash += 1
        continue
      }
      const result = await this.evaluateOne(task)
      results.push({ ...result, hash, dataIndex })
    }

    // verify.py:467 — results are written back sorted by data_index.
    results.sort((a, b) => (a.dataIndex ?? 0) - (b.dataIndex ?? 0))
    if (persistPath) await saveResultsJsonl(persistPath, results)

    const completedAt = new Date().toISOString()
    const { aggregateMetrics, validatorSummaries } = this.summarizeValidators(tasks, results)

    return {
      suiteId,
      results,
      aggregateMetrics,
      startedAt,
      completedAt,
      ...(Object.keys(validatorSummaries).length > 0 ? { validatorSummaries } : {}),
      ...(skippedByHash > 0 ? { skippedByHash } : {}),
    }
  }

  /**
   * Evaluate a single task against baseline.
   */
  async evaluateOne(task: BenchmarkTask): Promise<BenchmarkResult> {
    return this.evaluateBaseline(task)
  }

  /**
   * Baseline path: single LLM call → domain-specific execution → compare.
   */
  async evaluateBaseline(task: BenchmarkTask): Promise<BenchmarkResult> {
    const start = Date.now()

    try {
      // 1. Build domain-specific system prompt.
      const systemPrompt = getSystemPrompt(task.domain)

      // 2. Build user message with context.
      const userMessage = buildUserMessage(task)

      // 3. Call the LLM.
      const response = await this.deps.provider.chat([
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ])

      const latencyMs = Date.now() - start
      const tokenUsage: TokenUsage = {
        prompt: response.usage?.promptTokens ?? 0,
        completion: response.usage?.completionTokens ?? 0,
        total: response.usage?.totalTokens ?? 0,
      }

      // 4. Run domain-specific evaluation.
      const domainResult = await this.evaluateDomain(task, response.content)

      // 5. Run the task's assertion function.
      const assertionPassed = await task.expectedOutputAssertion(response.content)
      const passed = domainResult.quality >= 1.0 && assertionPassed

      const result: BenchmarkResult = {
        taskId: task.id,
        passed,
        quality: domainResult.quality,
        latencyMs,
        tokenUsage,
        acceptanceScore: passed ? 1 : domainResult.quality,
        output: response.content,
        error: domainResult.error ?? (assertionPassed ? undefined : "assertion failed"),
      }

      const rawSlice = extractMessageFromRaw(response.raw)
      return this.finalizeResult(task, result, {
        taskId: task.id,
        status: "success",
        output: response.content,
        finishReason: response.finishReason ?? null,
        expectedToolCall: task.expectedToolCall,
        tools: task.tools as ToolDefinition[] | undefined,
        message: {
          content: response.content,
          reasoningContent: rawSlice?.reasoningContent ?? null,
          toolCalls: rawSlice?.toolCalls ?? null,
        },
      })
    } catch (err) {
      return {
        taskId: task.id,
        passed: false,
        quality: 0,
        latencyMs: Date.now() - start,
        tokenUsage: { prompt: 0, completion: 0, total: 0 },
        acceptanceScore: 0,
        output: "",
        error: err instanceof Error ? err.message : String(err),
        // verify.py:393-395 — the always-on check lands on EVERY result;
        // with no response the check itself is false.
        errorOnlyReasoningChecked: true,
        errorOnlyReasoning: false,
      }
    }
  }

  /**
   * Maximilian path: DAGS.compose() → AgentRuntime.execute() → domain-specific evaluation.
   */
  async evaluateMaximilian(task: BenchmarkTask): Promise<BenchmarkResult> {
    const start = Date.now()

    try {
      // 1. Compose a dynamic team.
      const composed = await this.deps.dags.compose(task.input)
      const factory = this.deps.dags.buildAgentFactory(composed)

      // 2. Build workspace.
      const workspaceId = `ws-bench-${randomUUID().slice(0, 8)}`
      const planId = `plan-bench-${randomUUID().slice(0, 8)}`
      const now = new Date().toISOString()

      const tasks = composed.graph.nodes.map((n) => ({
        id: n.id,
        agentRole: n.role as string,
        description: n.displayName ?? n.role,
        status: "pending" as const,
        dependsOn: n.dependsOn,
      }))

      const workspace = {
        id: workspaceId,
        userRequest: task.input,
        status: "planning" as const,
        plan: {
          id: planId,
          workspaceId,
          userRequest: task.input,
          rationale: `Benchmark team: ${composed.capabilities.join(", ")}`,
          tasks,
          createdAt: now,
        },
        results: [],
        createdAt: now,
        updatedAt: now,
      }

      // 3. Execute with AgentRuntime.
      const { AgentRuntime } = await import("@max/core")
      const sink = {
        saveWorkspace: async () => {},
        loadWorkspace: async () => undefined,
      }
      const runtime = new AgentRuntime(factory as never, sink)
      const final = await runtime.execute(workspace as never)

      const latencyMs = Date.now() - start

      // 4. Collect all output.
      const allOutput = final.results.map((r: { output: string }) => r.output).join("\n")

      // 5. Domain-specific evaluation.
      const domainResult = await this.evaluateDomain(task, allOutput)

      // 6. Run assertion.
      const assertionPassed = await task.expectedOutputAssertion(allOutput)
      const passed = domainResult.quality >= 1.0 && assertionPassed

      const result: BenchmarkResult = {
        taskId: task.id,
        passed,
        quality: domainResult.quality,
        latencyMs,
        tokenUsage: { prompt: 0, completion: 0, total: 0 },
        acceptanceScore: passed ? 1 : domainResult.quality,
        output: allOutput,
        error: domainResult.error ?? (assertionPassed ? undefined : "assertion failed"),
      }

      return this.finalizeResult(task, result, {
        taskId: task.id,
        status: "success",
        output: allOutput,
        finishReason: null,
        expectedToolCall: task.expectedToolCall,
        tools: task.tools as ToolDefinition[] | undefined,
        message: { content: allOutput, reasoningContent: null, toolCalls: null },
      })
    } catch (err) {
      return {
        taskId: task.id,
        passed: false,
        quality: 0,
        latencyMs: Date.now() - start,
        tokenUsage: { prompt: 0, completion: 0, total: 0 },
        acceptanceScore: 0,
        output: "",
        error: err instanceof Error ? err.message : String(err),
        errorOnlyReasoningChecked: true,
        errorOnlyReasoning: false,
      }
    }
  }

  /**
   * Post-runner finalize (verify.py process_request:393-430): the
   * always-on error-only-reasoning check plus the case's validators; the
   * validator fields merge into result.validatorFields.
   */
  private finalizeResult(
    task: BenchmarkTask,
    result: BenchmarkResult,
    ctx: ValidatorCaseContext,
  ): BenchmarkResult {
    result.errorOnlyReasoningChecked = true
    result.errorOnlyReasoning = isErrorOnlyReasoning(ctx.message)

    const fields: Record<string, ValidatorFields> = {}
    for (const validator of this.registry.resolve(task.checkType, {
      onUnknownCheckType: (t) => this.warn(`Unknown check_type: ${t}`),
    })) {
      try {
        fields[validator.name] = validator.validate(ctx)
      } catch (err) {
        this.warn(
          `Validator ${validator.name} failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    if (Object.keys(fields).length > 0) result.validatorFields = fields
    return result
  }

  /**
   * Suite-level validator summaries (verify.py compute_summary:482-557):
   * each validator that produced per-case fields aggregates over all
   * cases (including ones restored from a previous incremental run), and
   * the headline fields hoist into aggregateMetrics. Existing aggregate
   * fields are never rewritten — only added.
   */
  private summarizeValidators(
    tasks: BenchmarkTask[],
    results: BenchmarkResult[],
  ): { aggregateMetrics: AggregateMetrics; validatorSummaries: Record<string, ValidatorFields> } {
    const aggregateMetrics = computeAggregate(results)
    const validatorSummaries: Record<string, ValidatorFields> = {}

    // Collect the validator names actually present on results (verify.py
    // detects used validators by result fields, not by config).
    const usedNames = new Set<string>()
    for (const r of results) {
      for (const name of Object.keys(r.validatorFields ?? {})) usedNames.add(name)
    }

    const taskById = new Map(tasks.map((t) => [t.id, t]))
    for (const name of usedNames) {
      const validator = this.registry.get(name)
      if (!validator) continue // persisted fields from an unknown validator
      const runs: ValidatorCaseRun[] = results.map((r) => ({
        ctx: caseContextFromTaskAndResult(taskById.get(r.taskId), r),
        fields: r.validatorFields?.[name] ?? {},
      }))
      const summary = validator.computeSummary(runs)
      validatorSummaries[name] = summary
      hoistSummary(aggregateMetrics, name, summary)
    }

    return { aggregateMetrics, validatorSummaries }
  }

  private warn(message: string): void {
    const sink = this.deps.onValidatorWarning ?? ((m: string) => console.warn(m))
    sink(message)
  }

  /**
   * Domain-specific evaluation dispatch.
   */
  private async evaluateDomain(
    task: BenchmarkTask,
    agentOutput: string,
  ): Promise<{ quality: number; error?: string }> {
    switch (task.domain) {
      case "database":
        return this.evaluateDatabase(task, agentOutput)
      case "devops":
        return this.evaluateDevOps(task, agentOutput)
      case "frontend":
        return this.evaluateFrontend(task, agentOutput)
      default:
        return { quality: 0, error: `Unknown domain: ${task.domain}` }
    }
  }

  private async evaluateDatabase(
    task: BenchmarkTask,
    agentOutput: string,
  ): Promise<{ quality: number; error?: string }> {
    const ctx = task.context as DatabaseTaskContext
    const sql = extractSql(agentOutput)

    if (!sql) {
      return { quality: 0, error: "No SQL found in agent response" }
    }

    const agentResult = this.dbRunner.executeSql(sql, task.context)
    const { quality } = this.dbRunner.compareResults(agentResult, ctx.goldResult)

    return { quality, error: agentResult.error }
  }

  private async evaluateDevOps(
    task: BenchmarkTask,
    agentOutput: string,
  ): Promise<{ quality: number; error?: string }> {
    const ctx = task.context as DevOpsTaskContext
    const script = extractScript(agentOutput)

    if (!script) {
      return { quality: 0, error: "No bash script found in agent response" }
    }

    const result = this.devopsRunner.executeScript(script, ctx)
    return { quality: result.quality, error: result.error }
  }

  private async evaluateFrontend(
    task: BenchmarkTask,
    agentOutput: string,
  ): Promise<{ quality: number; error?: string }> {
    const ctx = task.context as FrontendTaskContext
    const code = extractCode(agentOutput)

    if (!code) {
      return { quality: 0, error: "No component code found in agent response" }
    }

    const result = this.frontendRunner.validateComponent(code, ctx)
    return { quality: result.quality, error: result.error }
  }
}

// ── Validator summary helpers ───────────────────────────────────────────────

/**
 * Rebuild enough of a case context from (task, persisted result) for
 * suite-level computeSummary runs — the validators' summaries read the
 * label (expectedToolCall), the request status and the fields their own
 * validate() pass produced (which survive persistence).
 */
function caseContextFromTaskAndResult(
  task: BenchmarkTask | undefined,
  result: BenchmarkResult,
): ValidatorCaseContext {
  const toolCallsFields = result.validatorFields?.["tool_calls"]
  const finishReason =
    toolCallsFields && typeof toolCallsFields["toolCallsFinishReason"] === "string"
      ? (toolCallsFields["toolCallsFinishReason"] as string)
      : null
  return {
    taskId: result.taskId,
    status: result.error !== undefined ? "failed" : "success",
    output: result.output,
    finishReason,
    expectedToolCall: task?.expectedToolCall,
    tools: task?.tools as ToolDefinition[] | undefined,
    message: undefined,
  }
}

/**
 * Hoist a validator's summary into the first-class aggregate fields.
 * Only ADDS keys — existing passRate/quality/etc. are the compatibility
 * surface and are never rewritten.
 */
function hoistSummary(
  aggregate: AggregateMetrics,
  validatorName: string,
  summary: ValidatorFields,
): void {
  const num = (key: string): number | undefined => {
    const v = summary[key]
    return typeof v === "number" ? v : undefined
  }
  const rec = (key: string): Record<string, number> | undefined => {
    const v = summary[key]
    if (typeof v !== "object" || v === null) return undefined
    return v as Record<string, number>
  }

  if (validatorName === "tool_calls") {
    const tp = num("toolCallsTp")
    const fn = num("toolCallsFn")
    const fp = num("toolCallsFp")
    const tn = num("toolCallsTn")
    const labeled = num("expectedToolCallTotalCount")
    const triggered = num("toolCallsTriggeredCount")
    if (tp !== undefined) aggregate.toolCallsTp = tp
    if (fn !== undefined) aggregate.toolCallsFn = fn
    if (fp !== undefined) aggregate.toolCallsFp = fp
    if (tn !== undefined) aggregate.toolCallsTn = tn
    if (labeled !== undefined && labeled > 0) aggregate.expectedToolCallTotalCount = labeled
    const matchRate = num("toolCallsMatchRate")
    if (matchRate !== undefined) aggregate.toolCallsMatchRate = matchRate
    const schemaAccuracy = num("toolCallsSchemaAccuracy")
    if (schemaAccuracy !== undefined) aggregate.toolCallsSchemaAccuracy = schemaAccuracy
    if (triggered !== undefined) aggregate.toolCallsTriggeredCount = triggered
    const dist = rec("toolCallsCountDistribution")
    if (dist) aggregate.toolCallsCountDistribution = dist
    const others = rec("toolCallsFinishOthersDetail")
    if (others) aggregate.toolCallsFinishOthersDetail = others
  }

  if (validatorName === "scenario_check") {
    const checked = num("scenarioCheckCheckedCount")
    const valid = num("scenarioCheckValidCount")
    const invalid = num("scenarioCheckInvalidCount")
    const passRate = num("scenarioCheckPassRate")
    if (checked !== undefined && checked > 0) aggregate.scenarioCheckCheckedCount = checked
    if (valid !== undefined && checked !== undefined && checked > 0)
      aggregate.scenarioCheckValidCount = valid
    if (invalid !== undefined && checked !== undefined && checked > 0)
      aggregate.scenarioCheckInvalidCount = invalid
    if (passRate !== undefined) aggregate.scenarioCheckPassRate = passRate
  }
}

// ── Extraction Helpers ───────────────────────────────────────────────────────

function getSystemPrompt(domain: string): string {
  switch (domain) {
    case "database":
      return "You are a database expert. Given a SQL problem, output ONLY the SQL query inside a ```sql code block. No explanation."
    case "devops":
      return "You are a DevOps engineer. Given a task, output ONLY the bash script inside a ```bash code block. The script must be self-contained and executable. No explanation."
    case "frontend":
      return "You are a frontend engineer. Given a component specification, output ONLY the React component code inside a ```tsx code block. The component must be complete and self-contained. No explanation."
    default:
      return "Complete the task. Output your solution in a code block."
  }
}

function buildUserMessage(task: BenchmarkTask): string {
  const ctxEntries = Object.entries(task.context)
    .filter(([key]) => key !== "expectedOutputAssertion")
    .map(([key, value]) => {
      const formatted = typeof value === "string" ? value : JSON.stringify(value, null, 2)
      return `## ${key}\n${formatted}`
    })
    .join("\n\n")

  return `${task.input}\n\n${ctxEntries}`
}

function extractSql(output: string): string | null {
  const sqlBlockMatch = output.match(/```sql\s*\n([\s\S]*?)```/)
  if (sqlBlockMatch?.[1]) return sqlBlockMatch[1].trim()

  const anyBlockMatch = output.match(/```\w*\s*\n([\s\S]*?)```/)
  if (anyBlockMatch?.[1]) return anyBlockMatch[1].trim()

  const bareSqlMatch = output.match(
    /((?:WITH|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\s[\s\S]*?);/i,
  )
  if (bareSqlMatch?.[1]) return bareSqlMatch[1].trim()

  return null
}

function extractScript(output: string): string | null {
  const bashBlockMatch = output.match(/```(?:bash|sh|shell)\s*\n([\s\S]*?)```/)
  if (bashBlockMatch?.[1]) return bashBlockMatch[1].trim()

  const anyBlockMatch = output.match(/```\w*\s*\n([\s\S]*?)```/)
  if (anyBlockMatch?.[1]) return anyBlockMatch[1].trim()

  return null
}

function extractCode(output: string): string | null {
  const tsxBlockMatch = output.match(/```(?:tsx|jsx|typescript|ts|react)\s*\n([\s\S]*?)```/)
  if (tsxBlockMatch?.[1]) return tsxBlockMatch[1].trim()

  const anyBlockMatch = output.match(/```\w*\s*\n([\s\S]*?)```/)
  if (anyBlockMatch?.[1]) return anyBlockMatch[1].trim()

  return null
}
