// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * OpencodePermissionTranslator — bridge between Maximilian's
 * `allow | ask | deny` permission vocabulary and opencode's permission
 * events + `permission.ask` hook status vocabulary.
 *
 * 借鉴 opencode:
 *   - Maximilian `Permission` ("allow" | "ask" | "deny") ↔ opencode
 *     `PermissionAction` ("allow" | "ask" | "deny") — same enum, but
 *     carried in different fields (Maximilian stores on the tool side,
 *     opencode on the rule/event side).
 *   - Maximilian's `Permission` decisions and opencode's `PermissionV2Reply`
 *     ("once" | "always" | "reject") are NOT the same axis: the Maximilian
 *     decision is *what the policy says*, while the opencode reply is
 *     *what the user just answered to a single prompt*. We translate the
 *     decision axis only; "ask" maps to "ask" (defer), "allow" to "allow"
 *     (treat as approved), and "deny" to "deny" (treat as rejected).
 *   - The Maximilian runtime is the source of truth: when an opencode
 *     `permission.v2.asked` event arrives, the translator lifts it into
 *     a `PermissionAskedEvent` shape and asks Maximilian's resolver to
 *     decide. When Maximilian replies, the translator lowers the decision
 *     back into opencode's `permission.ask` hook output.
 *
 * This translator is the *boundary* between Maximilian's permission
 * config (in `~/.maximilian/permissions.json`) and opencode's plugin
 * permission model (`@opencode-ai/plugin` `permission.ask` hook +
 * `PermissionRuleset`).
 */

import type { Permission, Permissions, ToolName } from "./permission.js"

// ── opencode-side types (mirrors @opencode-ai/plugin + v2 SDK) ──────────

/**
 * 借鉴 opencode - `PermissionAction` from
 * `packages/sdk/js/src/v2/gen/types.gen.ts` and the `permission.ask`
 * hook output vocabulary from
 * `packages/plugin/src/index.ts:Hooks["permission.ask"]`.
 *
 * Values:
 *   - "allow" → the policy permits the call
 *   - "deny"  → the policy forbids the call (never prompts)
 *   - "ask"   → the policy requires user interaction
 */
export type OpencodePermissionAction = "allow" | "deny" | "ask"

/**
 * 借鉴 opencode - `PermissionV2Reply` from
 * `packages/sdk/js/src/v2/gen/types.gen.ts` (line ~3128).
 *
 * Carried on `permission.v2.replied` events when the user answers a
 * pending prompt. Not a decision by itself — it's an acknowledgement
 * of *one prompt* — but the Maximilian runtime can decide to persist
 * a `Permission` rule based on whether "always" was chosen.
 */
export type OpencodePermissionReply = "once" | "always" | "reject"

/**
 * Shape of a `permission.v2.asked` event from the opencode SSE stream,
 * after it has been lifted by `event-mapping.ts:mapPermissionAsked`
 * into a Maximilian `StoredEvent.data`. We accept a structural subset
 * rather than the full envelope so the translator is decoupled from
 * the bridge's mapping table.
 *
 * 借鉴 opencode - `PermissionV2Asked` from
 * `packages/sdk/js/src/v2/gen/types.gen.ts` (~line 5439).
 */
export interface OpencodePermissionAskedEvent {
  /** "permission.asked" | "permission.v2.asked" */
  type: "permission.asked" | "permission.v2.asked"
  /** Maximilian-side request id (event-mapping.ts uses data.id || data.requestID). */
  id: string
  sessionID: string
  /** Tool name (e.g. "bash", "edit", "read"). */
  action?: string
  /** v2 resource strings (paths / globs). */
  resources?: string[]
  /** v2 patterns that should be remembered for "always". */
  save?: string[]
  metadata?: Record<string, unknown>
  /** v1 compat — `pattern` (string or string[]) on the event itself. */
  permission?: string
  patterns?: string[]
  /** v2 source — the tool call that triggered this prompt. */
  source?: { type: "tool"; messageID: string; callID: string }
}

/**
 * Shape of a `permission.v2.replied` event.
 * 借鉴 opencode - `PermissionV2Replied` (types.gen.ts ~line 5461).
 */
export interface OpencodePermissionRepliedEvent {
  /** "permission.replied" | "permission.v2.replied" */
  type: "permission.replied" | "permission.v2.replied"
  sessionID: string
  /** The `requestID` of the prompt being answered. */
  requestID: string
  reply: OpencodePermissionReply
}

// ── translator ──────────────────────────────────────────────────────────

/**
 * `OpencodePermissionTranslator` is a stateless utility — it is exposed
 * as a class so callers can mock it / DI it the same way they mock the
 * Maximilian `permission.ts` module. All public methods are pure
 * functions of their inputs.
 */
export class OpencodePermissionTranslator {
  /**
   * Translate a Maximilian `Permission` decision into opencode's
   * `permission.ask` hook output vocabulary.
   *
   * Both sides share the same `allow | ask | deny` enum so this is
   * essentially a typed identity, but we keep the explicit mapping so
   * the translation boundary is reviewable and so a future Maximilian
   * rename ("allow" → "permit") has one obvious place to fix.
   *
   *   - "allow" → "allow" (let the tool run)
   *   - "ask"   → "ask"   (defer to user prompt)
   *   - "deny"  → "deny"  (block the tool)
   *
   * Throws `Error` on unknown input — callers should validate before
   * invoking. We never silently coerce an invalid value because that
   * would mask a permissions-file corruption bug.
   */
  toOpencodePermission(perm: Permission): OpencodePermissionAction {
    switch (perm) {
      case "allow":
        return "allow"
      case "ask":
        return "ask"
      case "deny":
        return "deny"
      default: {
        // Exhaustiveness check. If `Permission` grows a new variant
        // the translator fails loudly at the boundary, not silently
        // downstream.
        const exhaustive: never = perm
        throw new Error(
          `OpencodePermissionTranslator.toOpencodePermission: unknown permission "${String(
            exhaustive,
          )}"`,
        )
      }
    }
  }

  /**
   * Reverse-direction helper for the `permission.ask` hook input
   * (opencode → Maximilian). Most callers won't need this — opencode
   * speaks the same enum — but it's kept symmetric so the translator
   * is bidirectional and round-trippable in tests.
   */
  fromOpencodePermissionAction(action: OpencodePermissionAction): Permission {
    switch (action) {
      case "allow":
        return "allow"
      case "ask":
        return "ask"
      case "deny":
        return "deny"
      default: {
        const exhaustive: never = action
        throw new Error(
          `OpencodePermissionTranslator.fromOpencodePermissionAction: unknown action "${String(
            exhaustive,
          )}"`,
        )
      }
    }
  }

  /**
   * Translate an opencode `PermissionV2Reply` into a *suggested* Maximilian
   * `Permission` decision that the runtime may persist.
   *
   *   - "once"   → "allow" for this prompt only (no rule written)
   *   - "always" → "allow" and the runtime should save a `patterns[tool][pat] = "allow"`
   *                rule for each entry in `savePatterns`
   *   - "reject" → "deny"
   *
   * The translator does NOT touch the Maximilian `Permissions` store
   * directly — it returns a `TranslatedReply` describing what should
   * happen. Persistence is the caller's responsibility so the runtime
   * can decide on its own audit / undo semantics.
   *
   * `savePatterns` is supplied by the caller (the v2 protocol carries
   * the `save` array on the original `permission.v2.asked` event, not
   * on the replied event). Pass an empty array if the original event
   * had no `save`.
   */
  fromOpencodePermissionReply(
    reply: OpencodePermissionReply,
    savePatterns?: ReadonlyArray<string>,
  ): TranslatedReply {
    switch (reply) {
      case "once":
        return { decision: "allow", persist: false, patterns: [] }
      case "always":
        return {
          decision: "allow",
          persist: true,
          patterns: savePatterns ? [...savePatterns] : [],
        }
      case "reject":
        return { decision: "deny", persist: false, patterns: [] }
      default: {
        const exhaustive: never = reply
        throw new Error(
          `OpencodePermissionTranslator.fromOpencodePermissionReply: unknown reply "${String(
            exhaustive,
          )}"`,
        )
      }
    }
  }

  /**
   * Translate an opencode `permission.v2.asked` event into a
   * Maximilian `(tool, target, input)` triple that `resolvePermission`
   * can act on.
   *
   * The mapping:
   *   - `event.action` → tool name (e.g. "bash", "edit"). Falls back to
   *     `event.metadata.tool` if `action` is absent on v1 events.
   *   - `event.resources[0]` → path/command target. Falls back to the
   *     `event.patterns[0]` for v1 events.
   *   - `event.source.callID` → the `callId` field used by
   *     `PermissionRequestError` so a thrown error can be correlated
   *     with the opencode tool call when the runtime unparks the task.
   *
   * The caller is expected to pass the translated triple into
   * `resolvePermission(tool, input, config)`. We return both the
   * translation and a `suggested` hint so the caller can decide
   * whether to actually invoke the resolver (e.g. skip when
   * `event.source` already tells us the answer).
   */
  toMaximilianToolInput(
    event: OpencodePermissionAskedEvent,
  ): { tool: ToolName; target: string; input: Record<string, unknown> } {
    const tool = pickToolName(event)
    const target = pickTarget(event)
    // Construct an `input` object that Maximilian's `extractTarget`
    // understands. bash uses `command`; file tools use `path`; glob/grep
    // fall back to `path` first then `pattern`.
    const input: Record<string, unknown> = (() => {
      if (tool === "bash") return { command: target }
      return { path: target }
    })()
    return { tool, target, input }
  }

  /**
   * Build a `Permissions` config from a translated `TranslatedReply`
   * — used by callers that want to apply a "always" reply by writing
   * a rule under `patterns[tool][pattern] = "allow"`.
   *
   * Returns a *new* `Permissions` object; the input is not mutated.
   * Patterns are de-duplicated and merged with any existing entries.
   */
  applyReplyToPermissions(
    base: Permissions,
    tool: ToolName,
    translated: TranslatedReply,
  ): Permissions {
    if (!translated.persist || translated.patterns.length === 0) return base
    const next: Permissions = {
      defaults: { ...base.defaults },
      patterns: { ...base.patterns },
    }
    const existing = next.patterns[tool] ?? {}
    const merged: Record<string, Permission> = { ...existing }
    for (const pattern of translated.patterns) {
      // "always" → "allow" so future matches skip the prompt.
      merged[pattern] = "allow"
    }
    next.patterns[tool] = merged
    return next
  }
}

/** Result of `fromOpencodePermissionReply`. */
export interface TranslatedReply {
  /**
   * The Maximilian decision implied by the user's reply.
   *   - "once"   → "allow"
   *   - "always" → "allow"
   *   - "reject" → "deny"
   */
  decision: Permission
  /**
   * `true` if the caller should persist a pattern rule. Only
   * `reply === "always"` sets this.
   */
  persist: boolean
  /**
   * Pattern strings to write under `patterns[tool]` if `persist` is
   * `true`. Sourced from `event.save` on v2 events.
   */
  patterns: string[]
}

// ── helpers ─────────────────────────────────────────────────────────────

/**
 * Map opencode's `event.action` (or `event.metadata.action`) to a
 * Maximilian `ToolName`. We accept a narrow allow-list because the
 * Maximilian permission resolver only knows six tools; anything else
 * falls back to "bash" so a future opencode tool still gets routed
 * through the dangerous-command path instead of silently bypassing
 * permission checks.
 */
function pickToolName(event: OpencodePermissionAskedEvent): ToolName {
  const candidate =
    event.action ??
    (typeof event.metadata?.["tool"] === "string"
      ? (event.metadata["tool"] as string)
      : undefined)
  switch (candidate) {
    case "bash":
    case "read":
    case "write":
    case "edit":
    case "glob":
    case "grep":
      return candidate
    default:
      // Unknown tool → default to bash so DANGEROUS_PATTERNS still
      // run against the command string before it executes.
      return "bash"
  }
}

/**
 * Pull the most relevant "target" string out of the event.
 *
 * Priority:
 *   1. `resources[0]`            (v2 paths)
 *   2. `patterns[0]`             (v1 glob patterns)
 *   3. `permission`              (v1 single-pattern fallback)
 *   4. `metadata.path` / `metadata.command`
 *   5. `""`                      (Maximilian treats empty as "no target")
 */
function pickTarget(event: OpencodePermissionAskedEvent): string {
  const resources = event.resources
  if (Array.isArray(resources) && resources.length > 0 && typeof resources[0] === "string") {
    return resources[0] as string
  }
  const patterns = event.patterns
  if (Array.isArray(patterns) && patterns.length > 0 && typeof patterns[0] === "string") {
    return patterns[0] as string
  }
  if (typeof event.permission === "string" && event.permission.length > 0) {
    return event.permission
  }
  const meta = event.metadata ?? {}
  if (typeof meta["path"] === "string") return meta["path"] as string
  if (typeof meta["command"] === "string") return meta["command"] as string
  return ""
}

// ── factory ─────────────────────────────────────────────────────────────

/** Convenience factory so callers can `import { createTranslator }`. */
export function createOpencodePermissionTranslator(): OpencodePermissionTranslator {
  return new OpencodePermissionTranslator()
}
