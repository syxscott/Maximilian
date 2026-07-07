/**
 * Feature flags module — GrowthBook-compatible flag definitions.
 *
 * Flags are loaded from environment variables (JSON format) or passed
 * directly. Supports boolean flags and JSON value flags with targeting
 * rules (percentage rollouts, user allowlists).
 *
 * Usage:
 *   const flags = createFeatureFlags({ flags: DEFAULT_FLAGS });
 *   if (flags.isEnabled("DAGS_MODE")) { ... }
 *   const value = flags.getJsonValue("MAX_TEAM_SIZE", 5);
 *
 * Environment variable format:
 *   FEATURE_FLAGS='{"DAGS_MODE": true, "MAX_TEAM_SIZE": 10}'
 */

export interface FlagDefinition {
  /** Default value when no override matches. */
  defaultValue: boolean;
  /** Optional: percentage of users who get `defaultValue` (rest get !defaultValue). */
  rolloutPercentage?: number;
  /** Optional: list of user IDs that always get the flag enabled. */
  allowlist?: string[];
  /** Human-readable description for the flag. */
  description?: string;
}

export interface JsonFlagDefinition<T = unknown> {
  defaultValue: T;
  description?: string;
}

export interface FeatureFlagsConfig {
  /** Flag definitions. */
  flags?: Record<string, FlagDefinition>;
  /** JSON value flags. */
  jsonFlags?: Record<string, JsonFlagDefinition>;
  /** Optional user ID for targeting/allowlist evaluation. */
  userId?: string | undefined;
  /** Optional: load overrides from FEATURE_FLAGS env var. */
  loadFromEnv?: boolean;
}

// ── Default flags ─────────────────────────────────────────────────────────

export const DEFAULT_FLAGS: Record<string, FlagDefinition> = {
  DAGS_MODE: {
    defaultValue: false,
    description: "Enable DAGS pipeline for dynamic agent team assembly",
  },
  META_AGENT_ENABLED: {
    defaultValue: true,
    description: "Enable Phase 6 meta-system (capability discovery, agent birth/retirement)",
  },
  EVOLUTION_ENABLED: {
    defaultValue: true,
    description: "Enable Evolution Engine for automatic model/agent optimization",
  },
  MULTI_TENANT_ENABLED: {
    defaultValue: false,
    description: "Enable multi-tenant isolation via tenant ID",
  },
  TASK_QUEUE_ENABLED: {
    defaultValue: false,
    description: "Enable BullMQ task queue for background execution",
  },
  TELEMETRY_ENABLED: {
    defaultValue: true,
    description: "Enable OpenTelemetry tracing and Prometheus metrics",
  },
  STREAMING_ENABLED: {
    defaultValue: true,
    description: "Enable SSE streaming for real-time workspace updates",
  },
};

export const DEFAULT_JSON_FLAGS: Record<string, JsonFlagDefinition> = {
  MAX_TEAM_SIZE: {
    defaultValue: 10,
    description: "Maximum number of agents in a team",
  },
  MAX_CONCURRENT_TASKS: {
    defaultValue: 5,
    description: "Maximum concurrent LLM calls",
  },
  REVIEW_THRESHOLD: {
    defaultValue: 7,
    description: "Minimum review score to pass (1-10)",
  },
};

// ── Feature Flags implementation ──────────────────────────────────────────

export class FeatureFlags {
  private readonly flags: Map<string, FlagDefinition>;
  private readonly jsonFlags: Map<string, JsonFlagDefinition>;
  private readonly userId: string | undefined;
  private readonly overrides: Map<string, boolean> = new Map();

  constructor(config: FeatureFlagsConfig = {}) {
    this.flags = new Map(Object.entries(config.flags ?? DEFAULT_FLAGS));
    this.jsonFlags = new Map(Object.entries(config.jsonFlags ?? DEFAULT_JSON_FLAGS));
    this.userId = config.userId ?? undefined;

    // Load env overrides
    if (config.loadFromEnv !== false) {
      this.loadEnvOverrides();
    }
  }

  /**
   * Check if a boolean flag is enabled.
   */
  isEnabled(flagName: string): boolean {
    // Check manual override first
    if (this.overrides.has(flagName)) {
      return this.overrides.get(flagName)!;
    }

    const flag = this.flags.get(flagName);
    if (!flag) return false;

    // Allowlist check
    if (this.userId && flag.allowlist?.includes(this.userId)) {
      return true;
    }

    // Rollout percentage
    if (flag.rolloutPercentage !== undefined && flag.rolloutPercentage < 100) {
      const hash = this.hash(flagName + (this.userId ?? ""));
      if (hash > flag.rolloutPercentage) {
        return !flag.defaultValue;
      }
    }

    return flag.defaultValue;
  }

  /**
   * Get a JSON flag value.
   */
  getJsonValue<T>(flagName: string, fallback: T): T {
    const flag = this.jsonFlags.get(flagName);
    return (flag?.defaultValue as T) ?? fallback;
  }

  /**
   * Get all flag values (for debugging/admin UI).
   */
  getAllFlags(): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    for (const [name] of this.flags) {
      result[name] = this.isEnabled(name);
    }
    return result;
  }

  /**
   * Get all JSON flag values.
   */
  getAllJsonFlags(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [name, flag] of this.jsonFlags) {
      result[name] = flag.defaultValue;
    }
    return result;
  }

  /**
   * Override a flag value at runtime (e.g., from admin API).
   */
  override(flagName: string, value: boolean): void {
    this.overrides.set(flagName, value);
  }

  /**
   * Clear a runtime override.
   */
  clearOverride(flagName: string): void {
    this.overrides.delete(flagName);
  }

  /**
   * Get flag definition (for admin UI).
   */
  getFlagDefinition(flagName: string): FlagDefinition | undefined {
    return this.flags.get(flagName);
  }

  /**
   * List all flag names.
   */
  listFlagNames(): string[] {
    return [...this.flags.keys()];
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private loadEnvOverrides(): void {
    try {
      const raw = typeof process !== "undefined" ? process.env["FEATURE_FLAGS"] : undefined;
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "boolean") {
          this.overrides.set(key, value);
        }
      }
    } catch {
      // Invalid JSON in env var — ignore
    }
  }

  private hash(input: string): number {
    let h = 0;
    for (let i = 0; i < input.length; i++) {
      h = ((h << 5) - h + input.charCodeAt(i)) | 0;
    }
    return Math.abs(h % 100);
  }
}

/**
 * Create a FeatureFlags instance with defaults.
 */
export function createFeatureFlags(config?: FeatureFlagsConfig): FeatureFlags {
  return new FeatureFlags(config);
}
