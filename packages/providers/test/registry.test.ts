/**
 * Tests for the dynamic-config methods on ProviderRegistry.
 *
 * The registry now supports runtime:
 *   - default provider switching (setDefaultProviderId)
 *   - per-provider model override (setProviderConfig)
 *   - effective model lookup (getEffectiveDefaultModel)
 *
 * These methods are the foundation for "switch LLM without restarting".
 */
import { describe, it, expect } from "vitest";
import { createRegistry } from "../src/registry.js";

describe("ProviderRegistry — default provider", () => {
  it("defaults to the first configured provider (data-driven order)", () => {
    const r = createRegistry({
      OPENAI_API_KEY: "k1",
      ANTHROPIC_API_KEY: "k2",
    });
    // First enabled preset wins. The order is determined by PROVIDER_PRESETS.
    // Just check the default is one of the configured providers and is the
    // first enabled one.
    const ids = r.list().map((p) => p.id);
    expect(ids).toContain("openai");
    expect(ids).toContain("anthropic");
    expect(r.default()?.id).toBe(ids[0]);
  });

  it("setDefaultProviderId switches the default", () => {
    const r = createRegistry({
      OPENAI_API_KEY: "k1",
      ANTHROPIC_API_KEY: "k2",
    });
    r.setDefaultProviderId("anthropic");
    expect(r.default()?.id).toBe("anthropic");
  });

  it("setDefaultProviderId silently no-ops for unknown ids (defense in depth)", () => {
    const r = createRegistry({ OPENAI_API_KEY: "k1" });
    r.setDefaultProviderId("nonexistent");
    expect(r.default()?.id).toBe("openai");
  });

  it("returns undefined when no providers are configured", () => {
    const r = createRegistry({});
    expect(r.default()).toBeUndefined();
  });
});

describe("ProviderRegistry — model overrides", () => {
  it("getEffectiveDefaultModel falls back to provider's built-in default", () => {
    const r = createRegistry({
      OPENAI_API_KEY: "k1",
      OPENAI_MODEL: "gpt-4o",
    });
    expect(r.getEffectiveDefaultModel("openai")).toBe("gpt-4o");
  });

  it("setProviderConfig overrides the effective default model", () => {
    const r = createRegistry({ OPENAI_API_KEY: "k1", OPENAI_MODEL: "gpt-4o" });
    r.setProviderConfig("openai", { defaultModel: "o3-mini" });
    expect(r.getEffectiveDefaultModel("openai")).toBe("o3-mini");
  });

  it("setProviderConfig with empty defaultModel falls back to built-in", () => {
    const r = createRegistry({ OPENAI_API_KEY: "k1", OPENAI_MODEL: "gpt-4o" });
    r.setProviderConfig("openai", { defaultModel: "" });
    // Empty override → fall back. The registry treats "" as "use built-in".
    expect(r.getEffectiveDefaultModel("openai")).toBe("gpt-4o");
  });

  it("getProviderConfig returns the most recent override", () => {
    const r = createRegistry({ OPENAI_API_KEY: "k1" });
    expect(r.getProviderConfig("openai")).toBeUndefined();
    r.setProviderConfig("openai", { defaultModel: "x" });
    expect(r.getProviderConfig("openai")).toEqual({ defaultModel: "x" });
    r.setProviderConfig("openai", { defaultModel: "y" });
    expect(r.getProviderConfig("openai")).toEqual({ defaultModel: "y" });
  });

  it("returns empty string for unknown provider id", () => {
    const r = createRegistry({ OPENAI_API_KEY: "k1" });
    expect(r.getEffectiveDefaultModel("nope")).toBe("");
  });
});

describe("ProviderRegistry — list/get isolation", () => {
  it("list() returns a snapshot, not a live view of mutable state", () => {
    const r = createRegistry({ OPENAI_API_KEY: "k1" });
    const before = r.list();
    r.setDefaultProviderId("openai"); // no-op for itself
    const after = r.list();
    // Same providers, but the list() function must not expose mutable handles.
    expect(after.map((p) => p.id)).toEqual(before.map((p) => p.id));
  });

  it("get(id) returns undefined for unknown ids", () => {
    const r = createRegistry({ OPENAI_API_KEY: "k1" });
    expect(r.get("nope")).toBeUndefined();
    expect(r.get("openai")?.id).toBe("openai");
  });
});
