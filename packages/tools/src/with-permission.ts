/**
 * with-permission — runtime gate that checks the current `Permissions` config
 * before letting a tool call reach the underlying executor.
 *
 *   - "allow" → pass through to the wrapped materialization
 *   - "deny"  → throw `PermissionDeniedError`
 *   - "ask"   → throw `PermissionRequestError`; the runtime is expected to
 *                catch this, emit an SSE event, park the task, and resume
 *                after the user answers.
 *
 * Both errors are typed and carry enough context (tool name, target, call id)
 * for the UI to render a clear prompt without re-running the match.
 */

import { resolvePermission, type Permissions, type ToolName, extractTarget } from "./permission.js"
import type { Materialization, ExecuteInput, Settlement } from "./registry.js"

// ── Errors ────────────────────────────────────────────────────────────────

/** Thrown when a call's permission is "deny". Never blocked on user input. */
export class PermissionDeniedError extends Error {
  readonly _tag = "PermissionDeniedError"
  readonly tool: ToolName
  readonly target: string
  readonly callId: string

  constructor(opts: { tool: ToolName; target: string; callId: string }) {
    super(`Permission denied: ${opts.tool} → ${JSON.stringify(opts.target)}`)
    this.name = "PermissionDeniedError"
    this.tool = opts.tool
    this.target = opts.target
    this.callId = opts.callId
  }
}

/**
 * Thrown when a call's permission is "ask". The runtime should surface this to
 * the user and only resume the task after the user approves/denies and the
 * config is reloaded.
 */
export class PermissionRequestError extends Error {
  readonly _tag = "PermissionRequestError"
  readonly tool: ToolName
  readonly target: string
  readonly callId: string
  /** Stable id for tracking the pending prompt across SSE reconnects. */
  readonly requestId: string

  constructor(opts: { tool: ToolName; target: string; callId: string; requestId: string }) {
    super(
      `Permission required: ${opts.tool} → ${JSON.stringify(opts.target)} ` +
        `(request ${opts.requestId})`,
    )
    this.name = "PermissionRequestError"
    this.tool = opts.tool
    this.target = opts.target
    this.callId = opts.callId
    this.requestId = opts.requestId
  }
}

export function isPermissionRequestError(err: unknown): err is PermissionRequestError {
  return err instanceof PermissionRequestError
}

export function isPermissionDeniedError(err: unknown): err is PermissionDeniedError {
  return err instanceof PermissionDeniedError
}

// ── Wrapper ──────────────────────────────────────────────────────────────

/** Anything that can give us a current permission config. May be async. */
export type PermissionProvider = Permissions | (() => Permissions) | (() => Promise<Permissions>)

async function resolveProvider(provider: PermissionProvider): Promise<Permissions> {
  if (typeof provider === "function") return await provider()
  return provider
}

function isToolName(name: string): name is ToolName {
  // The ToolName union lives in permission.ts; replicate the membership check
  // here to avoid a circular import. Keep in sync with TOOL_NAMES.
  return (["bash", "read", "write", "edit", "glob", "grep"] as const).some(
    (t) => t === name,
  )
}

function newRequestId(): string {
  // Short, sortable, no external deps.
  return `prq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Wrap an existing `Materialization` so that every `settle` call first checks
 * the current permission for the tool. The same `definitions` are passed
 * through unchanged — the wrapper only gates execution.
 */
export function withPermission(
  inner: Materialization,
  provider: PermissionProvider,
): Materialization {
  return {
    definitions: inner.definitions,
    async settle(input: ExecuteInput): Promise<Settlement> {
      if (!isToolName(input.call.name)) {
        // Unknown tool — let the inner executor raise its own error.
        return inner.settle(input)
      }
      const tool = input.call.name
      const config = await resolveProvider(provider)
      const target = extractTarget(tool, input.call.input)
      const decision = resolvePermission(tool, input.call.input, config)

      switch (decision) {
        case "allow":
          return inner.settle(input)
        case "deny":
          throw new PermissionDeniedError({
            tool,
            target,
            callId: input.call.id,
          })
        case "ask":
          throw new PermissionRequestError({
            tool,
            target,
            callId: input.call.id,
            requestId: newRequestId(),
          })
      }
    },
  }
}
