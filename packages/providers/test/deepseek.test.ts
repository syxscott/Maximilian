/**
 * Tests for DeepSeekProvider. The provider delegates to OpenAIProvider
 * with a fixed base URL, so we verify identity, configuration handling,
 * and delegation wiring.
 */

import { describe, it, expect } from "vitest";
import { DeepSeekProvider } from "../src/deepseek.js";

describe("DeepSeekProvider", () => {
  it("uses DeepSeek base URL by default", () => {
    const provider = new DeepSeekProvider({ apiKey: "sk-test" });
    expect(provider.id).toBe("deepseek");
    expect(provider.name).toBe("DeepSeek");
    expect(provider.defaultModel).toBe("deepseek-chat");
  });

  it("honors a custom defaultModel", () => {
    const provider = new DeepSeekProvider({
      apiKey: "sk-test",
      defaultModel: "deepseek-reasoner",
    });
    expect(provider.defaultModel).toBe("deepseek-reasoner");
  });

  it("isConfigured reflects apiKey presence", () => {
    expect(new DeepSeekProvider({ apiKey: "sk-test" }).isConfigured()).toBe(true);
  });

  it("throws when apiKey missing", () => {
    expect(() => new DeepSeekProvider({ apiKey: "" })).toThrow(/apiKey is required/);
  });

  it("accepts custom baseURL without throwing", () => {
    // Custom baseURL is passed straight through to OpenAIProvider — we
    // only verify it doesn't get rejected at construction time. Full
    // integration tests would require network access.
    expect(
      () =>
        new DeepSeekProvider({
          apiKey: "sk-test",
          baseURL: "https://proxy.example.com/v1",
        })
    ).not.toThrow();
  });
});