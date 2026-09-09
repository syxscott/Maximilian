/**
 * Tests for sanitizeDisplayLabel — borrowed pattern from token-monitor.
 * Verifies: length cap, email/URL rejection, allowlist filter, whitespace collapse.
 */

import { describe, it, expect } from "vitest";
import { sanitizeDisplayLabel, DEFAULT_LABEL_MAX_LENGTH } from "../src/validation/sanitize-label.js";

describe("sanitizeDisplayLabel", () => {
  it("passes through clean ASCII labels", () => {
    expect(sanitizeDisplayLabel("My Workspace")).toBe("My Workspace");
    expect(sanitizeDisplayLabel("frontend-agent_v2")).toBe("frontend-agent_v2");
    expect(sanitizeDisplayLabel("Tenant + Co.")).toBe("Tenant + Co.");
  });

  it("trims and collapses whitespace", () => {
    expect(sanitizeDisplayLabel("  hello   world  ")).toBe("hello world");
    // Tabs/newlines are not in the allowlist, so they're stripped; the
    // remaining run "foo" + "bar" has no internal whitespace to collapse.
    expect(sanitizeDisplayLabel("\tfoo\nbar")).toBe("foobar");
  });

  it("strips disallowed characters", () => {
    // slashes, quotes, emoji, control chars → empty
    expect(sanitizeDisplayLabel("foo/bar")).toBe("foobar");
    expect(sanitizeDisplayLabel('say "hi"')).toBe("say hi");
    // emoji + leading space → emoji stripped, leading space trimmed.
    expect(sanitizeDisplayLabel("😀 smile")).toBe("smile");
    expect(sanitizeDisplayLabel("a\x00b")).toBe("ab");
  });

  it("rejects input containing @", () => {
    expect(sanitizeDisplayLabel("user@example.com")).toBe("");
    expect(sanitizeDisplayLabel("a @ b")).toBe("");
  });

  it("rejects input starting with http(s)://", () => {
    expect(sanitizeDisplayLabel("http://evil.com")).toBe("");
    expect(sanitizeDisplayLabel("https://x.io")).toBe("");
    expect(sanitizeDisplayLabel("HTTP://x.io")).toBe("");
    // Doesn't start with http:// (the "see " prefix puts it off), so the
    // URL rejection passes; the allowlist then strips both `:` and `/`.
    expect(sanitizeDisplayLabel("see http://x.io")).toBe("see httpx.io");
  });

  it("respects maxLength (default 64)", () => {
    expect(DEFAULT_LABEL_MAX_LENGTH).toBe(64);
    const long = "a".repeat(100);
    const out = sanitizeDisplayLabel(long);
    expect(out.length).toBe(64);
    expect(out).toBe("a".repeat(64));
  });

  it("respects custom maxLength", () => {
    expect(sanitizeDisplayLabel("a".repeat(20), { maxLength: 8 })).toBe("a".repeat(8));
    expect(sanitizeDisplayLabel("hello world", { maxLength: 5 })).toBe("hello");
  });

  it("returns empty for non-string input", () => {
    expect(sanitizeDisplayLabel(undefined)).toBe("");
    expect(sanitizeDisplayLabel(null)).toBe("");
    expect(sanitizeDisplayLabel(42)).toBe("");
    expect(sanitizeDisplayLabel({})).toBe("");
  });

  it("returns empty for pure-whitespace input", () => {
    expect(sanitizeDisplayLabel("")).toBe("");
    expect(sanitizeDisplayLabel("   ")).toBe("");
    expect(sanitizeDisplayLabel("\n\t  ")).toBe("");
  });

  it("can opt out of @ / URL rejection", () => {
    // With rejectAt off, `@` is stripped by the allowlist; the remaining
    // double space collapses to a single space.
    expect(
      sanitizeDisplayLabel("a @ b", { rejectAt: false, rejectUrl: false }),
    ).toBe("a b");
    // With rejectUrl off, `:` and `/` are still stripped by the allowlist.
    expect(
      sanitizeDisplayLabel("http://x.io", { rejectUrl: false }),
    ).toBe("httpx.io");
  });

  it("trims trailing whitespace after slicing at maxLength", () => {
    // "hello   world" with maxLength=8 → "hello   " → trimEnd → "hello"
    expect(sanitizeDisplayLabel("hello   world", { maxLength: 8 })).toBe("hello");
  });
});