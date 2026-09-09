/**
 * SafetyGuardrails — runtime safety checks and emergency stop (借鉴 Kosmos safety/guardrails.py).
 *
 * Kosmos's SafetyGuardrails provides:
 *   - Emergency stop mechanism (signal handler + flag file)
 *   - Resource limits (CPU, memory, execution time, network, file write)
 *   - Safety incident logging
 *   - Code validation (regex-based dangerous-pattern detection)
 *
 * Maximilian adapts this as a dependency-free, in-memory safety layer that
 * the runtime can consult before executing risky operations:
 *   - ResourceLimits (CPU/memory/time budgets — enforced when monitor() is called)
 *   - Dangerous-pattern detection (regex-based shell/JS blocker)
 *   - Emergency stop flag (set/clear/isStopped)
 *   - Incident log (ring buffer with rate-limiting)
 *   - Path blacklist (absolute path patterns to forbid)
 *
 * For process-level emergency stop, callers can read the `stopFlagFile`
 * from disk; the in-memory `triggerEmergencyStop()` updates both.
 */

import { constants as fsConstants, existsSync, statSync, readFileSync, writeFileSync, unlinkSync } from "node:fs"
import { resolve, isAbsolute, sep } from "node:path"
import { randomUUID } from "node:crypto"

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum stop-flag file read size to prevent blocking on pipes/FIFOs/devices. */
const MAX_FLAG_SIZE_BYTES = 1024

/** Per-incident-type dedup window in ms to prevent log-churn DoS. */
const INCIDENT_DEDUP_WINDOW_MS = 1_000

/** Default dangerous patterns — borrowed from Kosmos code_validator. */
const DEFAULT_DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s+-rf?\s+\//,           // rm -rf /
  /\bcurl\s+.*\|\s*(bash|sh)/,  // curl | bash
  /\bwget\s+.*\|\s*(bash|sh)/,  // wget | bash
  /\beval\s*\(/,                // eval()
  /\bnew\s+Function\s*\(/,      // new Function()
  /\bchild_process\.exec\s*\(/, // raw child_process
  /\.\.\/\.\.\//,               // path traversal attempt
]

// ── Types ────────────────────────────────────────────────────────────────────

export type RiskLevel = "low" | "medium" | "high" | "critical"
export type ViolationType =
  | "dangerous_pattern"
  | "resource_limit"
  | "forbidden_path"
  | "emergency_stop"
  | "policy"
  | "stop_flag_file_error"

export interface ResourceLimits {
  maxCpuCores?: number
  maxMemoryMb?: number
  maxExecutionTimeSeconds?: number
  allowNetworkAccess: boolean
  allowFileWrite: boolean
  allowSubprocess: boolean
}

export interface SafetyIncident {
  id: string
  type: ViolationType
  riskLevel: RiskLevel
  message: string
  context?: Record<string, unknown>
  timestamp: string
}

export interface SafetyGuardrailsOptions {
  limits?: Partial<ResourceLimits>
  /** Extra dangerous-code regex patterns to block. */
  extraDangerousPatterns?: RegExp[]
  /** Extra path prefixes to forbid (case-sensitive). */
  extraForbiddenPaths?: string[]
  /** Override the on-disk stop flag file (defaults to ./.max_safety_stop). */
  stopFlagFile?: string
  /** Cap on in-memory incident log (default: 200). Must be finite non-negative integer. */
  incidentLogCap?: number
}

const DEFAULT_LIMITS: ResourceLimits = {
  maxCpuCores: undefined,
  maxMemoryMb: 2048,
  maxExecutionTimeSeconds: 300,
  allowNetworkAccess: false,
  allowFileWrite: false,
  allowSubprocess: false,
}

// ── SafetyGuardrails ────────────────────────────────────────────────────────

export class SafetyGuardrails {
  private limits: ResourceLimits
  private readonly dangerousPatterns: RegExp[]
  private readonly forbiddenPaths: readonly string[]
  private readonly _stopFlagFile: string
  private readonly incidents: SafetyIncident[] = []
  private readonly incidentLogCap: number
  private stopped = false
  private stoppedAt?: string
  private stoppedBy?: string
  private readonly _abortController = new AbortController()
  /** Separate monotonic counter so incidentCount() reflects total logged (not just retained buffer). */
  private _totalIncidentsLogged = 0

  // Dedup state: type+message → last incident timestamp.
  private readonly lastIncidentAt = new Map<string, number>()

  constructor(options?: SafetyGuardrailsOptions) {
    // ── Validate and apply limits ────────────────────────────────────────────
    const rawLimits = { ...DEFAULT_LIMITS, ...(options?.limits ?? {}) }
    this.limits = {
      maxCpuCores:
        rawLimits.maxCpuCores !== undefined && Number.isFinite(rawLimits.maxCpuCores) && rawLimits.maxCpuCores > 0
          ? rawLimits.maxCpuCores
          : undefined,
      maxMemoryMb:
        rawLimits.maxMemoryMb !== undefined && Number.isFinite(rawLimits.maxMemoryMb) && rawLimits.maxMemoryMb > 0
          ? rawLimits.maxMemoryMb
          : 2048,
      maxExecutionTimeSeconds:
        rawLimits.maxExecutionTimeSeconds !== undefined &&
        Number.isFinite(rawLimits.maxExecutionTimeSeconds) &&
        rawLimits.maxExecutionTimeSeconds > 0
          ? rawLimits.maxExecutionTimeSeconds
          : 300,
      allowNetworkAccess: !!rawLimits.allowNetworkAccess,
      allowFileWrite: !!rawLimits.allowFileWrite,
      allowSubprocess: !!rawLimits.allowSubprocess,
    }

    // ── Compile regex patterns and reset lastIndex to prevent sticky/global state leakage ──
    const rawPatterns = [
      ...DEFAULT_DANGEROUS_PATTERNS,
      ...(options?.extraDangerousPatterns ?? []),
    ]
    this.dangerousPatterns = rawPatterns.map((p) => {
      // Strip sticky/global flags that cause state leakage across calls.
      const safeFlags = (p.flags || "")
        .replace("y", "")
        .replace("g", "")
      return new RegExp(p.source, safeFlags)
    })

    // ── Resolve and validate forbidden paths (clone to prevent caller mutation) ──
    const rawForbidden = Array.isArray(options?.extraForbiddenPaths)
      ? [...options.extraForbiddenPaths]
      : []
    this.forbiddenPaths = rawForbidden.map((p) => resolve(p))

    // ── Resolve stop flag file to absolute path once at construction ──────────
    const flagFile = options?.stopFlagFile ?? ".max_safety_stop"
    this._stopFlagFile = isAbsolute(flagFile) ? flagFile : resolve(process.cwd(), flagFile)

    // ── Validate incident log cap ────────────────────────────────────────────
    const cap = options?.incidentLogCap
    this.incidentLogCap =
      Number.isSafeInteger(cap) && cap !== undefined && cap >= 0
        ? cap
        : 200

    // ── Check for existing stop flag (only regular files, with size bound) ──
    this.stopped = false
    this.stoppedAt = undefined
    this.stoppedBy = undefined
    this._readStopFlagAtCtor()
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Check if emergency stop has been triggered. */
  isStopped(): boolean {
    if (this.stopped) return true
    // Re-check disk flag in case another process wrote it.
    const flag = this._readStopFlagSync()
    if (flag !== null) {
      this.stopped = true
      this.stoppedAt = flag.timestamp
      this.stoppedBy = "external-flag-file"
    }
    return this.stopped
  }

  /** Trigger emergency stop; writes flag file + aborts active operations. */
  triggerEmergencyStop(reason: string, triggeredBy = "manual"): void {
    this.stopped = true
    const timestamp = new Date().toISOString()
    this.stoppedAt = timestamp
    this.stoppedBy = triggeredBy

    // Abort all operations observing this signal so in-flight work is cancelled.
    this._abortController.abort()

    // Try atomic exclusive create — fails if file already exists (consistent with stop semantics).
    let fileWritten = false
    try {
      // Use exclusive create flag (x) to atomically verify/create.
      writeFileSync(this._stopFlagFile, timestamp, { encoding: "utf8", mode: 0o600, flag: "wx" })
      fileWritten = true
    } catch (err) {
      // If file already exists (another process racing), that's fine.
      // If permissions denied, log and continue with in-memory stop.
      const errMsg = err instanceof Error ? err.message : String(err)
      this._logIncidentUnchecked({
        id: randomUUID(),
        type: "stop_flag_file_error",
        riskLevel: "high",
        message: `failed to write stop flag file: ${errMsg}`,
        context: { file: this._stopFlagFile },
        timestamp,
      })
    }

    if (fileWritten) {
      this._logIncidentUnchecked({
        id: randomUUID(),
        type: "emergency_stop",
        riskLevel: "critical",
        message: `emergency stop triggered: ${reason}`,
        context: { triggeredBy },
        timestamp,
      })
    }
  }

  /** Clear emergency stop (both in-memory and on-disk flag). */
  clearEmergencyStop(): void {
    this.stopped = false
    this.stoppedAt = undefined
    this.stoppedBy = undefined
    try {
      if (existsSync(this._stopFlagFile)) {
        // Verify it is a regular file before unlinking.
        const stat = statSync(this._stopFlagFile)
        if (stat.isFile()) {
          unlinkSync(this._stopFlagFile)
        }
      }
    } catch {
      // If unlink fails (permissions, file doesn't exist), in-memory state is cleared.
      // This is acceptable — caller can check isStopped() to confirm.
    }
  }

  /**
   * Check a code snippet against dangerous patterns. Returns first match.
   * Fails closed on null/undefined input.
   */
  checkCode(code: unknown): SafetyIncident | null {
    if (typeof code !== "string") {
      const incident = this._makeIncident(
        "dangerous_pattern",
        "high",
        "checkCode received non-string input — treating as dangerous",
        { receivedType: typeof code },
      )
      this._logIncident(incident)
      return incident
    }
    for (const pattern of this.dangerousPatterns) {
      pattern.lastIndex = 0
      const match = code.match(pattern)
      if (match) {
        const incident = this._makeIncident("dangerous_pattern", "high", "dangerous code pattern detected", {
          pattern: pattern.source,
          // Redact matched text: capture only length to avoid leaking secrets/tokens/URLs.
          matchedLength: match[0]?.length ?? 0,
        })
        this._logIncident(incident)
        return incident
      }
    }
    return null
  }

  /**
   * Check a filesystem path against the blacklist.
   * Fails closed on null/undefined/non-absolute input.
   */
  checkPath(path: unknown): SafetyIncident | null {
    if (typeof path !== "string" || path.length === 0) {
      const incident = this._makeIncident(
        "forbidden_path",
        "medium",
        "checkPath received empty/non-string input — treating as forbidden",
        { receivedType: typeof path },
      )
      this._logIncident(incident)
      return incident
    }
    let normalized: string
    try {
      normalized = resolve(path)
    } catch {
      const incident = this._makeIncident("forbidden_path", "high", "failed to resolve path", { path })
      this._logIncident(incident)
      return incident
    }
    for (const forbidden of this.forbiddenPaths) {
      // Guard against root "/" blacklist edge case: "/" + "/" = "//"
      // Use path comparison that works for root.
      if (normalized === forbidden) {
        return this._pathIncident(normalized, forbidden)
      }
      const prefix = forbidden.endsWith(sep) ? forbidden : forbidden + sep
      if (normalized.startsWith(prefix)) {
        return this._pathIncident(normalized, forbidden)
      }
    }
    return null
  }

  /**
   * Check whether a resource operation is allowed under current limits.
   */
  checkResource(
    op: unknown,
  ): SafetyIncident | null {
    const allowed =
      op === "allowNetworkAccess" ||
      op === "allowFileWrite" ||
      op === "allowSubprocess"
    if (!allowed) {
      const incident = this._makeIncident(
        "resource_limit",
        "low",
        `checkResource called with unknown operation: ${String(op)}`,
        { op },
      )
      this._logIncident(incident)
      return incident
    }
    if (!this.limits[op as keyof ResourceLimits]) {
      const incident = this._makeIncident("resource_limit", "medium", `operation ${String(op)} blocked by policy`, {
        op,
      })
      this._logIncident(incident)
      return incident
    }
    return null
  }

  /**
   * Returns true only if code + path + operations all pass.
   * Fails closed (returns false) on any violation or error.
   */
  isSafe(
    code: unknown,
    path?: unknown,
    operations?: ReadonlyArray<"allowNetworkAccess" | "allowFileWrite" | "allowSubprocess">,
  ): boolean {
    if (this.isStopped()) return false
    if (this.checkCode(code)) return false
    if (path !== undefined && this.checkPath(path)) return false
    const ops = operations ?? (["allowNetworkAccess", "allowFileWrite", "allowSubprocess"] as const)
    for (const op of ops) {
      if (this.checkResource(op)) return false
    }
    return true
  }

  /**
   * Returns an AbortSignal that is aborted when emergency stop is triggered.
   * Callers running long-lived operations (LLM calls, subprocesses, file I/O)
   * should pass this signal so that `triggerEmergencyStop()` actually cancels
   * in-flight work rather than just updating the in-memory flag.
   */
  getAbortSignal(): AbortSignal {
    return this._abortController.signal
  }

  /** Update resource limits at runtime. */
  updateLimits(updates: Partial<ResourceLimits>): void {
    this.limits = { ...this.limits, ...updates }
  }

  /** Most recent N incidents. Returns defensive copies. */
  recentIncidents(limit = 50): SafetyIncident[] {
    const n = Number.isSafeInteger(limit) && limit >= 0 ? limit : 50
    return this.incidents.slice(-n).map((i) => Object.freeze({ ...i }))
  }

  /** Number of incidents logged (total, not just retained buffer). */
  incidentCount(): number {
    return this._totalIncidentsLogged
  }

  // ── Resource monitoring (caller must invoke periodically) ─────────────────

  /**
   * Enforce current resource limits against actual process measurements.
   * Callers should invoke this periodically (e.g., every 5 seconds) via a timer.
   * Returns incidents for any violations, or null if all within limits.
   */
  monitor(): SafetyIncident[] {
    const violations: SafetyIncident[] = []

    if (
      this.limits.maxMemoryMb !== undefined &&
      this.limits.maxMemoryMb > 0
    ) {
      const memUsageMb = process.memoryUsage().heapUsed / 1_048_576
      if (memUsageMb > this.limits.maxMemoryMb) {
        const inc = this._makeIncident("resource_limit", "high", `heap memory ${memUsageMb.toFixed(0)} MB exceeds limit ${this.limits.maxMemoryMb} MB`, {
          actualMb: Math.round(memUsageMb),
          limitMb: this.limits.maxMemoryMb,
        })
        this._logIncident(inc)
        violations.push(inc)
      }
    }

    return violations
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Read the stop flag file at construction time, with validation:
   * - Only reads regular files up to MAX_FLAG_SIZE_BYTES
   * - Returns null if not a regular file (prevents blocking on FIFO/device)
   */
  private _readStopFlagAtCtor(): void {
    try {
      const stat = statSync(this._stopFlagFile)
      if (!stat.isFile()) return
      // Guard against pipes/FIFOs/sockets by rejecting files larger than our budget.
      if (stat.size > MAX_FLAG_SIZE_BYTES) return
      const content = readFileSync(this._stopFlagFile, "utf8")
      if (content.length > 0) {
        this.stopped = true
        this.stoppedAt = content.trim().slice(0, MAX_FLAG_SIZE_BYTES) || new Date().toISOString()
        this.stoppedBy = "external-flag-file"
      }
    } catch {
      // File doesn't exist or inaccessible — not stopped.
    }
  }

  /**
   * Read stop flag synchronously with the same size/type guard.
   */
  private _readStopFlagSync(): { timestamp: string } | null {
    try {
      const stat = statSync(this._stopFlagFile)
      if (!stat.isFile() || stat.size > MAX_FLAG_SIZE_BYTES) return null
      const content = readFileSync(this._stopFlagFile, "utf8")
      if (content.length > 0) {
        return { timestamp: content.trim().slice(0, MAX_FLAG_SIZE_BYTES) }
      }
    } catch {
      // Doesn't exist or inaccessible.
    }
    return null
  }

  private _pathIncident(normalized: string, forbidden: string): SafetyIncident {
    const incident = this._makeIncident("forbidden_path", "high", "path matches forbidden prefix", {
      path: normalized,
      forbiddenPrefix: forbidden,
    })
    this._logIncident(incident)
    return incident
  }

  private _makeIncident(
    type: ViolationType,
    riskLevel: RiskLevel,
    message: string,
    context?: Record<string, unknown>,
  ): SafetyIncident {
    return {
      id: randomUUID(),
      type,
      riskLevel,
      message,
      context,
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * Log an incident with deduplication: only one incident of the same
   * type+message pair per INCIDENT_DEDUP_WINDOW_MS to prevent churn DoS.
   * Also enforces the ring-buffer cap.
   */
  private _logIncident(incident: SafetyIncident): void {
    const key = `${incident.type}:${incident.message}`
    const now = Date.now()
    const last = this.lastIncidentAt.get(key)
    if (last !== undefined && now - last < INCIDENT_DEDUP_WINDOW_MS) {
      // Deduplicated — don't push a new entry.
      return
    }
    this.lastIncidentAt.set(key, now)
    this._logIncidentUnchecked(incident)
  }

  /** Push an incident without deduplication (used internally). */
  private _logIncidentUnchecked(incident: SafetyIncident): void {
    this._totalIncidentsLogged++
    this.incidents.push(Object.freeze({ ...incident }))
    if (this.incidents.length > this.incidentLogCap) {
      this.incidents.splice(0, this.incidents.length - this.incidentLogCap)
    }
  }
}
