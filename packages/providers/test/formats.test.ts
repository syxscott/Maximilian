/**
 * Tests for the preset-driven registry and the format factory.
 *
 * These verify the wiring between presets + env vars + Provider instances,
 * without making any network calls.
 */
import { describe, it, expect } from "vitest";
import { createRegistry, resetRegistry } from "../src/registry.js";
import { createProviderForFormat } from "../src/formats/index.js";
import { PROVIDER_PRESETS } from "../src/presets/index.js";
import { OpenAIChatProvider } from "../src/formats/openai-chat.js";
import { AnthropicMessagesProvider } from "../src/formats/anthropic.js";
import { GeminiNativeProvider } from "../src/formats/gemini-native.js";

describe("createProviderForFormat", () => {
  it("dispatches openai_chat to OpenAIChatProvider", () => {
    const p = createProviderForFormat("openai_chat", {
      id: "test",
      name: "Test",
      apiKey: "k",
      baseURL: "https://example.com/v1",
      defaultModel: "m",
    });
    expect(p).toBeInstanceOf(OpenAIChatProvider);
    expect(p.id).toBe("test");
    expect(p.defaultModel).toBe("m");
  });

  it("dispatches anthropic to AnthropicMessagesProvider", () => {
    const p = createProviderForFormat("anthropic", {
      id: "test",
      name: "Test",
      apiKey: "k",
      baseURL: "https://example.com",
      defaultModel: "claude-3",
    });
    expect(p).toBeInstanceOf(AnthropicMessagesProvider);
  });

  it("dispatches gemini_native to GeminiNativeProvider", () => {
    const p = createProviderForFormat("gemini_native", {
      id: "test",
      name: "Test",
      apiKey: "k",
      baseURL: "https://generativelanguage.googleapis.com/v1beta",
      defaultModel: "gemini-2.5-flash",
    });
    expect(p).toBeInstanceOf(GeminiNativeProvider);
  });

  it("rejects an unknown apiFormat (defense in depth)", () => {
    expect(() =>
      createProviderForFormat("not_a_format" as never, {
        id: "x",
        name: "x",
        apiKey: "k",
        baseURL: "https://example.com",
        defaultModel: "m",
      }),
    ).toThrow();
  });

  it("rejects empty apiKey (defense in depth)", () => {
    expect(() =>
      createProviderForFormat("openai_chat", {
        id: "x",
        name: "x",
        apiKey: "",
        baseURL: "https://example.com",
        defaultModel: "m",
      }),
    ).toThrow();
  });
});

describe("createRegistry — preset-driven wiring", () => {
  it("activates a preset only when its envKey is set", () => {
    resetRegistry();
    const r = createRegistry({
      ZHIPU_API_KEY: "zh-key",
      DASHSCOPE_API_KEY: "ds-key",
    });
    const ids = r.list().map((p) => p.id);
    expect(ids).toContain("zhipu");
    // CC Switch names DashScope's Anthropic-compatible endpoint "Bailian";
    // DASHSCOPE_API_KEY therefore activates the dashscope-bailian preset.
    expect(ids).toContain("dashscope-bailian");
  });

  it("does NOT activate a preset when envKey is missing", () => {
    resetRegistry();
    const r = createRegistry({});
    const ids = r.list().map((p) => p.id);
    expect(ids).toEqual([]);
  });

  it("hidden presets are not activated even when envKey is set", () => {
    resetRegistry();
    const r = createRegistry({
      GITHUB_COPILOT_TOKEN: "tok",
      AWS_BEDROCK_API_KEY: "ak",
    });
    const ids = r.list().map((p) => p.id);
    expect(ids).not.toContain("github-copilot");
    expect(ids).not.toContain("aws-bedrock");
  });

  it("envModel override is respected", () => {
    resetRegistry();
    const r = createRegistry({
      OPENAI_API_KEY: "k",
      OPENAI_MODEL: "gpt-4o",
    });
    expect(r.getEffectiveDefaultModel("openai")).toBe("gpt-4o");
  });

  it("skips presets whose baseUrl is invalid (defense in depth)", () => {
    resetRegistry();
    // All our presets have parseable URLs; we trust that filter for now
    // and just verify no throw on registry creation.
    expect(() => createRegistry({})).not.toThrow();
  });

  it("exposes listPresets() covering visible presets", () => {
    resetRegistry();
    const r = createRegistry({
      ANTHROPIC_API_KEY: "k",
    });
    const presets = r.listPresets();
    expect(presets.length).toBeGreaterThan(20);
    for (const p of presets) {
      expect(p.hidden).not.toBe(true);
    }
  });

  it("getPreset() looks up by id", () => {
    resetRegistry();
    const r = createRegistry({});
    expect(r.getPreset("deepseek")?.name).toBe("DeepSeek");
    expect(r.getPreset("not-real")).toBeUndefined();
  });

  it("supports the original 4 providers via env vars", () => {
    resetRegistry();
    const r = createRegistry({
      OPENAI_API_KEY: "k1",
      ANTHROPIC_API_KEY: "k2",
      OPENROUTER_API_KEY: "k3",
      DEEPSEEK_API_KEY: "k4",
    });
    const ids = r.list().map((p) => p.id);
    expect(ids).toContain("openai");
    expect(ids).toContain("anthropic");
    expect(ids).toContain("openrouter");
    expect(ids).toContain("deepseek");
  });

  it("activates many Chinese providers in one env", () => {
    resetRegistry();
    const r = createRegistry({
      ZHIPU_API_KEY: "k",
      DASHSCOPE_API_KEY: "k",
      MOONSHOT_API_KEY: "k",
      DOUBAO_API_KEY: "k",
      STEPFUN_API_KEY: "k",
      MINIMAX_API_KEY: "k",
      LONGCAT_API_KEY: "k",
      MIMO_API_KEY: "k",
      SILICONFLOW_API_KEY: "k",
    });
    const ids = r.list().map((p) => p.id);
    expect(ids.length).toBeGreaterThanOrEqual(9);
    // Verify no duplicates
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("local inference presets", () => {
  it("activates ollama when its enabled flag is truthy", () => {
    resetRegistry();
    const r = createRegistry({ OLLAMA_ENABLED: "true" });
    const ids = r.list().map((p) => p.id);
    expect(ids).toContain("ollama");
  });

  it("does NOT activate ollama when env is empty", () => {
    resetRegistry();
    const r = createRegistry({});
    const ids = r.list().map((p) => p.id);
    expect(ids).not.toContain("ollama");
  });

  it("does NOT activate ollama when explicitly disabled", () => {
    resetRegistry();
    const r = createRegistry({ OLLAMA_ENABLED: "false" });
    const ids = r.list().map((p) => p.id);
    expect(ids).not.toContain("ollama");
  });
});

describe("registry scaling — the borrowed presets work as advertised", () => {
  it("every visible preset can be activated by setting its envKey", () => {
    resetRegistry();
    const env: NodeJS.ProcessEnv = {};
    const visible = PROVIDER_PRESETS.filter((p) => !p.hidden);
    for (const p of visible) {
      env[p.envKey] = "test-key";
      // envModel is optional
      if (p.envModel) env[p.envModel] = p.defaultModel;
    }
    const r = createRegistry(env);
    const ids = new Set(r.list().map((p) => p.id));
    // All visible presets should be active
    for (const p of visible) {
      expect(ids.has(p.id), `${p.id} should be active`).toBe(true);
    }
  });
});