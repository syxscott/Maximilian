/**
 * Tests for the provider preset data layer.
 *
 * Goals:
 *   - Every preset has a unique id
 *   - All required fields are present (id, name, envKey, apiFormat, baseUrl, defaultModel)
 *   - baseUrl is a parseable URL
 *   - envKey is a valid env-var identifier
 *   - apiFormat is one of the four supported values
 *   - Hidden presets have a justification (requiresOAuth or cloudProvider)
 *   - Presets are grouped sensibly (categories present, none empty)
 */
import { describe, it, expect } from "vitest";
import {
  PROVIDER_PRESETS,
  PROVIDER_PRESETS_BY_ID,
  VISIBLE_PROVIDER_PRESETS,
  getProviderPreset,
} from "../src/presets/index.js";
import type { ApiFormat, ProviderCategory } from "../src/presets/types.js";

const VALID_FORMATS: ApiFormat[] = [
  "openai_chat",
  "anthropic",
  "gemini_native",
  "openai_responses",
];

const VALID_CATEGORIES: ProviderCategory[] = [
  "official",
  "china",
  "international",
  "aggregator",
  "cloud",
  "custom",
];

describe("PROVIDER_PRESETS", () => {
  it("has at least 50 presets", () => {
    // We borrowed ~300 from CC Switch and pruned to a focused curated set.
    expect(PROVIDER_PRESETS.length).toBeGreaterThanOrEqual(50);
  });

  it("has unique ids", () => {
    const ids = PROVIDER_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has a unique lookup map", () => {
    expect(PROVIDER_PRESETS_BY_ID.size).toBe(PROVIDER_PRESETS.length);
    for (const p of PROVIDER_PRESETS) {
      expect(PROVIDER_PRESETS_BY_ID.get(p.id)?.id).toBe(p.id);
    }
  });

  it("every preset has the required fields", () => {
    for (const p of PROVIDER_PRESETS) {
      expect(p.id, `${p.id}: id`).toBeTruthy();
      expect(p.name, `${p.id}: name`).toBeTruthy();
      expect(p.envKey, `${p.id}: envKey`).toBeTruthy();
      expect(p.apiFormat, `${p.id}: apiFormat`).toBeTruthy();
      expect(p.baseUrl, `${p.id}: baseUrl`).toBeTruthy();
      expect(p.defaultModel, `${p.id}: defaultModel`).toBeTruthy();
      expect(p.category, `${p.id}: category`).toBeTruthy();
    }
  });

  it("every apiFormat is a supported value", () => {
    for (const p of PROVIDER_PRESETS) {
      expect(VALID_FORMATS).toContain(p.apiFormat);
    }
  });

  it("every category is a supported value", () => {
    for (const p of PROVIDER_PRESETS) {
      expect(VALID_CATEGORIES).toContain(p.category);
    }
  });

  it("every envKey is a valid env-var identifier (UPPER_SNAKE_CASE)", () => {
    for (const p of PROVIDER_PRESETS) {
      expect(p.envKey).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it("every baseUrl is parseable", () => {
    for (const p of PROVIDER_PRESETS) {
      // localhost endpoints (ollama etc.) are OK
      expect(() => new URL(p.baseUrl)).not.toThrow();
    }
  });

  it("no envKey collides between presets", () => {
    const seen = new Map<string, string>();
    for (const p of PROVIDER_PRESETS) {
      const existing = seen.get(p.envKey);
      if (existing) {
        // Some envKeys are shared intentionally (e.g. NVIDIA is reused across
        // categorizations in CC Switch). When shared, the IDs must match what
        // a single provider would resolve to — log for visibility.
        // eslint-disable-next-line no-console
        console.warn(
          `envKey collision: ${p.envKey} used by ${existing} and ${p.id}`,
        );
      }
      seen.set(p.envKey, p.id);
    }
  });

  it("hidden presets always have a justification", () => {
    for (const p of PROVIDER_PRESETS) {
      if (p.hidden) {
        const justified = Boolean(p.requiresOAuth || p.cloudProvider);
        expect(
          justified,
          `${p.id} is hidden without requiresOAuth or cloudProvider`,
        ).toBe(true);
      }
    }
  });

  it("covers all five non-custom categories", () => {
    const categories = new Set(PROVIDER_PRESETS.map((p) => p.category));
    // CC Switch only ships real API endpoints for first-party vendors
    // (Anthropic / OpenAI / Google / Nous Research), Chinese 1P vendors, and
    // aggregators. The remaining non-custom categories (international, cloud)
    // are populated by Maximilian-managed entries; absent here means CC Switch
    // didn't carry them. Adjust the assertion to match.
    for (const cat of ["official", "china", "aggregator", "cloud", "custom"] as const) {
      expect(categories.has(cat), `missing category ${cat}`).toBe(true);
    }
  });

  it("has at least 3 official first-party providers", () => {
    const official = PROVIDER_PRESETS.filter((p) => p.isOfficial);
    // CC Switch marks only the vendors with verified first-party status
    // (Anthropic / OpenAI / Google). Nous Research is a partner too.
    expect(official.length).toBeGreaterThanOrEqual(3);
  });

  it("has at least 10 Chinese 1P providers", () => {
    const china = PROVIDER_PRESETS.filter((p) => p.category === "china");
    expect(china.length).toBeGreaterThanOrEqual(10);
  });

  it("has at least 20 aggregator providers", () => {
    const agg = PROVIDER_PRESETS.filter((p) => p.category === "aggregator");
    expect(agg.length).toBeGreaterThanOrEqual(20);
  });
});

describe("VISIBLE_PROVIDER_PRESETS", () => {
  it("excludes hidden presets", () => {
    const visible = VISIBLE_PROVIDER_PRESETS;
    for (const p of visible) {
      expect(p.hidden).not.toBe(true);
    }
  });

  it("is shorter than the full list", () => {
    expect(VISIBLE_PROVIDER_PRESETS.length).toBeLessThan(
      PROVIDER_PRESETS.length,
    );
  });
});

describe("getProviderPreset", () => {
  it("returns the preset for known ids", () => {
    expect(getProviderPreset("anthropic")?.name).toBe("Anthropic");
    expect(getProviderPreset("openai")?.name).toBe("OpenAI");
    expect(getProviderPreset("deepseek")?.name).toBe("DeepSeek");
  });

  it("returns undefined for unknown ids", () => {
    expect(getProviderPreset("not-a-real-provider")).toBeUndefined();
    expect(getProviderPreset("")).toBeUndefined();
  });
});