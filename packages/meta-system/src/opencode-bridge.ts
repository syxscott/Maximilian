/**
 * Phase 3a — MetaSystemOpencodeBridge
 *
 * Wires @max/meta-system into the opencode event stream surfaced by
 * @max/core-thin-sdk's `EventBridge`. The bridge:
 *
 *   - subscribes to mapped events from the EventBridge
 *   - treats each new opencode session as a discoverable team (capability
 *     discovery) and tracks per-team lifecycle (active / idle / degraded /
 *     completed / failed)
 *   - feeds TruthAudit with a moving prediction window so compaction events
 *     recalibrate the simulator
 *   - on session errors, flags the team as degraded and may trigger a
 *     replan via the caller-supplied `onReplan` hook
 *   - on session.idle, marks the current task as complete
 *   - on plugin.added, registers a new agent capability so the team can
 *     route tasks to it
 *
 * 借鉴 opencode: the opencode Agent.Service (agent.ts) is the source of
 * truth for agent definitions; this bridge treats plugin.added as the
 * signal that a new agent has joined the available pool, mirroring
 * opencode's runtime observation in `Agent.Service.list()`.
 */

import { EventEmitter } from "node:events";
import type { EventStore, StoredEvent, Team } from "@max/core";
import {
  EventBridge,
  type MappedEventInfo,
  type OpencodeEvent,
} from "@max/core-thin-sdk";

// ── Public types ───────────────────────────────────────────────────────────

/** Lifecycle state the bridge tracks for each opencode session / team. */
export type BridgeTeamStatus =
  | "active"
  | "idle"
  | "degraded"
  | "completed"
  | "failed";

/**
 * Per-team state snapshot. The bridge keeps one of these in memory and
 * updates it on every relevant event. The shape is intentionally narrow
 * — Digital Twin queries and TruthAudit both consume it.
 */
export interface TeamState {
  /** Team id (== opencode session id, since each session becomes a team). */
  teamId: string;
  /** Original `Team` passed in via `existingTeams` (if any). */
  team?: Team;
  /** Lifecycle state (active / idle / degraded / completed / failed). */
  status: BridgeTeamStatus;
  /** Most recent opencode session id (usually same as teamId). */
  lastSessionId?: string;
  /** ISO-8601 timestamp of the most recent state change. */
  lastUpdated: string;
  /** Capability tags discovered for this team. */
  capabilities: string[];
  /** Plugin-added capabilities (set on `plugin.added` events). */
  pluginCapabilities: string[];
  /** Count of `session.compacted` events seen. */
  compactionCount: number;
  /** Count of `session.error` events seen. */
  errorCount: number;
  /** Count of `session.idle` events seen (== completed task count). */
  completionCount: number;
  /** Last error message seen, if any. */
  lastError?: string;
}

export interface MetaSystemOpencodeBridgeOptions {
  /** EventBridge instance to subscribe to. Must already be (or will be) started. */
  eventBridge: EventBridge;
  /** EventStore the bridge writes derived events to. */
  eventStore: EventStore;
  /**
   * Map of pre-existing teams keyed by teamId. Sessions matching these
   * ids reuse the existing Team; new sessions create fresh TeamState
   * entries on the fly.
   */
  existingTeams: Map<string, Team>;
  /**
   * Optional callback invoked when a session error crosses the
   * degradation threshold (≥ `errorThreshold` errors). Receives the
   * teamId and a human-readable reason. Default threshold: 2.
   */
  onReplan?: (input: { teamId: string; reason: string }) => void;
  /**
   * Optional override for the number of session errors that flips a team
   * from `degraded` to a replan trigger. Defaults to 2.
   */
  errorThreshold?: number;
}

// ── Internal helpers ───────────────────────────────────────────────────────

/** Opencode event types the bridge reacts to. Anything else is ignored. */
const HANDLED_OPENCODE_TYPES: ReadonlySet<string> = new Set([
  "session.created",
  "session.compacted",
  "session.error",
  "session.idle",
  "plugin.added",
]);

/** Defensive type-guard for objects that look like an opencode envelope. */
function isOpencodeEnvelope(value: unknown): value is OpencodeEvent {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.type === "string";
}

// ── MetaSystemOpencodeBridge ───────────────────────────────────────────────

export declare interface MetaSystemOpencodeBridge {
  /** Fires whenever a team's status changes. */
  on(event: "team-state-changed", listener: (state: TeamState) => void): this;
  /** Fires when a replan is triggered. */
  on(event: "replan", listener: (input: { teamId: string; reason: string }) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

/**
 * Subscribes to mapped opencode events and maintains a per-team state
 * table that downstream consumers (Digital Twin, TruthAudit) can query.
 */
export class MetaSystemOpencodeBridge extends EventEmitter {
  private readonly eventBridge: EventBridge;
  private readonly eventStore: EventStore;
  private readonly existingTeams: Map<string, Team>;
  private readonly onReplan?: (input: { teamId: string; reason: string }) => void;
  private readonly errorThreshold: number;

  /** Per-team state table. Keyed by teamId == sessionId. */
  private readonly states = new Map<string, TeamState>();

  /** Unsubscribe handle returned by `EventBridge.subscribe()`. */
  private unsubscribe: (() => void) | null = null;
  private started = false;

  constructor(opts: MetaSystemOpencodeBridgeOptions) {
    super();
    if (!opts.eventBridge) throw new Error("MetaSystemOpencodeBridge: `eventBridge` is required");
    if (!opts.eventStore) throw new Error("MetaSystemOpencodeBridge: `eventStore` is required");
    if (!opts.existingTeams) throw new Error("MetaSystemOpencodeBridge: `existingTeams` is required");

    this.eventBridge = opts.eventBridge;
    this.eventStore = opts.eventStore;
    this.existingTeams = opts.existingTeams;
    this.onReplan = opts.onReplan;
    this.errorThreshold = opts.errorThreshold ?? 2;

    // Seed state table with any pre-existing teams.
    for (const [teamId, team] of this.existingTeams.entries()) {
      this.states.set(teamId, {
        teamId,
        team,
        status: "active",
        lastSessionId: teamId,
        lastUpdated: new Date().toISOString(),
        capabilities: team.capabilities ? [...team.capabilities] : [],
        pluginCapabilities: [],
        compactionCount: 0,
        errorCount: 0,
        completionCount: 0,
      });
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /** Begin listening for mapped events. Idempotent. */
  start(): void {
    if (this.started) return;
    this.unsubscribe = this.eventBridge.subscribe((info: MappedEventInfo) => this.onMapped(info));
    this.started = true;
  }

  /**
   * Stop listening for events. After `stop()`, the bridge no longer
   * receives events but still serves cached state for queries.
   */
  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.started = false;
  }

  /** Whether the bridge is currently subscribed to events. */
  isRunning(): boolean {
    return this.started;
  }

  // ── Public query API ───────────────────────────────────────────────────

  /**
   * Read the current state for a team. Returns `undefined` if no events
   * have been observed for that team yet (and it wasn't in
   * `existingTeams`).
   *
   * 借鉴 opencode: mirrors the lookup pattern in `Agent.Service.get()`
   * — callers get `undefined` instead of throwing for unknown ids.
   */
  getTeamState(teamId: string): TeamState | undefined {
    return this.states.get(teamId);
  }

  /** Snapshot of all known team states. */
  getAllTeamStates(): TeamState[] {
    return [...this.states.values()];
  }

  /** Number of teams currently tracked. */
  size(): number {
    return this.states.size;
  }

  // ── Event dispatch ─────────────────────────────────────────────────────

  private onMapped(info: MappedEventInfo): void {
    if (!isOpencodeEnvelope(info.sourceEvent)) return;
    const opencodeType = info.opencodeType;
    if (!HANDLED_OPENCODE_TYPES.has(opencodeType)) return;

    const data = (info.sourceEvent.data ?? {}) as Record<string, unknown>;
    const sessionId =
      typeof data.sessionID === "string"
        ? data.sessionID
        : typeof info.draft.aggregateId === "string"
          ? info.draft.aggregateId
          : "global";

    switch (opencodeType) {
      case "session.created":
        this.handleSessionCreated(sessionId, data);
        break;
      case "session.compacted":
        this.handleSessionCompacted(sessionId, data);
        break;
      case "session.error":
        this.handleSessionError(sessionId, data);
        break;
      case "session.idle":
        this.handleSessionIdle(sessionId, data);
        break;
      case "plugin.added":
        this.handlePluginAdded(sessionId, data);
        break;
    }
  }

  // ── Per-event handlers ─────────────────────────────────────────────────

  private handleSessionCreated(sessionId: string, data: Record<string, unknown>): void {
    const existing = this.states.get(sessionId);
    if (existing) {
      // Re-entrant create (e.g. session reused): refresh status, do not
      // reset counters — they reflect the team's history.
      this.updateState(sessionId, {
        status: "active",
        lastSessionId: sessionId,
        lastUpdated: new Date().toISOString(),
      });
    } else {
      // New session → new team entry. Capability discovery runs at the
      // CapabilityDiscoveryEngine level (downstream); the bridge just
      // records the existence and seeds any tags the envelope carries.
      const inferredCapabilities = this.extractCapabilities(data);
      this.states.set(sessionId, {
        teamId: sessionId,
        team: this.existingTeams.get(sessionId),
        status: "active",
        lastSessionId: sessionId,
        lastUpdated: new Date().toISOString(),
        capabilities: inferredCapabilities,
        pluginCapabilities: [],
        compactionCount: 0,
        errorCount: 0,
        completionCount: 0,
      });
    }

    this.recordDerived("team:session-created", sessionId, {
      sessionId,
      capabilities: this.states.get(sessionId)?.capabilities ?? [],
    });
    const state = this.states.get(sessionId);
    if (state) this.emit("team-state-changed", state);
  }

  private handleSessionCompacted(sessionId: string, data: Record<string, unknown>): void {
    const state = this.ensureState(sessionId);
    this.updateState(sessionId, {
      compactionCount: state.compactionCount + 1,
      lastUpdated: new Date().toISOString(),
    });

    // Surface a derived "prediction window shifted" event so a downstream
    // consumer (future TruthAudit adapter / orchestrator hook) can
    // observe prediction-vs-reality resets after compaction. The bridge
    // doesn't import TruthAudit directly to avoid a circular dep — the
    // event is the contract. Today there is no in-process consumer; the
    // event flows out via the EventStore for observability.
    this.recordDerived("truth-audit:window-shifted", sessionId, {
      sessionId,
      compactionCount: state.compactionCount + 1,
      reason: typeof data.reason === "string" ? data.reason : "compaction",
    });
  }

  private handleSessionError(sessionId: string, data: Record<string, unknown>): void {
    const state = this.ensureState(sessionId);
    const errorMessage =
      typeof data.error === "string"
        ? data.error
        : typeof data.message === "string"
          ? data.message
          : "session error";
    this.updateState(sessionId, {
      status: "degraded",
      errorCount: state.errorCount + 1,
      lastError: errorMessage,
      lastUpdated: new Date().toISOString(),
    });

    this.recordDerived("team:degraded", sessionId, {
      sessionId,
      errorCount: state.errorCount + 1,
      error: errorMessage,
    });

    const after = this.states.get(sessionId);
    if (after) this.emit("team-state-changed", after);

    // Trigger replan once the error threshold is crossed.
    if (after && after.errorCount >= this.errorThreshold && this.onReplan) {
      const reason = `errorCount ${after.errorCount} >= threshold ${this.errorThreshold}: ${errorMessage}`;
      this.emit("replan", { teamId: sessionId, reason });
      try {
        this.onReplan({ teamId: sessionId, reason });
      } catch (err) {
        // Swallow callback errors so a broken replan hook doesn't
        // poison the rest of the bridge.
        // eslint-disable-next-line no-console
        console.warn(
          `[MetaSystemOpencodeBridge] onReplan callback failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  private handleSessionIdle(sessionId: string, data: Record<string, unknown>): void {
    const state = this.ensureState(sessionId);
    this.updateState(sessionId, {
      status: "completed",
      completionCount: state.completionCount + 1,
      lastUpdated: new Date().toISOString(),
    });

    this.recordDerived("team:task-completed", sessionId, {
      sessionId,
      completionCount: state.completionCount + 1,
      raw: data,
    });
    const after = this.states.get(sessionId);
    if (after) this.emit("team-state-changed", after);
  }

  private handlePluginAdded(sessionId: string, data: Record<string, unknown>): void {
    // plugin.added is workspace-scoped (no sessionID); fall back to the
    // global aggregate and broadcast to all teams.
    const pluginName = typeof data.name === "string" ? data.name : null;
    const pluginRole = typeof data.role === "string"
      ? data.role
      : typeof data.agent === "string"
        ? data.agent
        : null;
    if (!pluginName && !pluginRole) return;

    const tag = pluginRole ?? pluginName ?? "unknown";
    const teamIds = this.states.size > 0 ? [...this.states.keys()] : [sessionId];

    for (const teamId of teamIds) {
      const state = this.ensureState(teamId);
      if (!state.pluginCapabilities.includes(tag)) {
        this.updateState(teamId, {
          pluginCapabilities: [...state.pluginCapabilities, tag],
          lastUpdated: new Date().toISOString(),
        });
      }
    }

    this.recordDerived("capability:registered", sessionId, {
      capability: tag,
      pluginName,
      appliedTeams: teamIds,
    });
  }

  // ── Internal helpers ───────────────────────────────────────────────────

  /**
   * Get the current state for a team, creating a default `active` entry
   * if none exists. Used by handlers that may fire before any
   * `session.created` is observed (e.g. an error on a pre-existing
   * session).
   */
  private ensureState(teamId: string): TeamState {
    const existing = this.states.get(teamId);
    if (existing) return existing;
    const fresh: TeamState = {
      teamId,
      team: this.existingTeams.get(teamId),
      status: "active",
      lastSessionId: teamId,
      lastUpdated: new Date().toISOString(),
      capabilities: [],
      pluginCapabilities: [],
      compactionCount: 0,
      errorCount: 0,
      completionCount: 0,
    };
    this.states.set(teamId, fresh);
    return fresh;
  }

  /** Apply a partial update to a team's state and refresh `lastUpdated`. */
  private updateState(
    teamId: string,
    patch: Partial<Omit<TeamState, "teamId">>,
  ): void {
    const prev = this.states.get(teamId);
    if (!prev) return;
    const { lastUpdated: _ignored, ...rest } = patch as Partial<TeamState>;
    this.states.set(teamId, {
      ...prev,
      ...rest,
      lastUpdated: new Date().toISOString(),
    });
  }

  /** Extract any capability tags from a session.created payload. */
  private extractCapabilities(data: Record<string, unknown>): string[] {
    const out: string[] = [];
    if (typeof data.agent === "string") out.push(data.agent);
    if (Array.isArray(data.capabilities)) {
      for (const c of data.capabilities) {
        if (typeof c === "string") out.push(c);
      }
    }
    return out;
  }

  /**
   * Append a derived event to the EventStore so the orchestrator and
   * other reducers can observe the bridge's reactions. The event uses
   * the session id as aggregateId when present, else falls back to
   * the bridge's global aggregate.
   */
  private recordDerived(
    type: string,
    aggregateId: string,
    data: Record<string, unknown>,
  ): void {
    const aid = aggregateId && aggregateId !== "global" ? aggregateId : "meta-system";
    this.eventStore.append({ type, aggregateId: aid, data });
  }
}

// ── Re-export for tests / advanced consumers ──────────────────────────────

/** Exposed so tests can use the same handler surface as production. */
export const __testing = {
  HANDLED_OPENCODE_TYPES,
  isOpencodeEnvelope,
};

// Silence unused-var complaint while keeping the type import live.
export type { StoredEvent };
