/**
 * Integration tests for dynamic provider config (provider_configs table).
 *
 * Skips when DATABASE_URL is not set. Exercises the round-trip path the
 * PUT /api/system/providers/* routes rely on:
 *   - getProviderConfigsFromDb returns rows with all fields populated
 *   - setDefaultProviderInDb clears prior defaults atomically (invariant:
 *     at most one row has defaultProvider=true after the call)
 *   - setProviderModelInDb updates the model column for an existing row
 *     and returns false when no row exists
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  createDb,
  closeDb,
  runMigrations,
  getProviderConfigsFromDb,
  setDefaultProviderInDb,
  setProviderModelInDb,
  providerConfigs,
} from "../src/index.js";

const url = process.env.DATABASE_URL;
const forceSkip = process.env.MAX_DB_SKIP_PG === "1";
const skipPg = !url || forceSkip;
const d = skipPg ? describe.skip : describe;

d("provider-config", () => {
  beforeAll(async () => {
    if (skipPg) return;
    const db = createDb(url!);
    await runMigrations({ databaseUrl: url!, folder: "./drizzle" });
    await db.delete(providerConfigs);
  });

  afterAll(async () => {
    if (skipPg) return;
    await closeDb();
  });

  it("getProviderConfigsFromDb returns empty Map when no rows exist", async () => {
    const db = createDb(url!);
    const map = await getProviderConfigsFromDb(db);
    expect(map.size).toBe(0);
  });

  it("setDefaultProviderInDb inserts and marks defaultProvider=true", async () => {
    const db = createDb(url!);
    await setDefaultProviderInDb(db, "openai", "gpt-4o");
    const map = await getProviderConfigsFromDb(db);
    const openai = map.get("openai");
    expect(openai).toBeDefined();
    expect(openai?.defaultProvider).toBe(true);
    expect(openai?.defaultModel).toBe("gpt-4o");
    expect(openai?.enabled).toBe(true);
  });

  it("setDefaultProviderInDb clears prior default when switching (atomic invariant)", async () => {
    const db = createDb(url!);
    await setDefaultProviderInDb(db, "openai", "gpt-4o");
    await setDefaultProviderInDb(db, "anthropic", "claude-sonnet-4-6");

    const map = await getProviderConfigsFromDb(db);
    const defaults = [...map.values()].filter((c) => c.defaultProvider);
    // Invariant: exactly one default at a time.
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.defaultProvider).toBe(true);
    expect(map.get("anthropic")?.defaultProvider).toBe(true);
    expect(map.get("openai")?.defaultProvider).toBe(false);
  });

  it("setProviderModelInDb updates an existing row", async () => {
    const db = createDb(url!);
    await setDefaultProviderInDb(db, "openai", "gpt-4o");
    const updated = await setProviderModelInDb(db, "openai", "o3-mini");
    expect(updated).toBe(true);

    const map = await getProviderConfigsFromDb(db);
    expect(map.get("openai")?.defaultModel).toBe("o3-mini");
  });

  it("setProviderModelInDb returns false when no row exists for the provider", async () => {
    const db = createDb(url!);
    // No prior insert → no row to update.
    await db.delete(providerConfigs).where(eq(providerConfigs.providerId, "ghost"));
    const updated = await setProviderModelInDb(db, "ghost", "x");
    expect(updated).toBe(false);
  });
});
