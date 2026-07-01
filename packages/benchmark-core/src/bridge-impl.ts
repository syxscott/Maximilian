/**
 * Phase 9 — Concrete BenchmarkBridge implementation.
 *
 * Stores benchmark results per role and provides quality profiles
 * to SimulationEngine via the BenchmarkBridge interface.
 * Enables promotion proposals to use real quality data instead of
 * static defaults.
 */

import type { BenchmarkResult } from "./types.js";
import { aggregateToRoleProfile } from "./bridge.js";

/**
 * RoleProfile shape matching @max/meta-system/src/simulation.ts.
 * Declared locally to avoid circular dependency.
 */
interface RoleProfile {
  costPerCall: number;
  latencyMs: number;
  qualityScore: number;
}

/**
 * Interface matching @max/meta-system/src/simulation.ts BenchmarkBridge.
 * Declared locally to avoid circular dependency.
 */
interface BenchmarkBridge {
  getQualityProfile(role: string): Promise<RoleProfile | null>;
}

/**
 * A BenchmarkBridge that caches benchmark results per role.
 * When getQualityProfile(role) is called, aggregates all cached
 * results for that role into a single RoleProfile.
 *
 * Bounded: each role retains at most `maxEntriesPerRole` results
 * (FIFO eviction). Prevents unbounded memory growth in long-running
 * processes.
 */
export class CachingBenchmarkBridge implements BenchmarkBridge {
  private cache = new Map<string, BenchmarkResult[]>();
  private maxEntriesPerRole: number;

  constructor(maxEntriesPerRole = 100) {
    this.maxEntriesPerRole = maxEntriesPerRole;
  }

  /**
   * Record benchmark results for a role.
   * Evicts oldest entries when the per-role cap is exceeded.
   */
  record(role: string, results: BenchmarkResult[]): void {
    const existing = this.cache.get(role) ?? [];
    existing.push(...results);
    if (existing.length > this.maxEntriesPerRole) {
      existing.splice(0, existing.length - this.maxEntriesPerRole);
    }
    this.cache.set(role, existing);
  }

  /**
   * Record a single benchmark result for a role.
   * Evicts the oldest entry when the per-role cap is exceeded.
   */
  recordOne(role: string, result: BenchmarkResult): void {
    const existing = this.cache.get(role) ?? [];
    existing.push(result);
    if (existing.length > this.maxEntriesPerRole) {
      existing.splice(0, existing.length - this.maxEntriesPerRole);
    }
    this.cache.set(role, existing);
  }

  /**
   * Get aggregated quality profile for a role from cached benchmark data.
   * Returns null if no benchmark data exists for the role.
   */
  async getQualityProfile(role: string): Promise<RoleProfile | null> {
    const results = this.cache.get(role);
    if (!results || results.length === 0) return null;
    return aggregateToRoleProfile(results);
  }

  /**
   * Check whether benchmark data exists for a role.
   */
  hasRole(role: string): boolean {
    const results = this.cache.get(role);
    return !!results && results.length > 0;
  }

  /**
   * Get all roles that have benchmark data.
   */
  getRoles(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Clear all cached benchmark data.
   */
  clear(): void {
    this.cache.clear();
  }
}
