/**
 * Tests for token usage normalization helpers.
 * - getFreshInputTokens: protocol-aware input token subtraction
 * - getCacheHitRate: cache read rate in [0,1]
 * - isUnpricedUsage: data-integrity flag for missed price-table entries
 */

import { describe, it, expect } from "vitest";
import { getFreshInputTokens, getCacheHitRate, isUnpricedUsage } from "../src/usage.js";

describe("getFreshInputTokens", () => {
  it("passes Anthropic input through unchanged (cache_exclusive)", () => {
    // Anthropic already excludes cache_read from input_tokens.
    expect(
      getFreshInputTokens({
        provider: "anthropic",
        promptTokens: 1000,
        cacheReadTokens: 800,
      })
    ).toBe(1000);
  });

  it("subtracts cacheReadTokens for OpenAI-style providers (cache_inclusive)", () => {
    expect(
      getFreshInputTokens({
        provider: "openai",
        promptTokens: 1000,
        cacheReadTokens: 800,
      })
    ).toBe(200);
  });

  it("treats OpenRouter and DeepSeek as cache_inclusive", () => {
    for (const provider of ["openrouter", "deepseek"]) {
      expect(
        getFreshInputTokens({
          provider,
          promptTokens: 500,
          cacheReadTokens: 100,
        })
      ).toBe(400);
    }
  });

  it("treats missing cacheReadTokens as 0", () => {
    expect(getFreshInputTokens({ provider: "openai", promptTokens: 500 })).toBe(500);
  });

  it("clamps to zero if cacheReadTokens exceeds promptTokens (defensive)", () => {
    // Shouldn't happen but if it does, don't return a negative number.
    expect(
      getFreshInputTokens({
        provider: "openai",
        promptTokens: 100,
        cacheReadTokens: 150,
      })
    ).toBe(0);
  });
});

describe("getCacheHitRate", () => {
  it("returns 0 when there is no input", () => {
    expect(
      getCacheHitRate({ provider: "anthropic", promptTokens: 0 })
    ).toBe(0);
  });

  it("returns cacheRead / (prompt + cacheCreation) for Anthropic", () => {
    expect(
      getCacheHitRate({
        provider: "anthropic",
        promptTokens: 200,
        cacheReadTokens: 800,
        cacheCreationTokens: 1000,
      })
    ).toBe(800 / 1200);
  });

  it("returns cacheRead / prompt for OpenAI-style (cacheCreation is 0)", () => {
    expect(
      getCacheHitRate({
        provider: "openai",
        promptTokens: 1000,
        cacheReadTokens: 800,
      })
    ).toBe(0.8);
  });
});

describe("isUnpricedUsage", () => {
  const base = {
    provider: "openai",
    promptTokens: 100,
    completionTokens: 50,
    statusCode: 200,
    totalCostUsd: 0,
  };

  it("flags 2xx + tokens + zero cost", () => {
    expect(isUnpricedUsage(base)).toBe(true);
  });

  it("does not flag when status is non-2xx", () => {
    expect(isUnpricedUsage({ ...base, statusCode: 500 })).toBe(false);
  });

  it("does not flag when no tokens were consumed", () => {
    expect(
      isUnpricedUsage({ ...base, promptTokens: 0, completionTokens: 0 })
    ).toBe(false);
  });

  it("does not flag when cost is non-zero", () => {
    expect(isUnpricedUsage({ ...base, totalCostUsd: 0.001 })).toBe(false);
  });

  it("flags cache-only requests too", () => {
    expect(
      isUnpricedUsage({
        ...base,
        promptTokens: 0,
        completionTokens: 0,
        cacheReadTokens: 500,
      })
    ).toBe(true);
  });
});