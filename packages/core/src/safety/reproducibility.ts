/**
 * ReproducibilityManager — seed + environment capture + consistency check (借鉴 Kosmos safety/reproducibility.py).
 *
 * Kosmos's ReproducibilityManager:
 *   - Manages a current random seed (numpy Generator)
 *   - Captures environment snapshots (python version, packages, env vars)
 *   - Hashes snapshots for environment-equivalence checks
 *   - Tracks reproducibility reports per experiment
 *
 * Maximilian adapts this as a dependency-free reproducibility layer:
 *   - setSeed / getSeed / nextSeed
 *   - captureEnvironment() — records node version, platform, key env vars, deps
 *   - hashSnapshot() — deterministic hash for "are these two environments equivalent?"
 *   - checkReproducibility() — compares two result snapshots via hash equality
 *
 * The runtime can attach this to its execution pipeline so each workspace
 * records a reproducibility report alongside results.
 */

import { createHash } from "node:crypto"
import { hostname, platform as osPlatform, cpus } from "node:os"
import { env as processEnv } from "node:process"

export interface EnvironmentSnapshot {
  nodeVersion: string
  platform: NodeJS.Platform
  arch: string
  hostname: string
  cpuCount: number
  /** Selected env var names captured (avoid leaking secrets). */
  capturedEnv: Record<string, string>
  /** Optional package versions (caller-provided to avoid reading node_modules). */
  packages?: Record<string, string>
  timestamp: string
}

export interface ReproducibilityReport {
  experimentId: string
  isReproducible: boolean
  seedUsed?: number
  environment?: EnvironmentSnapshot
  consistencyChecks: string[]
  issues: string[]
  metadata: Record<string, unknown>
  timestamp: string
}

export interface ReproducibilityOptions {
  defaultSeed?: number
  /** Env var names to capture (default: NODE_ENV, MAX_MODE). */
  captureEnvVars?: string[]
  /** Package versions to record (e.g., { "@max/core": "0.1.0" }). */
  packageVersions?: Record<string, string>
}

const DEFAULT_ENV_VARS = ["NODE_ENV", "MAX_MODE"]

export class ReproducibilityManager {
  private currentSeed?: number
  private readonly defaultSeed: number
  private readonly captureEnvVars: string[]
  private readonly packageVersions: Record<string, string>
  private readonly reports = new Map<string, ReproducibilityReport>()

  constructor(options?: ReproducibilityOptions) {
    this.defaultSeed = options?.defaultSeed ?? 42
    this.captureEnvVars = options?.captureEnvVars ?? DEFAULT_ENV_VARS
    this.packageVersions = options?.packageVersions ?? {}
  }

  /** Set the current seed. */
  setSeed(seed: number): void {
    this.currentSeed = seed
  }

  /** Get the current seed, falling back to defaultSeed. */
  getSeed(): number {
    return this.currentSeed ?? this.defaultSeed
  }

  /** Clear the current seed (callers should set their own). */
  resetSeed(): void {
    this.currentSeed = undefined
  }

  /** Capture a snapshot of the current execution environment. */
  captureEnvironment(): EnvironmentSnapshot {
    const capturedEnv: Record<string, string> = {}
    for (const key of this.captureEnvVars) {
      const val = processEnv[key]
      if (val !== undefined) capturedEnv[key] = val
    }
    return {
      nodeVersion: process.version,
      platform: osPlatform(),
      arch: process.arch,
      hostname: hostname(),
      cpuCount: cpus().length,
      capturedEnv,
      packages: Object.keys(this.packageVersions).length > 0 ? { ...this.packageVersions } : undefined,
      timestamp: new Date().toISOString(),
    }
  }

  /** Hash an environment snapshot to a short hex string. */
  hashSnapshot(snapshot: EnvironmentSnapshot): string {
    const relevant = {
      node: snapshot.nodeVersion,
      platform: snapshot.platform,
      arch: snapshot.arch,
      packages: snapshot.packages ?? {},
      capturedEnv: snapshot.capturedEnv,
    }
    // Use hashObject (function-replacer) rather than JSON.stringify with an
    // array replacer — array replacers recursively filter nested keys,
    // which would drop capturedEnv entries like NODE_ENV.
    return hashObject(relevant)
  }

  /**
   * Compare two environments for reproducibility. Returns true if they
   * are equivalent (same node/platform/packages/env).
   */
  environmentsMatch(a: EnvironmentSnapshot, b: EnvironmentSnapshot): boolean {
    return this.hashSnapshot(a) === this.hashSnapshot(b)
  }

  /**
   * Check reproducibility of two result snapshots. Both must be plain
   * objects; we hash their JSON representation and compare.
   */
  checkReproducibility<T>(experimentId: string, firstResult: T, secondResult: T): ReproducibilityReport {
    const checks: string[] = []
    const issues: string[] = []

    const firstHash = hashObject(firstResult)
    const secondHash = hashObject(secondResult)
    checks.push(`result hash 1: ${firstHash}`)
    checks.push(`result hash 2: ${secondHash}`)
    if (firstHash !== secondHash) {
      issues.push("result hashes differ — execution is not deterministic")
    }

    const env1 = this.captureEnvironment()
    const env2 = this.captureEnvironment()
    checks.push(`env hash 1: ${this.hashSnapshot(env1)}`)
    checks.push(`env hash 2: ${this.hashSnapshot(env2)}`)
    if (!this.environmentsMatch(env1, env2)) {
      issues.push("environments differ between runs")
    }

    const report: ReproducibilityReport = {
      experimentId,
      isReproducible: issues.length === 0,
      seedUsed: this.currentSeed,
      environment: env1,
      consistencyChecks: checks,
      issues,
      metadata: {},
      timestamp: new Date().toISOString(),
    }
    this.reports.set(experimentId, report)
    return report
  }

  /** Get a stored report by experimentId. */
  getReport(experimentId: string): ReproducibilityReport | undefined {
    return this.reports.get(experimentId)
  }

  /** List all stored report IDs. */
  listReports(): string[] {
    return Array.from(this.reports.keys())
  }
}

/** Deterministic hash of a JSON-serializable value. */
export function hashObject(obj: unknown): string {
  // Sort keys recursively for determinism.
  const sorted = JSON.stringify(obj, (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.keys(value as Record<string, unknown>).sort().reduce(
        (acc, k) => { acc[k] = (value as Record<string, unknown>)[k]; return acc },
        {} as Record<string, unknown>,
      )
    }
    return value
  })
  return createHash("md5").update(sorted).digest("hex")
}