/**
 * Read dynamic provider configuration from PostgreSQL.
 * Config is stored in the `provider_configs` table and overrides
 * environment variable defaults at runtime.
 *
 * Security: only SELECTION config (model + default flag + enabled) is
 * persisted here. API keys remain in environment variables only —
 * never in the database.
 */
import { type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import type { ProviderConfig } from "@max/providers";
import { providerConfigs } from "./schema.js";

export interface ProviderConfigRow extends ProviderConfig {
  /** True when this row is the system-wide default provider. */
  defaultProvider: boolean;
}

/**
 * Load all provider configuration overrides from the database.
 * Returns a Map from provider id → config override.
 */
export async function getProviderConfigsFromDb(
  db: PostgresJsDatabase
): Promise<Map<string, ProviderConfigRow>> {
  const rows = await db.select().from(providerConfigs);
  const map = new Map<string, ProviderConfigRow>();
  for (const row of rows) {
    map.set(row.providerId, {
      defaultModel: row.defaultModel,
      enabled: row.enabled,
      defaultProvider: row.defaultProvider,
    });
  }
  return map;
}

/**
 * Atomically set a provider as the system default.
 *
 * Wraps two operations in a transaction so the DB invariant "exactly one
 * row has defaultProvider=true" holds even under concurrent requests:
 *   1. Clear defaultProvider=true on every row.
 *   2. Set defaultProvider=true on the target row (insert or update).
 *
 * Throws on any DB error so callers can surface a 500 to the client.
 */
export async function setDefaultProviderInDb(
  db: PostgresJsDatabase,
  providerId: string,
  defaultModel: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(providerConfigs).set({ defaultProvider: false });
    await tx
      .insert(providerConfigs)
      .values({ providerId, defaultModel, enabled: true, defaultProvider: true })
      .onConflictDoUpdate({
        target: providerConfigs.providerId,
        set: { defaultProvider: true, defaultModel, updatedAt: new Date() },
      });
  });
}

/**
 * Update only the default model for a provider. Used by PUT /api/system/providers/{id}/model.
 * Returns true if a row was updated, false if the provider has no config row yet
 * (caller should INSERT first via setDefaultProviderInDb or treat as no-op).
 */
export async function setProviderModelInDb(
  db: PostgresJsDatabase,
  providerId: string,
  model: string,
): Promise<boolean> {
  const result = await db
    .update(providerConfigs)
    .set({ defaultModel: model, updatedAt: new Date() })
    .where(eq(providerConfigs.providerId, providerId))
    .returning({ providerId: providerConfigs.providerId });
  return result.length > 0;
}
