import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

let _db: PostgresJsDatabase | null = null;
let _client: postgres.Sql | null = null;

/**
 * Create or return a cached Drizzle database instance.
 * Uses postgres.js as the driver with connection pooling.
 */
export function createDb(url: string): PostgresJsDatabase {
  if (_db) return _db;
  _client = postgres(url, { max: 10 });
  _db = drizzle(_client);
  return _db;
}

/**
 * Close the database connection (for graceful shutdown).
 */
export async function closeDb(): Promise<void> {
  if (_client) {
    await _client.end();
    _client = null;
    _db = null;
  }
}

export {
  tenants, workspaces, workspaceArtifacts, metrics, executions, orgEvents, users, refreshTokens,
  agentProfiles, agentVersions, evolutionDecisions,
  failureInsights, leaderboardInsights,
  blueprints, teamGraphs,
  capabilities, governanceConfig, pendingProposals,
  telemetryExecutionTraces, telemetryEvolutionTraces,
} from "./schema.js";
export { PgWorkspaceStore } from "./stores/pg-workspace-store.js";
export { PgMetricsStore } from "./stores/pg-metrics-store.js";
export { PgExecutionStore } from "./stores/pg-execution-store.js";
export { PgOrgMemory } from "./stores/pg-org-memory.js";
export { PgProfileStore } from "./stores/pg-profile-store.js";
export { PgEvolutionStore } from "./stores/pg-evolution-store.js";
export { PgInsightsStore } from "./stores/pg-insights-store.js";
export { PgBlueprintStore } from "./stores/pg-blueprint-store.js";
export { PgCapabilityStore } from "./stores/pg-capability-store.js";
export { PgGovernanceConfigStore } from "./stores/pg-governance-config-store.js";
export { PgPendingProposalStore } from "./stores/pg-pending-proposal-store.js";
export { PgTelemetryStore } from "./stores/pg-telemetry-store.js";
export { PgGovernanceEngine } from "./stores/pg-governance-engine.js";
export {
  validateTenantId, makeTenantContext, scoped, assertSameTenant, sanitizeFilter,
  TenantGuardError, type TenantContext,
} from "./tenant-guard.js";
export { runMigrations, getMigrationStatus, type RunMigrationsOptions, type MigrationStatus } from "./migrator.js";
export { getProviderConfigsFromDb, setDefaultProviderInDb, setProviderModelInDb, type ProviderConfigRow } from "./provider-config.js";
export { providerConfigs } from "./schema.js";
