/**
 * Phase 5.8 — DAGS_MODE runtime flow.
 *
 * Bypasses Commander. Instead:
 *   1. DAGS.compose(userRequest) → ComposedTeam
 *   2. Convert TeamGraph.nodes → Plan.tasks
 *   3. Build factory from ComposedTeam (dynamic agents)
 *   4. Create fresh AgentRuntime with this factory
 *   5. After execution, call AutonomyOrchestrator.observe(workspace)
 *
 * This path coexists with the legacy Commander flow (DAGS_MODE=false),
 * which is unchanged.
 */

import { randomUUID } from "node:crypto"
import { getLogger } from "@max/telemetry"
import type { Plan, Task, Workspace } from "@max/core"

const log = getLogger("dags-flow")
import { AgentRuntime, type RuntimeSink, type RuntimeEvent } from "@max/core"
import type { FileWorkspaceStore } from "@max/workspace"
import type { DAGS, ComposedTeam } from "@max/dags"
import type { AutonomyOrchestrator } from "@max/autonomy"

export interface DagsFlowDeps {
  dags: DAGS
  store: FileWorkspaceStore
  orchestrator: AutonomyOrchestrator
  /** Phase 10 — optional telemetry for recording execution traces. */
  telemetry?: {
    recordExecution(input: Record<string, unknown>): Promise<unknown>
  }
  approvalRuntimes?: {
    register(runtime: {
      resolveApproval(
        requestId: string,
        response: { decision: "approve" | "reject"; comment?: string },
      ): { ok: true } | { ok: false; reason: "unknown" | "comment_required" }
    }): () => void
  }
  onEvent?: (event: RuntimeEvent) => void
}

/**
 * Build a workspace + plan from a DAGS composed team. Returns the
 * ComposedTeam so runDagsFlow can reuse it — composing twice produced two
 * independently-drawn teams, and if the second diverged from the first the
 * factory's role map missed roles and runTask threw "No agent factory for
 * role".
 */
export async function buildDagsWorkspace(
  dags: DAGS,
  userRequest: string,
): Promise<{ workspace: Workspace; plan: Plan; composed: ComposedTeam }> {
  const composed = await dags.compose(userRequest)
  await dags.saveGraph(composed.graph)

  const workspaceId = `ws-${randomUUID().slice(0, 8)}`
  const planId = `plan-${randomUUID().slice(0, 8)}`
  const now = new Date().toISOString()

  // Map graph nodes to tasks. Each node becomes one task.
  // We bypass strict AgentRole validation by casting — runtime treats
  // agentRole as an open string for factory lookup.
  const nodeIds = composed.graph.nodes.map((n) => n.id)
  const tasks: Task[] = composed.graph.nodes.map((n) => ({
    id: n.id,
    agentRole: (n.kind === "approval" ? "approval" : n.role) as unknown as Task["agentRole"],
    description:
      n.kind === "approval"
        ? (n.approvalConfig?.prompt ?? n.displayName)
        : (n.displayName ?? n.role),
    status: "pending" as const,
    dependsOn: n.dependsOn.filter((d) => nodeIds.includes(d)),
    metadata:
      n.kind === "approval"
        ? {
            kind: "approval",
            approval: {
              prompt: n.approvalConfig?.prompt ?? n.displayName,
              requireComment: n.approvalConfig?.requireComment ?? false,
              reason: n.approvalConfig?.reason,
            },
          }
        : {},
  }))

  // Add a final review task (matches the legacy Commander convention).
  const reviewTaskId = `task-review-${randomUUID().slice(0, 4)}`
  tasks.push({
    id: reviewTaskId,
    agentRole: "review" as Task["agentRole"],
    description: "Review all generated artifacts",
    status: "pending" as const,
    dependsOn: nodeIds,
  })

  const plan: Plan = {
    id: planId,
    workspaceId,
    userRequest,
    rationale: `DAGS composed team of ${composed.capabilities.join(", ")}`,
    tasks,
    createdAt: now,
  }

  const workspace: Workspace = {
    id: workspaceId,
    userRequest,
    status: "planning",
    plan,
    results: [],
    createdAt: now,
    updatedAt: now,
    metadata: {},
  }

  return { workspace, plan, composed }
}

/**
 * Run a DAGS_MODE workspace: build factory, run, persist, observe.
 * Pass the `composed` team from buildDagsWorkspace — when omitted (legacy
 * callers) the team is composed again here.
 */
export async function runDagsFlow(
  deps: DagsFlowDeps,
  workspace: Workspace,
  eventLog: Map<string, RuntimeEvent[]>,
  composed?: ComposedTeam,
): Promise<void> {
  let executionTrace: Record<string, unknown> | undefined
  let unregisterApprovalRuntime: (() => void) | undefined

  try {
    const team = composed ?? (await deps.dags.compose(workspace.userRequest))
    const factory = deps.dags.buildAgentFactory(team)

    // Phase 10 — create execution trace if telemetry is wired.
    if (deps.telemetry) {
      executionTrace = (await deps.telemetry.recordExecution({
        workspaceId: workspace.id,
        taskId: workspace.plan?.tasks[0]?.id ?? "unknown",
        userPrompt: workspace.userRequest,
        assignedTeamGraph: {
          id: team.graph.id,
          nodes: team.graph.nodes.map((n) => ({
            id: n.id,
            role: n.role,
            displayName: n.displayName ?? n.role,
            dependsOn: n.dependsOn,
          })),
          capabilities: team.capabilities,
        },
        steps: [],
        status: "running",
      })) as Record<string, unknown>
    }

    const sink: RuntimeSink = {
      // The runtime doesn't know about auth, so we read tenantId from
      // the workspace's metadata bag (set by the chat route before
      // runDagsFlow is called). Without this, tenant-owned workspaces
      // would be persisted as tenant-less and become unreadable.
      saveWorkspace: async (ws) => {
        const tenantId = (ws.metadata?.tenantId as string | null | undefined) ?? undefined
        return deps.store.saveWorkspace(ws, tenantId ?? undefined)
      },
      loadWorkspace: async (id) => {
        // We don't have the workspace object here, so we can't recover
        // the tenantId. The runtime's _executeImpl doesn't actually
        // call loadWorkspace (it only saves), so this stays a no-op
        // safety net. If a future runtime change does need to load by
        // id, it'll have to thread tenantId through the sink ctx.
        return deps.store.loadWorkspace(id)
      },
    }

    const runtime = new AgentRuntime(factory as never, sink)
    unregisterApprovalRuntime = deps.approvalRuntimes?.register(runtime)

    // Wire into event log so UI polling still works.
    // Phase 10 — also append steps to execution trace.
    runtime.on((event) => {
      const arr = eventLog.get(event.workspaceId) ?? []
      arr.push(event)
      eventLog.set(event.workspaceId, arr)
      if (arr.length > 500) arr.splice(0, arr.length - 500)
      deps.onEvent?.(event)

      // Append to execution trace steps.
      if (executionTrace) {
        const steps = executionTrace.steps as Record<string, unknown>[]
        if (event.type === "task-start") {
          steps.push({
            role: "user",
            content: `Task ${event.taskId} started by ${event.agentRole}`,
            agentRole: event.agentRole,
            taskId: event.taskId,
            timestamp: new Date().toISOString(),
          })
        } else if (event.type === "task-complete") {
          steps.push({
            role: "assistant",
            content: event.result.output.slice(0, 500),
            agentRole: event.result.agentRole,
            taskId: event.taskId,
            timestamp: new Date().toISOString(),
          })
        } else if (event.type === "task-failed") {
          steps.push({
            role: "assistant",
            content: `FAILED: ${event.error}`,
            agentRole: "unknown",
            taskId: event.taskId,
            timestamp: new Date().toISOString(),
          })
        }
      }
    })

    const final = await runtime.execute(workspace)
    // The runtime already saved the final state via the sink. We only
    // need to persist anything that the sink doesn't know about — and
    // for the dags flow, that's nothing extra. Don't write again: it
    // would race with the runtime's authoritative save and could clobber
    // a completed workspace if an error fires later in this scope.

    // Phase 10 — mark execution trace as completed.
    if (executionTrace) {
      executionTrace.status = "completed"
      executionTrace.completedAt = new Date().toISOString()
    }

    // Phase 5 closed loop.
    await deps.orchestrator.observe(final)
  } catch (err) {
    log.error({ err }, "dags-flow failed")

    // Phase 10 — mark execution trace as failed.
    if (executionTrace) {
      executionTrace.status = "failed"
      executionTrace.error = String(err)
      executionTrace.completedAt = new Date().toISOString()
    }

    const failedTenantId = (workspace.metadata?.tenantId as string | null | undefined) ?? undefined
    const failed = { ...workspace, status: "failed" as const, error: String(err) }
    await deps.store.saveWorkspace(failed, failedTenantId ?? undefined).catch(() => {})
  } finally {
    unregisterApprovalRuntime?.()
  }
}
