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
 *   - ResourceLimits (CPU/memory/time budgets)
 *   - Dangerous-pattern detection (regex-based shell/JS blocker)
 *   - Emergency stop flag (set/clear/isStopped)
 *   - Incident log (ring buffer)
 *   - Path blacklist (absolute path patterns to forbid)
 *
 * For process-level emergency stop, callers can read the `STOP_FLAG_FILE`
 * from disk; the in-memory `triggerEmergencyStop()` updates both.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs"
import { resolve } from "node:path"

export type RiskLevel = "low" | "medium" | "high" | "critical"
export type ViolationType =
  | "dangerous_pattern"
  | "resource_limit"
  | "forbidden_path"
  | "emergency_stop"
  | "policy"

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
  /** Cap on in-memory incident log (default: 200). */
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

/** Default dangerous patterns — borrowed from Kosmos code_validator. */
const DEFAULT_DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s+-rf?\s+\//,           // rm -rf /
  /\bcurl\s+.*\|\s*(bash|sh)/,  // curl | bash
  /\bwget\s+.*\|\s*(bash|sh)/,  // wget | bash
  /\beval\s*\(/,                // eval()
  /\bnew\s+Function\s*\(/,      // new Function()
  /\bchild_process\.exec\s*\(/, // raw child_process
  /process\.env\.[A-Z_]+/,      // env var reference (sometimes risky)
  /\.\.\/\.\.\//,               // path traversal attempt
]

export class SafetyGuardrails {
  private limits: ResourceLimits
  private readonly dangerousPatterns: RegExp[]
  private readonly forbiddenPaths: string[]
  private readonly stopFlagFile: string
  private readonly incidents: SafetyIncident[] = []
  private readonly incidentLogCap: number
  private stopped = false
  private stoppedAt?: string
  private stoppedBy?: string

  constructor(options?: SafetyGuardrailsOptions) {
    this.limits = { ...DEFAULT_LIMITS, ...(options?.limits ?? {}) }
    this.dangerousPatterns = [
      ...DEFAULT_DANGEROUS_PATTERNS,
      ...(options?.extraDangerousPatterns ?? []),
    ]
    this.forbiddenPaths = options?.extraForbiddenPaths ?? []
    this.stopFlagFile = options?.stopFlagFile ?? resolve(process.cwd(), ".max_safety_stop")
    this.incidentLogCap = options?.incidentLogCap ?? 200

    // If a stop flag exists on disk at construction, honor it.
    if (existsSync(this.stopFlagFile)) {
      this.stopped = true
      this.stoppedAt = readFileSync(this.stopFlagFile, "utf8").trim() || new Date().toISOString()
      this.stoppedBy = "external-flag-file"
    }
  }

  /** Check if emergency stop has been triggered. */
  isStopped(): boolean {
    // Re-check disk flag in case another process wrote it.
    if (!this.stopped && existsSync(this.stopFlagFile)) {
      this.stopped = true
      this.stoppedAt = readFileSync(this.stopFlagFile, "utf8").trim() || new Date().toISOString()
      this.stoppedBy = "external-flag-file"
    }
    return this.stopped
  }

  /** Trigger emergency stop; writes flag file + records incident. */
  triggerEmergencyStop(reason: string, triggeredBy = "manual"): void {
    this.stopped = true
    this.stoppedAt = new Date().toISOString()
    this.stoppedBy = triggeredBy
    try {
      writeFileSync(this.stopFlagFile, this.stoppedAt, "utf8")
    } catch {
      // Best-effort; in-memory state still applies.
    }
    const incident = this.makeIncident("emergency_stop", "critical", reason, { triggeredBy })
    this.logIncident(incident)
  }

  /** Clear emergency stop (both in-memory and on-disk flag). */
  clearEmergencyStop(): void {
    this.stopped = false
    this.stoppedAt = undefined
    this.stoppedBy = undefined
    try {
      if (existsSync(this.stopFlagFile)) unlinkSync(this.stopFlagFile)
    } catch {
      // Ignore.
    }
  }

  /** Check a code snippet against dangerous patterns. Returns first match. */
  checkCode(code: string): SafetyIncident | null {
    for (const pattern of this.dangerousPatterns) {
      const match = code.match(pattern)
      if (match) {
        const incident = this.makeIncident("dangerous_pattern", "high", "dangerous code pattern detected", {
          pattern: pattern.source,
          matchedText: match[0],
        })
        this.logIncident(incident)
        return incident
      }
    }
    return null
  }

  /** Check a filesystem path against the blacklist. */
  checkPath(path: string): SafetyIncident | null {
    const normalized = resolve(path)
    for (const forbidden of this.forbiddenPaths) {
      const prefix = resolve(forbidden)
      if (normalized === prefix || normalized.startsWith(prefix + "/")) {
        const incident = this.makeIncident("forbidden_path", "high", "path matches forbidden prefix", {
          path: normalized,
          forbiddenPrefix: prefix,
        })
        this.logIncident(incident)
        return incident
      }
    }
    return null
  }

  /** Check whether a resource operation is allowed under current limits. */
  checkResource(op: keyof Pick<ResourceLimits, "allowNetworkAccess" | "allowFileWrite" | "allowSubprocess">): SafetyIncident | null {
    if (!this.limits[op]) {
      const incident = this.makeIncident("resource_limit", "medium", `operation ${op} blocked by policy`, { op })
      this.logIncident(incident)
      return incident
    }
    return null
  }

  /** Returns true if code + path checks all pass. */
  isSafe(code: string, path?: string): boolean {
    if (this.isStopped()) return false
    if (this.checkCode(code)) return false
    if (path && this.checkPath(path)) return false
    return true
  }

  /** Get current resource limits. */
  getLimits(): Readonly<ResourceLimits> {
    return { ...this.limits }
  }

  /** Update resource limits at runtime. */
  updateLimits(updates: Partial<ResourceLimits>): void {
    this.limits = { ...this.limits, ...updates }
  }

  /** Most recent N incidents. */
  recentIncidents(limit = 50): SafetyIncident[] {
    return this.incidents.slice(-limit)
  }

  /** Number of incidents logged. */
  incidentCount(): number {
    return this.incidents.length
  }

  private logIncident(incident: SafetyIncident): void {
    this.incidents.push(incident)
    if (this.incidents.length > this.incidentLogCap) {
      this.incidents.splice(0, this.incidents.length - this.incidentLogCap)
    }
  }

  private makeIncident(
    type: ViolationType,
    riskLevel: RiskLevel,
    message: string,
    context?: Record<string, unknown>,
  ): SafetyIncident {
    return {
      id: `inc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      riskLevel,
      message,
      context,
      timestamp: new Date().toISOString(),
    }
  }
}