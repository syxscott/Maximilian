import type { Context } from "hono"
import { createRoute } from "@hono/zod-openapi"
import { z } from "zod"
import { getLogger } from "@max/telemetry"
import type { Commander } from "@max/commander"
import type { AgentRuntime, RuntimeEvent, RuntimeSink } from "@max/core"
import type { FileWorkspaceStore } from "@max/workspace"
import type { DAGS } from "@max/dags"
import type { AutonomyOrchestrator } from "@max/autonomy"
import type { Queue } from "bullmq"
import { runDagsFlow, buildDagsWorkspace } from "../dags-flow.js"
import { readWorkerHeartbeat, HEARTBEAT_MAX_AGE_MS, type ResourceBudget } from "@max/queue"
import { getConfig } from "@max/config"

const ChatRequestSchema = z.object({
  message: z.string().min(1).max(8000),
  /**
   * Optional steering target (pi borrowing): when set and that workspace is
   * currently executing, the message is folded into the running tasks at
   * the next safe point instead of starting a new workspace.
   */
  workspaceId: z.string().optional(),
  resourceBudget: z
    .object({
      vramMb: z.number().int().positive().optional(),
      exclusive: z.boolean().optional(),
    })
    .optional(),
})

const ErrorSchema = z.object({ error: z.string() })

export const postChatRoute = createRoute({
  method: "post",
  path: "/chat",
  tags: ["chat"],
  request: {
    body: { content: { "application/json": { schema: ChatRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.unknown() } },
      description: "Workspace created",
    },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Invalid body" },
    500: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Internal error",
    },
  },
})

interface ChatDeps {
  commander: Commander
  runtime: AgentRuntime
  store: FileWorkspaceStore
  eventLog: Map<string, RuntimeEvent[]>
  // Optional Phase 5 wiring.
  dagsMode?: boolean
  dags?: DAGS
  orchestrator?: AutonomyOrchestrator
  /** Phase 10 — optional telemetry for recording execution traces. */
  telemetry?: { recordExecution(input: Record<string, unknown>): Promise<unknown> }
  /** Phase 6 — BullMQ queue for background execution. When set, POST /api/chat enqueues instead of running in-process. */
  queue?: Queue
  dagsApprovalRuntimes?: {
    register(runtime: {
      resolveApproval(
        requestId: string,
        response: { decision: "approve" | "reject"; comment?: string },
      ): { ok: true } | { ok: false; reason: "unknown" | "comment_required" }
    }): () => void
  }
  onDagsRuntimeEvent?: (event: RuntimeEvent) => void
}

const log = getLogger("chat")
const config = getConfig()

export function postChat(deps: ChatDeps) {
  return async (c: Context) => {
    const body = await c.req.json().catch(() => null)
    const parsed = ChatRequestSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: "Invalid body", details: parsed.error.flatten() }, 400)
    }
    const { message, resourceBudget, workspaceId } = parsed.data
    const effectiveResourceBudget = resourceBudget ?? inferResourceBudget(message)
    const tenantId = c.get("tenantId") as string | undefined

    // Steering (pi borrowing): a message aimed at an executing workspace is
    // applied at the runtime's next safe point (tool-loop boundary or wave
    // boundary) rather than planning a brand-new workspace. On an idle
    // workspace we fall through to the normal planning path — a follow-up
    // to a finished workspace is just a new request.
    if (workspaceId) {
      let target: import("@max/core").Workspace | undefined
      try {
        target = await deps.store.loadWorkspace(workspaceId, tenantId)
      } catch {
        target = undefined
      }
      if (!target) {
        return c.json({ error: "Workspace not found" }, 404)
      }
      if (deps.runtime.isExecuting(workspaceId)) {
        const steered = deps.runtime.steer(workspaceId, message, "api")
        if (steered) {
          log.info({ workspaceId, tenantId: tenantId ?? "dev" }, "steering message accepted")
          return c.json({ workspaceId, status: "steered", mode: "commander" })
        }
      }
    }

    // Phase 5.8 — DAGS_MODE bypasses Commander and uses DAGS.compose()
    // to dynamically assemble the team from the user request.
    if (deps.dagsMode && deps.dags && deps.orchestrator) {
      let workspace: import("@max/core").Workspace
      let plan: import("@max/core").Plan
      let composed: import("@max/dags").ComposedTeam
      try {
        ;({ workspace, plan, composed } = await buildDagsWorkspace(deps.dags, message))
        // Carry tenantId through the runtime sink. The runtime doesn't
        // know about auth, so we stash it on workspace.metadata and the
        // sink (in apps/api/src/index.ts) reads it back.
        workspace.metadata = { ...(workspace.metadata ?? {}), tenantId: tenantId ?? null }
        await deps.store.saveWorkspace(workspace, tenantId)
      } catch (err) {
        log.error({ err }, "buildDagsWorkspace failed")
        return c.json({ error: "Planning failed", details: String(err) }, 500)
      }

      runDagsFlow(
        {
          dags: deps.dags,
          store: deps.store,
          orchestrator: deps.orchestrator,
          telemetry: deps.telemetry,
          approvalRuntimes: deps.dagsApprovalRuntimes,
          onEvent: deps.onDagsRuntimeEvent,
        },
        workspace,
        deps.eventLog,
        composed,
      ).catch(async (err) => {
        log.error({ err }, "dags-flow crash")
        try {
          const ws = await deps.store.loadWorkspace(workspace.id, tenantId)
          if (ws) {
            ws.status = "failed"
            ;(ws as Record<string, unknown>).error = String(err)
            await deps.store.saveWorkspace(ws, tenantId)
          }
        } catch (saveErr) {
          log.error({ err: saveErr }, "failed to mark workspace as failed")
        }
      })

      return c.json({
        workspaceId: workspace.id,
        planId: plan.id,
        status: "planning",
        mode: "dags",
        teamSize: plan.tasks.length,
      })
    }

    // 1. Plan (legacy Commander path).
    const { workspace, plan } = await deps.commander.plan(message)

    // plan 执行前验证
    const preflightErrors = deps.commander.preflight(plan)
    if (preflightErrors.length > 0) {
      return c.json({ error: preflightErrors.join("; ") }, 400)
    }

    // Consume the Commander's plan-review verdict (Kosmos plan_reviewer
    // borrowing). Until now the verdict was write-only — stashed on
    // workspace.metadata and read by nobody, so a rejected plan executed
    // anyway. A plan that fails the 5-dimension review is bounced here
    // with the reasons; callers can inspect `review` to replan.
    const planReview = workspace.metadata?.planReview as
      | {
          approved: boolean
          averageScore: number
          minScore: number
          scores: Record<string, number>
          requiredChanges: string[]
        }
      | undefined
    if (planReview && planReview.approved === false) {
      return c.json(
        {
          error: "Plan rejected by reviewer",
          details: {
            averageScore: planReview.averageScore,
            minScore: planReview.minScore,
            scores: planReview.scores,
            requiredChanges: planReview.requiredChanges,
          },
        },
        422,
      )
    }

    // Stash tenantId on workspace.metadata so the runtime sink (which
    // doesn't know about auth) can persist with the right tenant scope.
    workspace.metadata = { ...(workspace.metadata ?? {}), tenantId: tenantId ?? null }
    await deps.store.saveWorkspace(workspace, tenantId)

    // 2. Execute — either via BullMQ queue or in-process.
    if (deps.queue) {
      // Queue mode: refuse to enqueue if no worker has heartbeated
      // recently. Without this check, an enqueued job would sit in
      // Redis forever (or until stalledInterval kicks in, which is
      // 30s — too long for a user waiting for a response) and the
      // user would see their workspace stuck in "planning" with no
      // error to act on.
      //
      // Skip the check when REDIS_URL isn't configured (e.g. unit
      // tests with a mock queue) — those tests don't have a worker
      // process to heartbeat, and the queue is just a stub.
      if (config.REDIS_URL) {
        let workerOk = true
        try {
          const lastBeat = await readWorkerHeartbeat(config.REDIS_URL)
          if (!lastBeat || Date.now() - lastBeat > HEARTBEAT_MAX_AGE_MS) {
            workerOk = false
          }
        } catch (err) {
          // If we can't reach Redis to read the heartbeat, treat as no
          // worker — better to surface 503 than silently drop the job.
          log.warn({ err }, "failed to read worker heartbeat")
          workerOk = false
        }
        if (!workerOk) {
          return c.json(
            {
              error: "No live worker available — workspace not enqueued",
              details:
                "The background worker is not running. Start it with `pnpm --filter @max/worker dev`.",
            },
            503,
          )
        }
      }
      // Only attach tenantId to the payload when defined — keeps the
      // shape stable for legacy consumers and tests that don't care
      // about tenancy.
      const jobData: {
        workspaceId: string
        mode: "commander"
        tenantId?: string
        resourceBudget?: ResourceBudget
      } = {
        workspaceId: workspace.id,
        mode: "commander",
      }
      if (tenantId !== undefined) jobData.tenantId = tenantId
      if (effectiveResourceBudget) jobData.resourceBudget = effectiveResourceBudget
      await deps.queue.add("execute", jobData)
      log.info(
        { workspaceId: workspace.id, tenantId: tenantId ?? "dev" },
        "enqueued workspace for execution",
      )
    } else {
      // Run in background; respond immediately with workspaceId.
      // The runtime already persists the final state (status, results,
      // timestamps) via the sink on `done`. The .then block here only
      // needs to attach the review agent's verdict (which the runtime
      // doesn't know is special) and write artifacts. Writing the whole
      // workspace a second time here would race with the runtime's
      // authoritative save and could clobber state if it landed first.
      deps.runtime
        .execute(workspace)
        .then(async (final) => {
          const reviewResult = final.results.find((r) => r.agentRole === "review")
          const review = reviewResult?.metadata?.review as
            import("@max/core").ReviewResult | undefined
          if (review) {
            final.review = review
            await deps.store.saveWorkspace(final, tenantId)
          }
          // Artifacts live outside the typed workspace schema, so persist
          // them after the runtime's authoritative save. Failures here
          // shouldn't be fatal — log and move on.
          await saveArtifactsFromResults(deps.store, final).catch((err) => {
            log.warn({ err, workspaceId: final.id }, "artifact persistence failed")
          })
          // Closed-loop observation: feed the completed workspace into the
          // orchestrator so review → plan → candidate → promote fires on the
          // legacy Commander path too. Without this, evolution only learns
          // from DAGS_MODE workspaces. Failures are non-fatal.
          if (deps.orchestrator) {
            deps.orchestrator.observe(final).catch((err) => {
              log.warn({ err, workspaceId: final.id }, "orchestrator.observe failed")
            })
          }
        })
        .catch(async (err) => {
          log.error({ err }, "execution failed")
          // Only mark as failed if the runtime didn't already complete
          // successfully. A post-runtime error (e.g. transient I/O while
          // writing artifacts) must not overwrite a `completed` status.
          try {
            const current = await deps.store.loadWorkspace(workspace.id, tenantId)
            if (current && current.status !== "completed" && current.status !== "failed") {
              const failed = { ...current, status: "failed" as const, error: String(err) }
              await deps.store.saveWorkspace(failed, tenantId)
            }
          } catch (saveErr) {
            log.error({ err: saveErr }, "failed to mark workspace as failed")
          }
        })
    }

    return c.json({
      workspaceId: workspace.id,
      planId: plan.id,
      status: "planning",
      mode: "commander",
    })
  }
}

async function saveArtifactsFromResults(
  store: FileWorkspaceStore,
  workspace: import("@max/core").Workspace,
): Promise<void> {
  for (const result of workspace.results) {
    if (result.agentRole === "review") continue
    const blocks = extractCodeBlocks(result.output)
    if (blocks.length === 0) {
      // Save raw output as a .txt fallback so we never lose content.
      await store.saveArtifact(
        workspace.id,
        `${result.agentRole}-${result.id.slice(0, 6)}.txt`,
        result.output,
      )
      continue
    }
    for (const block of blocks) {
      const ext = langToExt(block.lang)
      await store.saveArtifact(
        workspace.id,
        `${result.agentRole}-${block.lang ?? "code"}-${result.id.slice(0, 6)}${ext}`,
        block.code,
      )
    }
  }
}

function inferResourceBudget(message: string): ResourceBudget | undefined {
  if (/\b(vision|image|video|ocr|vlm|multimodal)\b/i.test(message)) {
    return { vramMb: 16_000, exclusive: true }
  }
  return undefined
}

interface CodeBlock {
  lang: string | null
  code: string
}

function extractCodeBlocks(text: string): CodeBlock[] {
  const blocks: CodeBlock[] = []
  const re = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    blocks.push({ lang: m[1] || null, code: m[2] })
  }
  return blocks
}

function langToExt(lang: string | null): string {
  const map: Record<string, string> = {
    html: ".html",
    htm: ".html",
    css: ".css",
    javascript: ".js",
    js: ".js",
    typescript: ".ts",
    ts: ".ts",
    tsx: ".tsx",
    jsx: ".jsx",
    json: ".json",
    python: ".py",
    py: ".py",
    markdown: ".md",
    md: ".md",
    shell: ".sh",
    bash: ".sh",
    sh: ".sh",
  }
  return map[lang ?? ""] ?? ".txt"
}

// Suppress unused-import warning for sink type when DAGS_MODE branch
// is not active.
export type _Unused = RuntimeSink
