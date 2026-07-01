/**
 * Tests for the permission matcher — covers glob compilation, pattern
 * precedence, defaults fallback, and JSON config validation.
 */

import { describe, it, expect } from "vitest";
import {
  globToRegex,
  matchPattern,
  extractTarget,
  resolvePermission,
  validatePermissions,
  DEFAULT_PERMISSIONS,
  type Permissions,
  type ToolName,
} from "../src/permission";

describe("globToRegex", () => {
  it("matches * (single segment)", () => {
    expect(globToRegex("*.ts").test("index.ts")).toBe(true);
    expect(globToRegex("*.ts").test("a/b.ts")).toBe(false);
  });

  it("matches ** across segments", () => {
    expect(globToRegex("**/*.ts").test("a/b/c.ts")).toBe(true);
    expect(globToRegex("**/*.ts").test("c.ts")).toBe(true);
  });

  it("escapes regex meta-chars", () => {
    expect(globToRegex("a.b").test("a.b")).toBe(true);
    expect(globToRegex("a.b").test("aXb")).toBe(false);
    expect(globToRegex("foo+bar").test("foo+bar")).toBe(true);
  });

  it("supports ? for single char", () => {
    expect(globToRegex("a?c").test("abc")).toBe(true);
    expect(globToRegex("a?c").test("ac")).toBe(false);
  });
});

describe("matchPattern", () => {
  it("'*' matches everything", () => {
    expect(matchPattern("*", "/anything")).toBe(true);
    expect(matchPattern("", "/anything")).toBe(true);
  });

  it("specific patterns only match their target", () => {
    expect(matchPattern("/tmp/**", "/tmp/foo/bar")).toBe(true);
    expect(matchPattern("/tmp/**", "/etc/passwd")).toBe(false);
  });
});

describe("extractTarget", () => {
  it("returns input.path for file tools", () => {
    expect(extractTarget("read", { path: "/etc/passwd" })).toBe("/etc/passwd");
    expect(extractTarget("write", { path: "/tmp/foo", content: "x" })).toBe("/tmp/foo");
    expect(extractTarget("edit", { path: "/a/b", oldString: "x", newString: "y" })).toBe("/a/b");
  });

  it("prefers path over pattern for glob/grep", () => {
    expect(extractTarget("glob", { pattern: "*.ts" })).toBe("*.ts");
    expect(extractTarget("grep", { pattern: "TODO", path: "/src" })).toBe("/src");
  });

  it("returns command for bash", () => {
    expect(extractTarget("bash", { command: "rm -rf /" })).toBe("rm -rf /");
  });

  it("returns empty string for null/invalid input", () => {
    expect(extractTarget("read", null)).toBe("");
    expect(extractTarget("write", { path: 123 })).toBe("");
  });
});

describe("resolvePermission", () => {
  it("falls back to defaults when no pattern matches", () => {
    const config: Permissions = {
      defaults: { ...DEFAULT_PERMISSIONS.defaults, write: "deny" },
      patterns: {},
    };
    expect(resolvePermission("write", { path: "/anywhere" }, config)).toBe("deny");
  });

  it("uses the first matching pattern", () => {
    const config: Permissions = {
      defaults: { ...DEFAULT_PERMISSIONS.defaults, write: "ask" },
      patterns: {
        write: {
          "/tmp/**": "allow",
          "/tmp/secret": "deny", // never reached (less specific)
        },
      },
    };
    expect(resolvePermission("write", { path: "/tmp/foo" }, config)).toBe("allow");
    // Note: ordering matters; if /tmp/secret listed first, it'd win.
  });

  it("pattern precedence is by object-key order", () => {
    const config: Permissions = {
      defaults: { ...DEFAULT_PERMISSIONS.defaults, write: "ask" },
      patterns: {
        write: {
          "/tmp/secret": "deny",
          "/tmp/**": "allow",
        },
      },
    };
    expect(resolvePermission("write", { path: "/tmp/secret" }, config)).toBe("deny");
  });

  it("unknown tool defaults to ask", () => {
    const config: Permissions = { ...DEFAULT_PERMISSIONS, defaults: { ...DEFAULT_PERMISSIONS.defaults } };
    // @ts-expect-error testing invalid tool name at runtime
    expect(resolvePermission("hypothetical" as ToolName, {}, config)).toBe("ask");
  });
});

describe("validatePermissions", () => {
  it("returns defaults for invalid input", () => {
    expect(validatePermissions(null)).toEqual(DEFAULT_PERMISSIONS);
    expect(validatePermissions({})).toEqual(DEFAULT_PERMISSIONS);
    expect(validatePermissions("not an object")).toEqual(DEFAULT_PERMISSIONS);
  });

  it("drops unknown tools and invalid actions", () => {
    const result = validatePermissions({
      defaults: { write: "always", read: "allow" }, // 'always' invalid
      patterns: { write: { "/tmp/*": "allow", "**/.env": "deny" }, bogus: { "*": "allow" } },
    });
    expect(result.defaults.write).toBe("ask"); // fell back
    expect(result.defaults.read).toBe("allow");
    expect(result.patterns.write).toEqual({ "/tmp/*": "allow", "**/.env": "deny" });
    expect(result.patterns.bogus).toBeUndefined();
  });
});