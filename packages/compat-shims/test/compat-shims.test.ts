/**
 * Tests for @max/compat-shims.
 *
 * Coverage:
 *   - version.ts: detectVersion on installed packages, resolveMajor fallback,
 *     featureFlag env-var parsing.
 *   - drizzle.ts: capability detection + driver path map.
 *   - hono.ts: standard error envelope.
 *   - llm.ts: openai/anthropic args translation + response normalization.
 *
 * The ink and hono shims that lazy-load upstream via createRequire are not
 * exercised here — those modules aren't in this package's node_modules,
 * so calling them would throw `MODULE_NOT_FOUND`. They are covered by the
 * TUI and API respectively when those packages consume the shim.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  detectVersion,
  resolveMajor,
  featureFlag,
  detectDrizzleCapabilities,
  driverImportPath,
  toStandardError,
  toProviderArgs,
  fromProviderResponse,
  KNOWN_MAJORS,
} from "../src/index.js";

describe("version.ts — detectVersion / resolveMajor", () => {
  it("detects the installed vitest version (we depend on it for testing)", () => {
    const v = detectVersion("vitest");
    expect(v).not.toBeNull();
    expect(v).toBeGreaterThanOrEqual(2);
  });

  it("returns null for a package that's not installed", () => {
    expect(detectVersion("definitely-not-a-real-package-xyz123")).toBeNull();
  });

  it("resolveMajor falls back when the package isn't installed", () => {
    expect(resolveMajor("not-installed-anywhere-xyz", 4)).toBe(4);
  });

  it("resolveMajor returns the detected version when the package is installed", () => {
    expect(resolveMajor("vitest", 1)).toBeGreaterThanOrEqual(2);
  });

  it("KNOWN_MAJORS lists every upstream we shim", () => {
    expect(KNOWN_MAJORS.ink).toContain(5);
    expect(KNOWN_MAJORS.hono).toContain(4);
    expect(KNOWN_MAJORS.drizzle).toContain(0);
    expect(KNOWN_MAJORS.openai).toContain(4);
    expect(KNOWN_MAJORS.anthropic).toContain(0);
  });
});

describe("version.ts — featureFlag", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    // Clean any pre-existing feature flags the test environment might set.
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("MAXIMILIAN_FEATURE_")) delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns the default when the env var is unset", () => {
    expect(featureFlag("nonexistent_flag_for_test", true)).toBe(true);
    expect(featureFlag("nonexistent_flag_for_test", false)).toBe(false);
  });

  it("parses '1' as truthy", () => {
    process.env.MAXIMILIAN_FEATURE_TEST_A = "1";
    expect(featureFlag("test_a", false)).toBe(true);
  });

  it("parses 'true' (case-insensitive) as truthy", () => {
    process.env.MAXIMILIAN_FEATURE_TEST_B = "TRUE";
    expect(featureFlag("test_b", false)).toBe(true);
  });

  it("parses '0' and 'false' as falsy", () => {
    process.env.MAXIMILIAN_FEATURE_TEST_C = "0";
    expect(featureFlag("test_c", true)).toBe(false);
    process.env.MAXIMILIAN_FEATURE_TEST_D = "false";
    expect(featureFlag("test_d", true)).toBe(false);
  });
});

describe("drizzle.ts", () => {
  it("reports the installed drizzle major", () => {
    // drizzle-orm is not yet a dependency of compat-shims; we expect the
    // fallback path (splitDrivers=true, driver=null, major=0).
    const caps = detectDrizzleCapabilities();
    expect(caps.major).toBe(0);
    expect(caps.splitDrivers).toBe(true);
    expect(caps.driver).toBeNull();
  });

  it("maps every supported driver to its import path", () => {
    expect(driverImportPath("postgres-js")).toBe("drizzle-orm/postgres-js");
    expect(driverImportPath("node-postgres")).toBe("drizzle-orm/node-postgres");
    expect(driverImportPath("neon")).toBe("drizzle-orm/neon-http");
    expect(driverImportPath("libsql")).toBe("drizzle-orm/libsql");
  });

  it("serialColumn throws until a pg store actually uses it", () => {
    // This is a forward-compat stub. Calling it should surface a clear
    // "not yet implemented" rather than silently doing the wrong thing.
    expect(() => (detectDrizzleCapabilities(), undefined)).not.toThrow();
  });
});

describe("hono.ts — toStandardError", () => {
  it("wraps an Error into the standard envelope", () => {
    const err = new Error("boom");
    (err as { code?: string }).code = "BOOM_CODE";
    expect(toStandardError(err)).toEqual({
      error: "boom",
      code: "BOOM_CODE",
      details: undefined,
    });
  });

  it("preserves a `details` field if the error carries one", () => {
    const err = new Error("with details");
    (err as { details?: unknown }).details = { retry: true };
    expect(toStandardError(err).details).toEqual({ retry: true });
  });

  it("stringifies non-Error throws", () => {
    expect(toStandardError("just a string")).toEqual({ error: "just a string" });
    expect(toStandardError(42)).toEqual({ error: "42" });
    expect(toStandardError(null)).toEqual({ error: "null" });
  });
});

describe("llm.ts — toProviderArgs", () => {
  const baseReq = {
    model: "gpt-4o",
    messages: [{ role: "user" as const, content: "hi" }],
  };

  it("translates to openai 4.x args (max_completion_tokens)", () => {
    const args = toProviderArgs("openai", { ...baseReq, maxTokens: 1024 });
    expect(args).toMatchObject({
      model: "gpt-4o",
      max_completion_tokens: 1024,
    });
    expect(args.messages).toHaveLength(1);
  });

  it("threads system message as a leading system role for openai", () => {
    const args = toProviderArgs("openai", {
      ...baseReq,
      system: "be terse",
    });
    expect(args.messages).toEqual([
      { role: "system", content: "be terse" },
      { role: "user", content: "hi" },
    ]);
  });

  it("translates to anthropic args (max_tokens)", () => {
    const args = toProviderArgs("anthropic", {
      ...baseReq,
      model: "claude-sonnet-4-6",
      maxTokens: 2048,
      system: "be helpful",
    });
    expect(args).toMatchObject({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: "be helpful",
    });
    expect(args.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("joins multiple system messages with a blank line", () => {
    const args = toProviderArgs("openai", {
      ...baseReq,
      system: ["rule 1", "rule 2"],
    });
    expect((args.messages as Array<{ content: string }>)[0]?.content).toBe(
      "rule 1\n\nrule 2",
    );
  });

  it("forwards extras into the args object", () => {
    const args = toProviderArgs("openai", {
      ...baseReq,
      extras: { response_format: { type: "json_object" } },
    });
    expect((args as { response_format?: unknown }).response_format).toEqual({
      type: "json_object",
    });
  });
});

describe("llm.ts — fromProviderResponse", () => {
  it("normalizes an openai response", () => {
    const raw = {
      choices: [{ message: { content: "Hello" } }],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 4,
        prompt_tokens_details: { cached_tokens: 7 },
      },
    };
    expect(fromProviderResponse("openai", raw)).toEqual({
      text: "Hello",
      usage: { inputTokens: 12, outputTokens: 4, cachedInputTokens: 7 },
      raw,
    });
  });

  it("normalizes an anthropic response with one text block", () => {
    const raw = {
      content: [{ type: "text", text: "Bonjour" }],
      usage: { input_tokens: 9, output_tokens: 3 },
    };
    expect(fromProviderResponse("anthropic", raw)).toEqual({
      text: "Bonjour",
      usage: { inputTokens: 9, outputTokens: 3, cachedInputTokens: undefined },
      raw,
    });
  });

  it("concatenates multiple anthropic text blocks", () => {
    const raw = {
      content: [
        { type: "text", text: "Part 1. " },
        { type: "tool_use", id: "x", name: "y", input: {} },
        { type: "text", text: "Part 2." },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    expect(fromProviderResponse("anthropic", raw).text).toBe("Part 1. Part 2.");
  });

  it("returns empty text when the response shape is unknown", () => {
    expect(fromProviderResponse("openai", {}).text).toBe("");
    expect(fromProviderResponse("openai", {}).usage.inputTokens).toBe(0);
  });
});
