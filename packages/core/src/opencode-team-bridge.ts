// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * OpencodeTeamBridge — mirror Maximilian TeamOrchestrator lifecycle events
 * into opencode's Agent.Service surface.
 *
 * Phase 4a wiring:
 *   - When a team is registered with the TeamOrchestrator, push a corresp-
 *     onding definition onto opencode via `POST /api/agent`-shaped calls.
 *     The current v2 protocol only exposes `GET /api/agent` (list) — the
 *     mutating endpoints (`AgentService.update`, `AgentService.delete`) are
 *     surfaced here as HTTP stubs that target `/api/agent/...` so they
 *     become a no-op (with a `mirror` body) when the server doesn't yet
 *     expose a mutating surface. Tests cover the wiring without needing a
 *     live server.
 *   - On `agent.promote` / `agent.demote`: emit `AgentService.update`.
 *   - On `agent.retire`: emit `AgentService.delete`.
 *
 * 借鉴 opencode:
 *   - `Agent.Service` shape lifted from `packages/opencode/src/agent/agent.ts`.
 *   - HTTP routes mirror `docs/opencode-sdk-spec.md` §6.2 (Agent list) +
 *     the proposed §6.2.x mutating surface.
 *   - Header + body conventions lifted from `@max/core-thin-sdk`.
 */

import type { EventBus } from "./event-bus.js";
import type { Team, TeamOrchestratorEvent } from "./team-orchestrator.js";

// ── Types ─────────────────────────────────────────────────────────────────

/** Lifecycle event names that drive opencode-side mutations. */
export type AgentLifecycleAction = "promote" | "demote" | "retire";

/** Body posted to opencode's `AgentService.update` mutation. */
export interface AgentUpdatePayload {
  /** Stable agent id (== Maximilian leader / specialist id). */
  agentId: string;
  /** Mirror of the Maximilian-side status string at mutation time. */
  status: string;
  /** Team this agent belongs to; useful for opencode-side grouping. */
  teamId?: string;
  /** Optional capability tags copied from the parent Team. */
  capabilities?: ReadonlyArray<string>;
  /** What triggered the update (promote / demote). */
  action: Exclude<AgentLifecycleAction, "retire">;
  /** Free-form audit payload. */
  metadata?: Record<string, unknown>;
}

/** Body posted to opencode's `AgentService.delete` mutation. */
export interface AgentDeletePayload {
  agentId: string;
  teamId?: string;
  reason?: string;
}

/** Mirror record: what we sent on registration, for round-trip assertions. */
export interface AgentMirror {
  agentId: string;
  teamId: string;
  status: string;
  capabilities: ReadonlyArray<string>;
  registeredAt: string;
}

/** Minimal fetch surface — defaults to `globalThis.fetch`. */
export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

/** Bus event emitted whenever a wire call goes out. */
export interface OpencodeBridgeEvent {
  type: "opencode-agent-mirror" | "opencode-agent-update" | "opencode-agent-delete";
  /** The payload sent on the wire. */
  payload: AgentMirror | AgentUpdatePayload | AgentDeletePayload;
  /** HTTP status returned (or 0 on network error). */
  statusCode: number;
  /** Timestamp (epoch-ms). */
  timestamp: number;
}

export interface OpencodeTeamBridgeOptions {
  /** Base URL of the running `opencode serve` instance. */
  baseUrl: string;
  /** Optional path prefix override (defaults to `/api/agent`). */
  pathPrefix?: string;
  /** Custom fetch implementation (test seam). */
  fetch?: FetchLike;
  /** Event bus for emitting bridge wire events. */
  eventBus?: EventBus<OpencodeBridgeEvent>;
  /** Don't actually call out — record the mirror only. Useful for dry runs. */
  dryRun?: boolean;
}

// ── Bridge ────────────────────────────────────────────────────────────────

/**
 * Thin bridge between Maximilian's TeamOrchestrator and opencode's
 * Agent.Service. Holds a per-team mirror so callers can introspect the
 * current side-car state without hitting the server.
 */
export class OpencodeTeamBridge {
  private readonly baseUrl: string;
  private readonly pathPrefix: string;
  private readonly fetchImpl: FetchLike;
  private readonly eventBus?: EventBus<OpencodeBridgeEvent>;
  private readonly dryRun: boolean;
  private readonly mirrors = new Map<string, AgentMirror>();
  private readonly updates: AgentUpdatePayload[] = [];
  private readonly deletes: AgentDeletePayload[] = [];

  constructor(opts: OpencodeTeamBridgeOptions) {
    if (!opts.baseUrl) {
      throw new Error("OpencodeTeamBridge: `baseUrl` is required");
    }
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.pathPrefix = opts.pathPrefix ?? "/api/agent";
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.eventBus = opts.eventBus;
    this.dryRun = opts.dryRun ?? false;
  }

  // ── Mirroring API ────────────────────────────────────────────────────

  /**
   * Mirror a Maximilian team to opencode. Each member of the team
   * (leader + specialists) is sent as a separate `AgentMirror` so the
   * opencode-side registry can adopt them as discrete agents.
   *
   * In a dry-run, only the in-memory mirror is updated. Otherwise the
   * call is `POST`ed to `<pathPrefix>/<agentId>`.
   */
  async mirrorTeam(team: Team): Promise<AgentMirror[]> {
    const now = new Date().toISOString();
    const memberIds = uniqueMembers(team);
    const out: AgentMirror[] = [];
    for (const agentId of memberIds) {
      const mirror: AgentMirror = {
        agentId,
        teamId: team.id,
        status: "registered",
        capabilities: team.capabilities ?? [],
        registeredAt: now,
      };
      this.mirrors.set(agentId, mirror);
      out.push(mirror);
      await this.postMirror(mirror);
    }
    return out;
  }

  /**
   * Apply a promotion / demotion. Pushes an `AgentService.update` body to
   * opencode so it can refresh any server-side status (e.g. session
   * default-agent assignment, capability visibility).
   */
  async applyLifecycle(
    team: Team,
    agentId: string,
    action: Exclude<AgentLifecycleAction, "retire">,
    status: string,
    metadata?: Record<string, unknown>,
  ): Promise<AgentUpdatePayload> {
    const payload: AgentUpdatePayload = {
      agentId,
      teamId: team.id,
      status,
      action,
      ...(metadata ? { metadata } : {}),
      capabilities: team.capabilities ?? [],
    };
    this.updates.push(payload);
    if (this.dryRun) {
      this.publish("opencode-agent-update", payload, 200);
      return payload;
    }
    const url = `${this.baseUrl}${this.pathPrefix}/${encodeURIComponent(agentId)}`;
    const statusCode = await this.sendJson("PATCH", url, payload);
    this.publish("opencode-agent-update", payload, statusCode);
    return payload;
  }

  /**
   * Apply a retirement. Pushes an `AgentService.delete` body and drops the
   * local mirror so subsequent mirrorTeam calls don't accidentally re-
   * introduce the agent.
   */
  async applyRetire(
    team: Team,
    agentId: string,
    reason?: string,
  ): Promise<AgentDeletePayload> {
    const payload: AgentDeletePayload = {
      agentId,
      teamId: team.id,
      ...(reason ? { reason } : {}),
    };
    this.deletes.push(payload);
    this.mirrors.delete(agentId);
    if (this.dryRun) {
      this.publish("opencode-agent-delete", payload, 200);
      return payload;
    }
    const url = `${this.baseUrl}${this.pathPrefix}/${encodeURIComponent(agentId)}`;
    const statusCode = await this.sendJson("DELETE", url, payload);
    this.publish("opencode-agent-delete", payload, statusCode);
    return payload;
  }

  // ── Bus subscription helper ───────────────────────────────────────────

  /**
   * Subscribe to a TeamOrchestrator's event bus and translate its events
   * into the corresponding opencode-side mutations. Returns an
   * unsubscribe handle.
   *
   * The orchestrator emits `team:delegation-*` / `team:escalation` events
   * which are not 1:1 with `agent.promote` / `agent.retire`. We treat
   * escalation as a "demote" (the failing team gets demoted) and a
   * successful delegation to a previously-unknown leader as a "promote".
   * The semantics are intentionally permissive — callers can extend the
   * mapping by handling the bus directly.
   */
  bindToOrchestrator(
    orchestratorEventBus: EventBus<TeamOrchestratorEvent>,
    resolveTeam: (teamId: string) => Team | undefined,
  ): { unsubscribe: () => void } {
    const handle = orchestratorEventBus.subscribe(async (event) => {
      try {
        if (event.type === "team:delegation-complete") {
          // Treat a fresh successful delegation as a promotion of the
          // recipient team leader.
          const result = event.result as
            | { toTeamId?: string; leaderId?: string }
            | undefined;
          if (result?.toTeamId && result.leaderId) {
            const team = resolveTeam(result.toTeamId);
            if (team) {
              await this.applyLifecycle(team, result.leaderId, "promote", "active");
            }
          }
          return;
        }
        if (event.type === "team:delegation-failed") {
          // Demote the team whose leader was the target.
          const team = resolveTeam(event.delegation.split(":")[1] ?? "");
          if (team) {
            await this.applyLifecycle(team, team.leaderId, "demote", "throttled");
          }
          return;
        }
        if (event.type === "team:escalation") {
          // Escalation = retire every team that exhausted itself.
          for (const teamId of event.attemptedTeams) {
            const team = resolveTeam(teamId);
            if (team) {
              await this.applyRetire(team, team.leaderId, event.reason);
            }
          }
          return;
        }
        // team:delegation-created — no-op for the bridge (mirroring
        // happens at registration time, not per-delegation).
      } catch {
        // Swallow bridge errors; we never want to break the orchestrator.
      }
    });
    return { unsubscribe: () => handle.unsubscribe() };
  }

  // ── Introspection ────────────────────────────────────────────────────

  /** Snapshot of currently mirrored agents (read-only view). */
  listMirrors(): AgentMirror[] {
    return Array.from(this.mirrors.values()).map((m) => Object.freeze({ ...m }));
  }

  /** History of update payloads posted on the wire. */
  listUpdates(): AgentUpdatePayload[] {
    return this.updates.map((u) => Object.freeze({ ...u }));
  }

  /** History of delete payloads posted on the wire. */
  listDeletes(): AgentDeletePayload[] {
    return this.deletes.map((d) => Object.freeze({ ...d }));
  }

  /** Number of currently mirrored agents (handy for tests). */
  size(): number {
    return this.mirrors.size;
  }

  /** Forget all mirrors + history (test isolation helper). */
  reset(): void {
    this.mirrors.clear();
    this.updates.length = 0;
    this.deletes.length = 0;
  }

  // ── Internal helpers ─────────────────────────────────────────────────

  private async postMirror(mirror: AgentMirror): Promise<void> {
    if (this.dryRun) {
      this.publish("opencode-agent-mirror", mirror, 200);
      return;
    }
    const url = `${this.baseUrl}${this.pathPrefix}/${encodeURIComponent(mirror.agentId)}`;
    const statusCode = await this.sendJson("POST", url, mirror);
    this.publish("opencode-agent-mirror", mirror, statusCode);
  }

  private async sendJson(
    method: "POST" | "PATCH" | "DELETE",
    url: string,
    body: unknown,
  ): Promise<number> {
    try {
      const res = await this.fetchImpl(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return res.status;
    } catch {
      // Network errors are reported as statusCode=0; the bridge treats
      // them as soft failures so the in-process mirror stays consistent
      // even when opencode is briefly unreachable.
      return 0;
    }
  }

  private publish(
    type: OpencodeBridgeEvent["type"],
    payload: AgentMirror | AgentUpdatePayload | AgentDeletePayload,
    statusCode: number,
  ): void {
    if (!this.eventBus) return;
    try {
      this.eventBus.publish({
        type,
        payload,
        statusCode,
        timestamp: Date.now(),
      });
    } catch {
      /* event-bus isolates */
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Distinct leader + specialist ids from a team. */
function uniqueMembers(team: Team): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [team.leaderId, ...team.specialistIds]) {
    if (typeof id === "string" && id.length > 0 && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}