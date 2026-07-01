/**
 * Phase 11 — HITL Governance Control Plane routes.
 *
 *   GET  /api/gov/pending                 List proposals pending human approval
 *   POST /api/gov/proposals/:id/action    Approve or reject a pending proposal
 *
 * When a human approves, the mutation is executed directly (bypassing
 * SafeRollout's shadow/canary gating) because human approval IS the
 * authorization. If the mutation fails, the proposal is marked "failed"
 * and the error is surfaced to the caller.
 */

import { createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { z } from "zod";
import { getLogger } from "@max/telemetry";
import type { PendingProposalStore } from "@max/meta-system";
import type { SafeRollout } from "@max/meta-system";
import type { CapabilityRegistry } from "@max/meta-system";
import type { GovernanceEngine } from "@max/meta-system";
import type { OrganizationMemory } from "@max/meta-system";
import type { TelemetrySink } from "@max/meta-system";
import type { AgentBirthEngine } from "@max/meta-system";
import type { AgentBlueprint } from "@max/dags";
import { ErrorSchema } from "../schemas.js";

interface GovRouteDeps {
  pendingStore: PendingProposalStore;
  rollout: SafeRollout;
  registry: CapabilityRegistry;
  birth: AgentBirthEngine;
  governance: GovernanceEngine;
  orgMemory: OrganizationMemory;
  manualSaveBlueprint?: (bp: AgentBlueprint) => Promise<void>;
  manualRetireBlueprint?: (blueprintId: string) => Promise<void>;
  telemetry?: TelemetrySink;
}

const ActionSchema = z.object({
  action: z.enum(["approve", "reject"]),
  reason: z.string().min(1),
  user: z.string().min(1),
});

const ProposalIdParamsSchema = z.object({ id: z.string().min(1) });

// ── OpenAPI route definitions ─────────────────────────────────────────────

export const listPendingProposalsRoute = createRoute({
  method: "get",
  path: "/gov/pending",
  tags: ["governance"],
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Pending proposals" },
    500: { content: { "application/json": { schema: ErrorSchema } }, description: "Internal error" },
  },
});

export const resolveProposalRoute = createRoute({
  method: "post",
  path: "/gov/proposals/{id}/action",
  tags: ["governance"],
  request: {
    params: ProposalIdParamsSchema,
    body: { content: { "application/json": { schema: ActionSchema } } },
  },
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Resolved" },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Invalid body" },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "Proposal not found" },
    500: { content: { "application/json": { schema: ErrorSchema } }, description: "Internal error" },
  },
});

const log = getLogger("gov");

export function govRoutes(deps: GovRouteDeps) {
  const {
    pendingStore,
    registry,
    birth,
    orgMemory,
    manualSaveBlueprint,
    manualRetireBlueprint,
    telemetry,
  } = deps;

  return {
    listPending: async (c: Context) => {
      try {
        const proposals = await pendingStore.listPending();
        return c.json({ count: proposals.length, proposals });
      } catch (err) {
        log.error({ err }, "listPending failed");
        return c.json({ error: "internal_error" }, 500);
      }
    },

    resolveProposal: async (c: Context) => {
      const id = c.req.param("id") ?? "";
      if (!id) return c.json({ error: "missing id param" }, 400);

      const { action, reason, user } = c.req.valid("json" as never) as { action: "approve" | "reject"; reason: string; user: string };

      let pending;
      try {
        pending = await pendingStore.get(id);
      } catch (err) {
        log.error({ err }, "pendingStore.get failed");
        return c.json({ error: "internal_error" }, 500);
      }

      if (!pending) {
        return c.json({ error: "Proposal not found", id }, 404);
      }
      if (pending.status !== "pending_human") {
        return c.json({ error: "Proposal already resolved", id, status: pending.status }, 409);
      }

      // ── Reject path ──────────────────────────────────────────────────
      if (action === "reject") {
        try {
          await pendingStore.resolve(id, "rejected", user, reason);
        } catch (err) {
          // TOCTOU: another caller resolved first.
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("already resolved")) {
            return c.json({ error: "Proposal already resolved", id }, 409);
          }
          log.error({ err }, "reject resolve failed");
          return c.json({ error: "internal_error" }, 500);
        }

        await orgMemory.record("proposal_rejected_by_human", pending.proposal.subject, {
          proposalId: id,
          action: pending.proposal.action,
          resolvedBy: user,
          reason,
        }).catch((e) => log.error({ err: e }, "orgMemory.record (reject) failed"));

        return c.json({
          proposalId: id,
          status: "rejected",
          resolvedBy: user,
          reason,
        });
      }

      // ── Approve path ─────────────────────────────────────────────────
      // Execute the mutation FIRST. Only mark "approved" after success.
      // This prevents inconsistent state where the proposal says "approved"
      // but the mutation actually failed.
      try {
        await executeMutation(pending.proposal, {
          registry,
          birth,
          manualSaveBlueprint,
          manualRetireBlueprint,
        });
      } catch (err) {
        // Distinguish a `MutationError` (operator-facing message, safe to
        // surface) from a raw `Error` (which may contain internal paths,
        // stack traces, or capability names that the caller doesn't need
        // to know). For raw errors, log the detail and return a generic
        // message to the client so we don't leak server internals.
        const isMutationError = err instanceof MutationError;
        const applyError = isMutationError
          ? err.message
          : "Mutation failed; see server logs for details.";
        log.error(
          { err, proposalId: id, code: isMutationError ? err.code : "internal" },
          "mutation failed",
        );

        // Record failed attempt.
        await orgMemory.record("proposal_rejected_by_human", pending.proposal.subject, {
          proposalId: id,
          action: pending.proposal.action,
          error: isMutationError ? err.code : "internal",
          resolvedBy: user,
          reason,
        }).catch((e) => log.error({ err: e }, "orgMemory.record (failed) failed"));

        return c.json({
          proposalId: id,
          status: "failed",
          resolvedBy: user,
          error: applyError,
          ...(isMutationError ? { code: err.code } : {}),
        }, 500);
      }

      // Mutation succeeded — now atomically resolve the proposal.
      try {
        await pendingStore.resolve(id, "approved", user, reason);
      } catch (err) {
        // TOCTOU: another caller resolved while we were executing.
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("already resolved")) {
          return c.json({ error: "Proposal already resolved", id }, 409);
        }
        log.error({ err }, "approve resolve failed");
        return c.json({ error: "internal_error" }, 500);
      }

      // Record the successful outcome.
      await orgMemory.record("proposal_approved_by_human", pending.proposal.subject, {
        proposalId: id,
        action: pending.proposal.action,
        applied: true,
        resolvedBy: user,
        reason,
      }).catch((e) => log.error({ err: e }, "orgMemory.record (approve) failed"));

      // Record EvolutionTrace for human-vetted authorization.
      if (telemetry) {
        await telemetry.recordEvolution({
          proposalId: id,
          proposalType: pending.proposal.action,
          subject: pending.proposal.subject,
          simulatedScores: {
            costDelta: pending.simulation.costDelta,
            latencyDeltaMs: pending.simulation.latencyDeltaMs,
            qualityDelta: pending.simulation.qualityDelta,
            riskDelta: pending.simulation.riskDelta,
            utility: pending.score.utility,
          },
          governanceVerdict: { allowed: true, reason: `human-approved by ${user}: ${reason}` },
          rolloutStatus: "human_approved",
          approved: true,
        }).catch((e) => log.error({ err: e }, "telemetry.recordEvolution failed"));
      }

      return c.json({
        proposalId: id,
        status: "approved",
        resolvedBy: user,
        rollout: {
          mode: "full",
          applied: true,
          reason: "human-approved, direct apply",
        },
      });
    },
  };
}

// ── Mutation executor ─────────────────────────────────────────────────────

async function executeMutation(
  proposal: { action: string; subject: string; target?: string; payload: Record<string, unknown> },
  handlers: {
    registry: CapabilityRegistry;
    birth: AgentBirthEngine;
    manualSaveBlueprint?: (bp: AgentBlueprint) => Promise<void>;
    manualRetireBlueprint?: (blueprintId: string) => Promise<void>;
  },
): Promise<void> {
  const { action, subject } = proposal;
  const { registry, birth, manualSaveBlueprint, manualRetireBlueprint } = handlers;

  switch (action) {
    case "retire":
      if (!manualRetireBlueprint) {
        throw new MutationError(
          "handler_missing",
          `Retire handler not configured — cannot retire "${subject}".`,
        );
      }
      await manualRetireBlueprint(subject);
      break;

    case "promote":
      await registry.transition(subject, "active");
      break;

    case "demote":
      await registry.transition(subject, "experimental");
      break;

    case "birth": {
      // Look up the capability record to birth an agent from.
      const cap = await registry.get(subject);
      if (!cap) throw new MutationError("capability_not_found", `Capability "${subject}" not found.`);
      const result = await birth.birth(cap);
      // birth.birth() can return undefined when no provider/model is
      // enabled, when the capability is already birthed, or when
      // internal preconditions fail. Without this guard, the next line
      // dereferences `result.blueprintId` and throws a TypeError that
      // surfaces as "Cannot read properties of undefined" in the 500
      // response — confusing for the operator and easy to mistake for
      // a transient retry.
      if (!result) {
        throw new MutationError(
          "birth_failed",
          `AgentBirthEngine returned no blueprint for capability "${subject}". ` +
            `Check that at least one provider is enabled and the capability isn't already birthed.`,
        );
      }
      if (manualSaveBlueprint) {
        // Construct a minimal AgentBlueprint from the birth result.
        const now = new Date().toISOString();
        const bp: AgentBlueprint = {
          id: result.blueprintId,
          role: result.role,
          displayName: result.displayName,
          goal: `Agent for ${result.parentCapability}`,
          systemPrompt: result.systemPrompt,
          capabilities: result.capabilities,
          tools: [],
          preferredModels: [],
          constraints: result.constraints,
          version: result.version,
          createdAt: now,
          updatedAt: now,
          stats: { totalTasks: 0, totalSuccesses: 0, avgScore: 0, avgExecutionTimeMs: 0 },
          metadata: {},
        };
        await manualSaveBlueprint(bp);
      }
      break;
    }

    case "merge":
    case "split":
    case "rebalance_team":
      // These require team-graph-level mutations not available here.
      // They are recorded as approved but not applied — the next
      // orchestrator cycle will detect the approval and re-propose
      // a concrete mutation.
      throw new MutationError(
        "not_executable",
        `Action "${action}" requires the orchestrator cycle; not directly executable via HITL.`,
      );

    default:
      throw new MutationError("unknown_action", `Unknown proposal action: "${action}".`);
  }
}

/**
 * Internal error type for mutation failures. The `code` is a short
 * machine-readable identifier; the `message` is safe to surface to the
 * HITL operator. Plain `Error` instances are treated as internal failures
 * and only logged, never returned to the client.
 */
class MutationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "MutationError";
  }
}
