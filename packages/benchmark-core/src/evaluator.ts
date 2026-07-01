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
 */

import { randomUUID } from "node:crypto";
import type { Provider } from "@max/providers";
import type { DAGS } from "@max/dags";
import { DatabaseRunner } from "./runners/database-runner.js";
import { DevOpsRunner } from "./runners/devops-runner.js";
import { FrontendRunner } from "./runners/frontend-runner.js";
import {
  computeAggregate,
  type BenchmarkTask,
  type BenchmarkResult,
  type BenchmarkSuiteResult,
  type TokenUsage,
  type DatabaseTaskContext,
  type DevOpsTaskContext,
  type FrontendTaskContext,
} from "./types.js";

export interface EvaluatorDeps {
  provider: Provider;
  dags: DAGS;
  dbRunner?: DatabaseRunner;
  devopsRunner?: DevOpsRunner;
  frontendRunner?: FrontendRunner;
}

export class BenchmarkEvaluator {
  private dbRunner: DatabaseRunner;
  private devopsRunner: DevOpsRunner;
  private frontendRunner: FrontendRunner;

  constructor(private deps: EvaluatorDeps) {
    this.dbRunner = deps.dbRunner ?? new DatabaseRunner();
    this.devopsRunner = deps.devopsRunner ?? new DevOpsRunner();
    this.frontendRunner = deps.frontendRunner ?? new FrontendRunner();
  }

  /**
   * Evaluate a suite of tasks. Returns a full BenchmarkSuiteResult.
   */
  async evaluate(tasks: BenchmarkTask[]): Promise<BenchmarkSuiteResult> {
    const suiteId = `suite-${randomUUID().slice(0, 8)}`;
    const startedAt = new Date().toISOString();
    const results: BenchmarkResult[] = [];

    for (const task of tasks) {
      const result = await this.evaluateOne(task);
      results.push(result);
    }

    const completedAt = new Date().toISOString();

    return {
      suiteId,
      results,
      aggregateMetrics: computeAggregate(results),
      startedAt,
      completedAt,
    };
  }

  /**
   * Evaluate a single task against baseline.
   */
  async evaluateOne(task: BenchmarkTask): Promise<BenchmarkResult> {
    return this.evaluateBaseline(task);
  }

  /**
   * Baseline path: single LLM call → domain-specific execution → compare.
   */
  async evaluateBaseline(task: BenchmarkTask): Promise<BenchmarkResult> {
    const start = Date.now();

    try {
      // 1. Build domain-specific system prompt.
      const systemPrompt = getSystemPrompt(task.domain);

      // 2. Build user message with context.
      const userMessage = buildUserMessage(task);

      // 3. Call the LLM.
      const response = await this.deps.provider.chat([
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ]);

      const latencyMs = Date.now() - start;
      const tokenUsage: TokenUsage = {
        prompt: response.usage?.promptTokens ?? 0,
        completion: response.usage?.completionTokens ?? 0,
        total: response.usage?.totalTokens ?? 0,
      };

      // 4. Run domain-specific evaluation.
      const domainResult = await this.evaluateDomain(task, response.content);

      // 5. Run the task's assertion function.
      const assertionPassed = await task.expectedOutputAssertion(response.content);
      const passed = domainResult.quality >= 1.0 && assertionPassed;

      return {
        taskId: task.id,
        passed,
        quality: domainResult.quality,
        latencyMs,
        tokenUsage,
        acceptanceScore: passed ? 1 : domainResult.quality,
        output: response.content,
        error: domainResult.error ?? (assertionPassed ? undefined : "assertion failed"),
      };
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
      };
    }
  }

  /**
   * Maximilian path: DAGS.compose() → AgentRuntime.execute() → domain-specific evaluation.
   */
  async evaluateMaximilian(task: BenchmarkTask): Promise<BenchmarkResult> {
    const start = Date.now();

    try {
      // 1. Compose a dynamic team.
      const composed = await this.deps.dags.compose(task.input);
      const factory = this.deps.dags.buildAgentFactory(composed);

      // 2. Build workspace.
      const workspaceId = `ws-bench-${randomUUID().slice(0, 8)}`;
      const planId = `plan-bench-${randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();

      const tasks = composed.graph.nodes.map((n) => ({
        id: n.id,
        agentRole: n.role as string,
        description: n.displayName ?? n.role,
        status: "pending" as const,
        dependsOn: n.dependsOn,
      }));

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
      };

      // 3. Execute with AgentRuntime.
      const { AgentRuntime } = await import("@max/core");
      const sink = {
        saveWorkspace: async () => {},
        loadWorkspace: async () => undefined,
      };
      const runtime = new AgentRuntime(factory as never, sink);
      const final = await runtime.execute(workspace as never);

      const latencyMs = Date.now() - start;

      // 4. Collect all output.
      const allOutput = final.results.map((r: { output: string }) => r.output).join("\n");

      // 5. Domain-specific evaluation.
      const domainResult = await this.evaluateDomain(task, allOutput);

      // 6. Run assertion.
      const assertionPassed = await task.expectedOutputAssertion(allOutput);
      const passed = domainResult.quality >= 1.0 && assertionPassed;

      return {
        taskId: task.id,
        passed,
        quality: domainResult.quality,
        latencyMs,
        tokenUsage: { prompt: 0, completion: 0, total: 0 },
        acceptanceScore: passed ? 1 : domainResult.quality,
        output: allOutput,
        error: domainResult.error ?? (assertionPassed ? undefined : "assertion failed"),
      };
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
      };
    }
  }

  /**
   * Domain-specific evaluation dispatch.
   */
  private async evaluateDomain(
    task: BenchmarkTask,
    agentOutput: string
  ): Promise<{ quality: number; error?: string }> {
    switch (task.domain) {
      case "database":
        return this.evaluateDatabase(task, agentOutput);
      case "devops":
        return this.evaluateDevOps(task, agentOutput);
      case "frontend":
        return this.evaluateFrontend(task, agentOutput);
      default:
        return { quality: 0, error: `Unknown domain: ${task.domain}` };
    }
  }

  private async evaluateDatabase(
    task: BenchmarkTask,
    agentOutput: string
  ): Promise<{ quality: number; error?: string }> {
    const ctx = task.context as DatabaseTaskContext;
    const sql = extractSql(agentOutput);

    if (!sql) {
      return { quality: 0, error: "No SQL found in agent response" };
    }

    const agentResult = this.dbRunner.executeSql(sql, task.context);
    const { quality } = this.dbRunner.compareResults(agentResult, ctx.goldResult);

    return { quality, error: agentResult.error };
  }

  private async evaluateDevOps(
    task: BenchmarkTask,
    agentOutput: string
  ): Promise<{ quality: number; error?: string }> {
    const ctx = task.context as DevOpsTaskContext;
    const script = extractScript(agentOutput);

    if (!script) {
      return { quality: 0, error: "No bash script found in agent response" };
    }

    const result = this.devopsRunner.executeScript(script, ctx);
    return { quality: result.quality, error: result.error };
  }

  private async evaluateFrontend(
    task: BenchmarkTask,
    agentOutput: string
  ): Promise<{ quality: number; error?: string }> {
    const ctx = task.context as FrontendTaskContext;
    const code = extractCode(agentOutput);

    if (!code) {
      return { quality: 0, error: "No component code found in agent response" };
    }

    const result = this.frontendRunner.validateComponent(code, ctx);
    return { quality: result.quality, error: result.error };
  }
}

// ── Extraction Helpers ───────────────────────────────────────────────────────

function getSystemPrompt(domain: string): string {
  switch (domain) {
    case "database":
      return "You are a database expert. Given a SQL problem, output ONLY the SQL query inside a ```sql code block. No explanation.";
    case "devops":
      return "You are a DevOps engineer. Given a task, output ONLY the bash script inside a ```bash code block. The script must be self-contained and executable. No explanation.";
    case "frontend":
      return "You are a frontend engineer. Given a component specification, output ONLY the React component code inside a ```tsx code block. The component must be complete and self-contained. No explanation.";
    default:
      return "Complete the task. Output your solution in a code block.";
  }
}

function buildUserMessage(task: BenchmarkTask): string {
  const ctxEntries = Object.entries(task.context)
    .filter(([key]) => key !== "expectedOutputAssertion")
    .map(([key, value]) => {
      const formatted = typeof value === "string" ? value : JSON.stringify(value, null, 2);
      return `## ${key}\n${formatted}`;
    })
    .join("\n\n");

  return `${task.input}\n\n${ctxEntries}`;
}

function extractSql(output: string): string | null {
  const sqlBlockMatch = output.match(/```sql\s*\n([\s\S]*?)```/);
  if (sqlBlockMatch?.[1]) return sqlBlockMatch[1].trim();

  const anyBlockMatch = output.match(/```\w*\s*\n([\s\S]*?)```/);
  if (anyBlockMatch?.[1]) return anyBlockMatch[1].trim();

  const bareSqlMatch = output.match(/((?:WITH|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\s[\s\S]*?);/i);
  if (bareSqlMatch?.[1]) return bareSqlMatch[1].trim();

  return null;
}

function extractScript(output: string): string | null {
  const bashBlockMatch = output.match(/```(?:bash|sh|shell)\s*\n([\s\S]*?)```/);
  if (bashBlockMatch?.[1]) return bashBlockMatch[1].trim();

  const anyBlockMatch = output.match(/```\w*\s*\n([\s\S]*?)```/);
  if (anyBlockMatch?.[1]) return anyBlockMatch[1].trim();

  return null;
}

function extractCode(output: string): string | null {
  const tsxBlockMatch = output.match(/```(?:tsx|jsx|typescript|ts|react)\s*\n([\s\S]*?)```/);
  if (tsxBlockMatch?.[1]) return tsxBlockMatch[1].trim();

  const anyBlockMatch = output.match(/```\w*\s*\n([\s\S]*?)```/);
  if (anyBlockMatch?.[1]) return anyBlockMatch[1].trim();

  return null;
}
