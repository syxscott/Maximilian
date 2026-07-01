/**
 * Tests for @max/llm provider / model preset helpers.
 *
 * Covers:
 *   - resolveAvailableProviders picks providers whose env var is set
 *   - getModelsForProvider returns the preset catalog or [] for unknown
 *   - getAllAvailableModels respects an explicit env arg
 *   - model preset shape sanity (id, provider, capabilities present)
 */
import { describe, it, expect } from "vitest";
import {
  resolveAvailableProviders,
  getModelsForProvider,
  getAllAvailableModels,
} from "../src/presets.js";

describe("resolveAvailableProviders", () => {
  it("returns only providers whose env var is set", () => {
    const env: NodeJS.ProcessEnv = {
      ANTHROPIC_API_KEY: "sk-ant-...",
      // OPENAI_API_KEY not set
      GOOGLE_API_KEY: "x",
    };
    const got = resolveAvailableProviders(env).sort();
    expect(got).toContain("anthropic");
    expect(got).toContain("google");
    expect(got).not.toContain("openai");
  });

  it("returns an empty list when no provider env vars are set", () => {
    expect(resolveAvailableProviders({})).toEqual([]);
  });
});

describe("getModelsForProvider", () => {
  it("returns the catalog for known providers", () => {
    const anthropic = getModelsForProvider("anthropic");
    expect(anthropic.length).toBeGreaterThan(0);
    expect(anthropic.every((m) => m.provider === "anthropic")).toBe(true);
    // Catalog should include claude-sonnet-4.
    expect(anthropic.some((m) => m.id.includes("sonnet-4"))).toBe(true);
  });

  it("returns [] for unknown providers", () => {
    expect(getModelsForProvider("nope")).toEqual([]);
  });
});

describe("getAllAvailableModels", () => {
  it("flattens catalogs of providers present in env", () => {
    const env: NodeJS.ProcessEnv = { OPENAI_API_KEY: "sk-x" };
    const models = getAllAvailableModels(env);
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => m.provider === "openai")).toBe(true);
  });

  it("returns [] when no providers are configured", () => {
    expect(getAllAvailableModels({})).toEqual([]);
  });

  it("model presets include capabilities, cost, limits for paid providers", () => {
    const env: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: "sk-ant-x" };
    const models = getAllAvailableModels(env);
    for (const m of models) {
      expect(m.capabilities).toBeDefined();
      expect(m.cost?.input).toBeGreaterThan(0);
      expect(m.cost?.output).toBeGreaterThan(0);
      expect(m.limits?.context).toBeGreaterThan(0);
    }
  });
});