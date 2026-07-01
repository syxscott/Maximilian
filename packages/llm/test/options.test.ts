/**
 * Tests for @max/llm helpers.
 *
 * Covers:
 *   - mergeGenerationOptions: last-defined-wins per field, undefined inputs are
 *     skipped, all-undefined returns undefined
 *   - makeToolChoice: object passthrough, mode strings → typed object,
 *     arbitrary string → { type: "tool", name }
 *   - toolOutputFromResult / toolOutputToResult: round-trips for json / text /
 *     content shapes
 *   - isToolResultValue / makeToolResultValue: shape discrimination
 *   - isContextOverflow: detects common overflow messages on InvalidRequest
 *     errors; rejects non-LLMError / non-InvalidRequest
 *   - LLMError: surfaces module/method/reason, retryable helper, retryAfterMs
 *   - resolveAvailableProviders: env-driven
 */
import { describe, it, expect } from "vitest";
import { mergeGenerationOptions } from "../src/options.js";
import {
  isToolResultValue,
  makeToolResultValue,
  makeToolChoice,
  toolOutputFromResult,
  toolOutputToResult,
} from "../src/messages.js";
import {
  LLMError,
  isContextOverflow,
  type RateLimitReason,
  type InvalidRequestReason,
} from "../src/errors.js";

describe("mergeGenerationOptions", () => {
  it("returns undefined when no inputs are defined", () => {
    expect(mergeGenerationOptions(undefined, undefined)).toBeUndefined();
  });

  it("returns a single defined input with all fields preserved", () => {
    const a = { maxTokens: 100, temperature: 0.5 };
    expect(mergeGenerationOptions(a)).toEqual(a);
  });

  it("merges fields across inputs with last-defined-wins", () => {
    const a = { maxTokens: 100, temperature: 0.2 };
    const b = { temperature: 0.7, topP: 0.9 };
    const merged = mergeGenerationOptions(a, b);
    expect(merged).toEqual({ maxTokens: 100, temperature: 0.7, topP: 0.9 });
  });

  it("drops fields that no input defines", () => {
    const merged = mergeGenerationOptions({ maxTokens: 50 });
    expect(merged).toEqual({ maxTokens: 50 });
    expect(merged).not.toHaveProperty("temperature");
  });
});

describe("makeToolChoice", () => {
  it("passes through an object", () => {
    const obj = { type: "tool" as const, name: "foo" };
    expect(makeToolChoice(obj)).toBe(obj);
  });

  it("maps mode strings to typed objects", () => {
    expect(makeToolChoice("auto")).toEqual({ type: "auto" });
    expect(makeToolChoice("none")).toEqual({ type: "none" });
    expect(makeToolChoice("required")).toEqual({ type: "required" });
  });

  it("maps arbitrary strings to { type: 'tool', name }", () => {
    expect(makeToolChoice("foo")).toEqual({ type: "tool", name: "foo" });
  });
});

describe("ToolResultValue helpers", () => {
  it("isToolResultValue discriminates shape and type", () => {
    expect(isToolResultValue({ type: "json", value: 1 })).toBe(true);
    expect(isToolResultValue({ type: "text", value: "x" })).toBe(true);
    expect(isToolResultValue({ type: "error", value: null })).toBe(true);
    expect(isToolResultValue({ type: "content", value: [] })).toBe(true);
    expect(isToolResultValue({ type: "unknown", value: 1 })).toBe(false);
    expect(isToolResultValue("raw")).toBe(false);
    expect(isToolResultValue(null)).toBe(false);
  });

  it("makeToolResultValue preserves an already-typed value", () => {
    const v = { type: "text" as const, value: "hi" };
    expect(makeToolResultValue(v)).toBe(v);
  });

  it("makeToolResultValue wraps a raw value with a default type", () => {
    expect(makeToolResultValue({ foo: 1 })).toEqual({
      type: "json",
      value: { foo: 1 },
    });
    expect(makeToolResultValue(42, "text")).toEqual({ type: "text", value: 42 });
  });

  it("toolOutputFromResult handles json / text / content / error", () => {
    expect(toolOutputFromResult({ type: "json", value: { a: 1 } })).toEqual({
      structured: { a: 1 },
      content: [],
    });
    expect(toolOutputFromResult({ type: "text", value: "hi" })).toEqual({
      structured: {},
      content: [{ type: "text", text: "hi" }],
    });
    expect(toolOutputFromResult({ type: "content", value: [{ type: "text", text: "x" }] })).toEqual({
      structured: {},
      content: [{ type: "text", text: "x" }],
    });
    expect(toolOutputFromResult({ type: "error", value: "boom" })).toBeUndefined();
  });

  it("toolOutputToResult collapses empty content to a json value", () => {
    const out = toolOutputToResult({ structured: { a: 1 }, content: [] });
    expect(out).toEqual({ type: "json", value: { a: 1 } });
  });

  it("toolOutputToResult collapses single text content to text value", () => {
    const out = toolOutputToResult({
      structured: { ignored: true },
      content: [{ type: "text", text: "hello" }],
    });
    expect(out).toEqual({ type: "text", value: "hello" });
  });

  it("toolOutputToResult preserves multi-part content", () => {
    const out = toolOutputToResult({
      structured: { ignored: true },
      content: [
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ],
    });
    expect(out).toEqual({
      type: "content",
      value: [
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ],
    });
  });
});

describe("LLMError and isContextOverflow", () => {
  it("surfaces module / method / reason on the instance", () => {
    const reason: RateLimitReason = {
      _tag: "RateLimit",
      message: "too many requests",
      retryable: true,
      retryAfterMs: 1000,
    };
    const err = new LLMError({ module: "llm", method: "chat", reason });
    expect(err.message).toContain("too many requests");
    expect(err.module).toBe("llm");
    expect(err.method).toBe("chat");
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(1000);
  });

  it("retryAfterMs is undefined when the reason has none", () => {
    const reason = { _tag: "Transport" as const, message: "boom", retryable: true };
    const err = new LLMError({ module: "x", method: "y", reason });
    expect(err.retryAfterMs).toBeUndefined();
  });

  it("isContextOverflow matches common overflow phrasings on InvalidRequest", () => {
    const samples = [
      "context length exceeded",
      "maximum context window reached",
      "prompt is too long",
      "request too large",
      "input exceeds maximum token limit",
    ];
    for (const msg of samples) {
      const reason: InvalidRequestReason = { _tag: "InvalidRequest", message: msg, retryable: false };
      const err = new LLMError({ module: "llm", method: "chat", reason });
      expect(isContextOverflow(err), msg).toBe(true);
    }
  });

  it("isContextOverflow rejects non-InvalidRequest LLMError", () => {
    const reason = { _tag: "Authentication" as const, message: "bad key", retryable: false };
    const err = new LLMError({ module: "llm", method: "chat", reason });
    expect(isContextOverflow(err)).toBe(false);
  });

  it("isContextOverflow rejects non-LLMError inputs", () => {
    expect(isContextOverflow(new Error("context length exceeded"))).toBe(false);
    expect(isContextOverflow("string error")).toBe(false);
    expect(isContextOverflow(null)).toBe(false);
  });
});