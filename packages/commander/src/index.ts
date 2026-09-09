/**
 * Commander.
 *
 * Responsibilities:
 *   1. Receive a user request.
 *   2. Call a planner LLM to decompose the request into a Plan of Tasks.
 *   3. Always append a final Review task to gate output quality.
 *   4. Return a Plan object (the Runtime will execute it).
 *
 * MVP behavior:
 *   - Single LLM call for planning.
 *   - Default flow: backend → frontend → review.
 *   - Falls back to a hard-coded plan if the LLM JSON is malformed.
 */

import { randomUUID } from "node:crypto"
import type { Provider, ChatMessage } from "@max/providers"
import {
  type AgentRole,
  type Plan,
  type Result,
  type Task,
  type Workspace,
  reviewPlan as coreReviewPlan,
  type PlanReview as CorePlanReview,
} from "@max/core"
import { getLogger } from "@max/telemetry"

const log = getLogger("commander")

/** Timeout for LLM calls in milliseconds. */
const LLM_TIMEOUT_MS = 60_000

/**
 * Plan-shape accepted by the core PlanReviewer. objective + the per-task
 * fields the heuristic scorers inspect. id/dependsOn MUST be forwarded:
 * the feasibility scorer reads dependsOn (via a cast) to run Kahn's
 * cycle detection — stripping it silently disables that check.
 */
interface PlanLikeForReviewer {
  objective?: string
  tasks?: Array<{
    id?: string
    dependsOn?: string[]
    agentRole?: string
    description?: string
    type?: string
  }>
}

/**
 * Adapter that maps Commander's `Plan` to the shape the core reviewer
 * expects. The reviewer mutates only its local `tasks` array — passing
 * a fresh projected view keeps Commander's actual plan untouched.
 */
function defaultCoreReviewer(plan: PlanLikeForReviewer): CorePlanReview {
  return coreReviewPlan(plan)
}

/**
 * Sanitize user input to prevent prompt injection attacks.
 * Escapes backticks and template syntax to prevent breaking prompt formatting.
 */
function sanitizeUserInput(input: string): string {
  return input.replace(/\r\n/g, "\n").replace(/`/g, "\\`").replace(/\${/g, "\\${").slice(0, 10_000)
}

/**
 * Port for model selection. Mirrors ModelSelector from @max/evolution.
 */
export interface ModelSelectorPort {
  select(role: AgentRole): { provider: string; model: string; score: number; reason: string } | null
}

const PLANNER_SYSTEM_PROMPT = `You are the Commander (planner) of a multi-agent system.

Given a user request, decompose it into a sequence of tasks. Each task must be
assigned to one of these roles based on the agent's declared capabilities.

## Available agents and their capabilities

- "backend": server-side code generation.
  Strengths: REST APIs, DB schemas, auth, business logic, migrations, integrations.
  Use for: any server-side / API / database request.
- "frontend": client-side code generation.
  Strengths: HTML/CSS/JS, UI components, single-file demos, browser interaction.
  Use for: any UI / page / user-facing request.
- "general": anything else (configs, docs, scripts, plain text).
  Default fallback when neither backend nor frontend clearly fits.
- "review": critique-only; reviews all prior outputs and returns a JSON verdict.
  ALWAYS last; depends on every prior task.

## Task fields

For each task, output:
- "agentRole": one of "backend" | "frontend" | "general" (review is appended automatically if missing)
- "description": self-contained task description (the agent sees only its own description + prior results)
- "dependsOn": array of task-ids this task depends on (empty if no dependency)
- "estimatedComplexity": "simple" | "medium" | "complex"
  - simple: a one-line change, rename, trivial fix (< 80 chars description OR explicit keywords like "fix typo", "rename")
  - complex: refactor, migration, performance, security, architecture (> 500 chars OR keywords like "refactor", "migrate", "design system")
  - medium: anything in between
- "preferredCapabilities": array of capability tags this task needs (free-form strings drawn from the agent's strength list above; e.g. ["api-design", "auth"], ["ui-rendering"], ["docs"])
- "ownedFiles" (optional): array of file paths this task exclusively owns (借鉴 parallel-feature-development). When set, no other task should modify these files.
- "condition" (optional): a string describing what state must be true before this task runs (借鉴 autogen DiGraph condition). The condition is checked by the runtime against prior task outputs.

Also output a top-level "tracks" field (optional): array of track objects describing phased work (借鉴 conductor tracks.md):
- "id": unique track identifier
- "name": display name
- "description": what this track covers
- "phases": array of phase names/descriptions

Always end with a "review" task that depends on all prior tasks (the runtime appends it automatically if missing).

Output MUST be a single JSON object (no markdown fences) with this exact shape:
{
  "rationale": "<one paragraph explaining the plan and why these capabilities/agents fit>",
  "tasks": [
    {
      "agentRole": "backend" | "frontend" | "general",
      "description": "<clear, actionable task description>",
      "dependsOn": ["<task-id>"],
      "estimatedComplexity": "simple" | "medium" | "complex",
      "preferredCapabilities": ["<capability-tag>", ...]
    },
    ...
  ]
}

Rules:
1. 1 to 5 production tasks maximum (excluding review).
2. Each task description is self-contained.
3. Match each task's agentRole to the agent whose declared capability best fits the task.
4. The "preferredCapabilities" tags should describe what kind of work the task needs (drawn from the agent's strength list, e.g. ["api-design"], ["ui-rendering"]).
5. The "estimatedComplexity" guides model selection — be honest about task difficulty.
6. For a typical "build a Todo web app" request: 1 backend + 1 frontend + 1 review.
7. For pure-doc requests: 1 general + 1 review.
`

export interface PlannerOutput {
  rationale: string
  tasks: Array<{
    agentRole: AgentRole
    description: string
    dependsOn: string[]
    estimatedComplexity?: "simple" | "medium" | "complex"
    preferredCapabilities?: string[]
    /** (借鉴 parallel-feature-development) Exclusive file ownership. */
    ownedFiles?: string[]
    /** (借鉴 autogen DiGraph) Condition string checked against prior results. */
    condition?: string
  }>
  /**
   * (借鉴 conductor tracks.md) Optional phase/track metadata for the plan.
   * Each track represents a logical phase of work with its own phases.
   */
  tracks?: Array<{
    id: string
    name: string
    description: string
    phases: string[]
  }>
}

/**
 * Output of `Commander.replan`. Same shape as `PlannerOutput` but
 * `rationale` is optional (replans often have short justifications).
 */
export interface ReplanOutput {
  rationale?: string
  tasks: Array<{
    agentRole: AgentRole
    description: string
    dependsOn: string[]
    estimatedComplexity?: "simple" | "medium" | "complex"
    preferredCapabilities?: string[]
    ownedFiles?: string[]
    condition?: string
  }>
}

const REPLANNER_SYSTEM_PROMPT = `You are the Commander re-planner of a multi-agent system.

The original plan has stalled — some tasks completed but the system has been
idle for several rounds with no progress on the remaining tasks. Your job is
to revise ONLY the remaining tasks so the system can move forward.

Inputs:
- The original user request
- The list of completed results (each has agentRole + truncated output)
- The list of remaining tasks that have NOT started or completed

Output a JSON object with the new set of remaining tasks (replacement list,
NOT a continuation — the runtime will replace the pending list with whatever
you return). Keep the same task id scheme ("task-N") for tasks you're
re-using, and use "task-N+" for new tasks if you want to add more.

For each task, output:
- "agentRole": "backend" | "frontend" | "general" | "review"
- "description": self-contained task description
- "dependsOn": array of existing task-ids (completed or other remaining) this task depends on
- "estimatedComplexity": "simple" | "medium" | "complex"
- "preferredCapabilities": array of capability tags

Strategies for unblocking a stall:
1. Break a stalled task into smaller sub-tasks (e.g. "implement X" → "design X interface" + "implement X function").
2. Switch the agent role if the work doesn't match the original assignment.
3. Add a clarifying intermediate task that produces a concrete artifact the next task can consume.
4. If a task seems already-done by an earlier result, drop it.

Output MUST be a single JSON object:
{
  "rationale": "<one paragraph explaining the replan>",
  "tasks": [ { ... }, ... ]
}

Rules:
1. Output ONLY remaining tasks (do not duplicate completed work).
2. Keep the same set of agent capabilities as the original plan (don't invent new roles).
3. If you can't see a clear path forward, return the original remaining tasks unchanged.
`

export class Commander {
  private providerRegistry?: Map<string, Provider>
  private modelSelector?: ModelSelectorPort
  /**
   * Optional PlanReviewer (借鉴 Kosmos plan_reviewer.py). When provided,
   * every `plan()` call routes the materialized plan through the reviewer's
   * `reviewPlan()` and stashes the verdict on `workspace.metadata.planReview`
   * so the runtime (or a downstream gate) can decide whether to execute.
   *
   * Defaults to the core heuristic reviewer imported from `@max/core`
   * (5-dimension scoring: specificity / relevance / novelty / coverage /
   * feasibility — borrows Kosmos's thresholds). Pass `null` explicitly to
   * disable review entirely.
   */
  private readonly planReviewer: ((plan: PlanLikeForReviewer) => CorePlanReview) | null

  /**
   * Provider getter — supports runtime default-provider changes.
   * Pass `() => registry.default()!` (or any function returning the current
   * Provider) so planning reflects the live default, not a stale snapshot
   * captured at Commander construction time.
   */
  constructor(
    private getProvider: () => Provider,
    options?: {
      providerRegistry?: Map<string, Provider>
      modelSelector?: ModelSelectorPort
      /**
       * Override the default PlanReviewer. Pass a function to swap in a
       * custom scorer (e.g. LLM-judge) or `null` to skip review entirely.
       */
      planReviewer?: ((plan: PlanLikeForReviewer) => CorePlanReview) | null
    },
  ) {
    this.providerRegistry = options?.providerRegistry
    this.modelSelector = options?.modelSelector
    if (options && Object.prototype.hasOwnProperty.call(options, "planReviewer")) {
      this.planReviewer = options.planReviewer ?? null
    } else {
      this.planReviewer = defaultCoreReviewer
    }
  }

  /**
   * Resolve the best provider for planning.
   * Uses model selector if available, otherwise falls back to default.
   */
  private resolveProvider(): Provider {
    if (this.modelSelector) {
      const selection = this.modelSelector.select("general")
      if (selection && this.providerRegistry) {
        const preferred = this.providerRegistry.get(selection.provider)
        if (preferred) return preferred
      }
    }
    return this.getProvider()
  }

  /**
   * Create a new workspace for a user request and produce an initial Plan.
   */
  async plan(userRequest: string): Promise<{ workspace: Workspace; plan: Plan }> {
    const workspaceId = `ws-${randomUUID().slice(0, 8)}`
    const planId = `plan-${randomUUID().slice(0, 8)}`
    const now = new Date().toISOString()

    let planner: PlannerOutput
    try {
      planner = await this.callPlanner(userRequest)
    } catch (err) {
      log.warn({ err }, "planner LLM failed, falling back to default plan")
      planner = defaultPlan(userRequest)
    }

    // Materialize task ids in deterministic order.
    const tasks: Task[] = planner.tasks.map((t, i) => {
      const metadata: Record<string, unknown> = {}
      if (t.estimatedComplexity) metadata.estimatedComplexity = t.estimatedComplexity
      if (t.preferredCapabilities && t.preferredCapabilities.length > 0) {
        metadata.preferredCapabilities = t.preferredCapabilities
      }
      if (t.ownedFiles && t.ownedFiles.length > 0) {
        metadata.ownedFiles = t.ownedFiles
      }
      if (t.condition) {
        metadata.condition = t.condition
      }
      return {
        id: `task-${i + 1}`,
        agentRole: t.agentRole,
        description: t.description,
        status: "pending" as const,
        dependsOn: t.dependsOn,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      }
    })

    const planMeta: Record<string, unknown> = {}
    if (planner.tracks && planner.tracks.length > 0) {
      planMeta.tracks = planner.tracks
    }

    const plan: Plan = {
      id: planId,
      workspaceId,
      userRequest,
      rationale: planner.rationale,
      tasks,
      createdAt: now,
      ...(Object.keys(planMeta).length > 0 ? { metadata: planMeta } : {}),
    }

    // PlanReviewer (借鉴 Kosmos plan_reviewer.py): run the 5-dimension
    // review on the materialized plan. The verdict is stashed on the
    // workspace's metadata so the runtime can decide whether to execute
    // (rejected plans can still be inspected — we don't throw). When the
    // Commander is configured with `planReviewer: null`, this is skipped
    // entirely (back-compat for callers that want to opt out).
    let planReview: CorePlanReview | undefined
    if (this.planReviewer) {
      try {
        planReview = this.planReviewer({
          objective: userRequest,
          tasks: tasks.map((t) => ({
            id: t.id,
            dependsOn: t.dependsOn,
            agentRole: t.agentRole,
            description: t.description,
            type: (t.metadata?.type as string | undefined) ?? undefined,
          })),
        })
        log.info(
          {
            planId,
            approved: planReview.approved,
            averageScore: planReview.averageScore,
            minScore: planReview.minScore,
          },
          "plan reviewed",
        )
      } catch (err) {
        // Reviewer must never block planning — log and continue with the
        // plan as-is. Without this guard, a buggy reviewer would prevent
        // the runtime from ever executing.
        log.warn({ err, planId }, "planReviewer threw — proceeding without review")
      }
    }

    const workspaceMeta: Record<string, unknown> = planReview ? { planReview } : {}

    const workspace: Workspace = {
      id: workspaceId,
      userRequest,
      status: "planning",
      plan,
      results: [],
      createdAt: now,
      updatedAt: now,
      metadata: workspaceMeta,
    }

    return { workspace, plan }
  }

  /**
   * Preflight validation (借鉴 wshobson agents Pre-flight Checks).
   * Returns an array of warnings/errors about the plan before execution.
   * Empty array = all clear. Callers should surface non-empty warnings
   * to the user or abort execution.
   *
   * Checks:
   * - Plan has at least one task
   * - Plan includes a review task
   * - No task has an invalid dependsOn reference
   * - ownedFiles assignments are disjoint (no two tasks own the same file)
   * - All condition strings are non-empty
   */
  preflight(plan: Plan): string[] {
    const warnings: string[] = []

    if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) {
      warnings.push("Plan has no tasks")
      return warnings
    }

    // Check for review task.
    if (!plan.tasks.some((t) => t.agentRole === "review")) {
      warnings.push("Plan is missing a review task")
    }

    // Check dependsOn references.
    const taskIds = new Set(plan.tasks.map((t) => t.id))
    for (const t of plan.tasks) {
      for (const dep of t.dependsOn) {
        if (!taskIds.has(dep)) {
          warnings.push(`Task "${t.id}" depends on unknown task "${dep}"`)
        }
      }
    }

    // Check for overlapping file ownership (借鉴 parallel-feature-development).
    const fileOwner = new Map<string, string>()
    for (const t of plan.tasks) {
      const files = t.metadata?.ownedFiles as string[] | undefined
      if (files) {
        for (const f of files) {
          const existing = fileOwner.get(f)
          if (existing && existing !== t.id) {
            warnings.push(
              `File "${f}" is owned by both "${existing}" and "${t.id}" — disjoint ownership violated`,
            )
          }
          fileOwner.set(f, t.id)
        }
      }
    }

    return warnings
  }

  private async callPlanner(userRequest: string): Promise<PlannerOutput> {
    const provider = this.resolveProvider()
    const sanitizedRequest = sanitizeUserInput(userRequest)
    const messages: ChatMessage[] = [
      { role: "system", content: PLANNER_SYSTEM_PROMPT },
      { role: "user", content: sanitizedRequest },
    ]
    const response = await Promise.race([
      provider.chat(messages, {
        temperature: 0.3,
        maxTokens: 1500,
        jsonMode: true,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Planner LLM call timed out")), LLM_TIMEOUT_MS),
      ),
    ])

    const raw = response.content
    const json = extractJson(raw)
    if (!json) throw new Error("Planner produced no JSON")
    const parsed = JSON.parse(json) as PlannerOutput

    if (typeof parsed.rationale !== "string") parsed.rationale = "No rationale provided"

    if (!parsed.tasks || !Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
      throw new Error("Planner JSON missing 'tasks'")
    }

    // Validate that last task is a review.
    const lastIndex = parsed.tasks.length - 1
    const last = parsed.tasks[lastIndex]
    if (!last || last.agentRole !== "review") {
      // Build dependsOn using actual task IDs that will be assigned (task-1, task-2, ...)
      const reviewDependsOn = parsed.tasks.map((_, i) => `task-${i + 1}`)
      parsed.tasks.push({
        agentRole: "review",
        description: "Review all generated artifacts",
        dependsOn: reviewDependsOn,
      })
    }

    return parsed
  }

  /**
   * Re-plan the remaining tasks after a stall.
   *
   * Mirrors Magentic-One's outer-loop: when the Orchestrator observes that
   * progress has stopped, it re-writes the Task Ledger. Here we ask an LLM
   * to revise the remaining task list given the completed results so far.
   *
   * Returns:
   * - `{ tasks: [...] }` if the replanner produced new tasks. Caller is
   *   responsible for swapping them into the runtime's pending list.
   * - `null` if the LLM failed, the response was malformed, or the replanner
   *   explicitly returned the original remaining tasks unchanged. In all
   *   failure cases the caller should keep executing the original plan.
   *
   * The replanner intentionally receives *only* the truncated output of
   * completed results so it can't blow the context window on long-running
   * workspaces.
   */
  async replan(
    userRequest: string,
    completedResults: Result[],
    remainingTasks: Task[],
  ): Promise<{ tasks: Task[] } | null> {
    if (remainingTasks.length === 0) {
      // Nothing to replan — no stall possible.
      return null
    }

    const summary = this.summariseResults(completedResults)
    const remainingListing = remainingTasks
      .map((t) => `- [${t.id}] (${t.agentRole}, status=${t.status}) ${t.description}`)
      .join("\n")

    const sanitizedRequest = sanitizeUserInput(userRequest)
    const userMessage =
      `Original user request: ${sanitizedRequest}\n\n` +
      `Completed results (${completedResults.length}):\n${summary}\n\n` +
      `Remaining tasks to replan (${remainingTasks.length}):\n${remainingListing}\n\n` +
      `Return the revised remaining-task list as JSON.`

    try {
      const provider = this.resolveProvider()
      const messages: ChatMessage[] = [
        { role: "system", content: REPLANNER_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ]
      const response = await Promise.race([
        provider.chat(messages, {
          temperature: 0.3,
          maxTokens: 1500,
          jsonMode: true,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Replanner LLM call timed out")), LLM_TIMEOUT_MS),
        ),
      ])
      const json = extractJson(response.content)
      if (!json) return null
      const parsed = JSON.parse(json) as ReplanOutput
      if (!parsed.tasks || !Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
        return null
      }

      // Materialize: assign sequential ids preserving the first remaining
      // task's prefix so existing plan ids stay valid for dependsOn refs.
      const startIdx = remainingTasks[0]?.id.match(/task-(\d+)/)?.[1]
      let offset = startIdx ? Number(startIdx) - 1 : 0
      if (Number.isNaN(offset)) {
        offset = 0
      }
      const tasks: Task[] = parsed.tasks.map((t, i) => {
        const metadata: Record<string, unknown> = {}
        if (t.estimatedComplexity) metadata.estimatedComplexity = t.estimatedComplexity
        if (t.preferredCapabilities && t.preferredCapabilities.length > 0) {
          metadata.preferredCapabilities = t.preferredCapabilities
        }
        return {
          id: `task-${offset + i + 1}`,
          agentRole: t.agentRole,
          description: t.description,
          status: "pending" as const,
          dependsOn: t.dependsOn,
          ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
        }
      })

      log.info(
        {
          userRequest: userRequest.slice(0, 80),
          completedCount: completedResults.length,
          originalRemaining: remainingTasks.length,
          newRemaining: tasks.length,
        },
        "replan produced new task list",
      )
      return { tasks }
    } catch (err) {
      log.warn({ err }, "replan LLM failed — caller will keep original plan")
      return null
    }
  }

  /** Build a compact summary of completed results for the replanner prompt. */
  private summariseResults(results: Result[]): string {
    if (results.length === 0) return "(none)"
    return results
      .map((r) => {
        const snippet = r.output.length > 200 ? r.output.slice(0, 200) + "…" : r.output
        return `- [${r.taskId}] (${r.agentRole}): ${snippet}`
      })
      .join("\n")
  }
}

function defaultPlan(userRequest: string): PlannerOutput {
  // Heuristic: if request mentions "前端"/"frontend"/"UI"/"html"/"界面" → add frontend task.
  const lower = userRequest.toLowerCase()
  const wantsFrontend = /前端|frontend|ui|html|界面|web|page|页面|网站/.test(lower)

  const tasks: PlannerOutput["tasks"] = []

  if (wantsFrontend) {
    tasks.push({
      agentRole: "backend",
      description: `Design and implement the backend service for: ${userRequest}. Expose REST endpoints with a clear JSON contract.`,
      dependsOn: [],
      estimatedComplexity: "medium",
      preferredCapabilities: ["api-design"],
    })
    tasks.push({
      agentRole: "frontend",
      description: `Implement the frontend (HTML/CSS/JS) for: ${userRequest}. Consume the backend API contract from the prior backend result.`,
      dependsOn: ["task-1"],
      estimatedComplexity: "medium",
      preferredCapabilities: ["ui-rendering"],
    })
    tasks.push({
      agentRole: "review",
      description: "Review all generated artifacts.",
      dependsOn: ["task-1", "task-2"],
      estimatedComplexity: "simple",
      preferredCapabilities: ["critique"],
    })
  } else {
    tasks.push({
      agentRole: "general",
      description: `Implement: ${userRequest}`,
      dependsOn: [],
      estimatedComplexity: "medium",
      preferredCapabilities: ["general"],
    })
    tasks.push({
      agentRole: "review",
      description: "Review the generated artifact.",
      dependsOn: ["task-1"],
      estimatedComplexity: "simple",
      preferredCapabilities: ["critique"],
    })
  }

  return {
    rationale: "Heuristic fallback plan (planner LLM unavailable).",
    tasks,
  }
}

function extractJson(text: string): string | null {
  // Try direct parse first.
  try {
    JSON.parse(text)
    return text
  } catch {
    // Find first { and match to the correct closing } using balanced counting
    // to handle nested objects correctly
    const firstBrace = text.indexOf("{")
    if (firstBrace === -1) return null

    let depth = 0
    let endBrace = -1
    let inString = false
    let escaped = false
    for (let i = firstBrace; i < text.length; i++) {
      const c = text[i]!
      if (escaped) {
        escaped = false
        continue
      }
      if (c === "\\") {
        escaped = true
        continue
      }
      if (c === '"') {
        inString = !inString
        continue
      }
      if (inString) continue
      if (c === "{") depth++
      if (c === "}") {
        depth--
        if (depth === 0) {
          endBrace = i
          break
        }
      }
    }
    if (endBrace === -1) return null
    const jsonStr = text.slice(firstBrace, endBrace + 1)
    try {
      JSON.parse(jsonStr)
      return jsonStr
    } catch {
      return null
    }
  }
}
