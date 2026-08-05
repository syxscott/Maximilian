// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for SandboxToOpencodePlugin — verifies the Maximilian
 * `SandboxProfile` → opencode plugin manifest translation.
 *
 * 借鉴 opencode:
 *   - Plugin manifests are tuples in `Config.plugin`
 *     (`packages/plugin/src/index.ts:Config`).
 *   - `PermissionRule = { permission, pattern, action }`
 *     (`packages/sdk/js/src/v2/gen/types.gen.ts:162`).
 *
 * Strategy: snapshot-style expectations per built-in profile, plus
 * edge cases (custom profile, missing limits, deny-all profile).
 */

import { describe, it, expect } from "vitest";

import {
  SandboxToOpencodePlugin,
  createSandboxToOpencodePlugin,
  type OpencodePluginManifest,
} from "../src/sandbox-to-opencode-plugin";
import {
  SANDBOX_PROFILES,
  SandboxProfileName,
  type SandboxProfile,
} from "../src/sandbox-profile";

const WORKSPACE = "ws-test-1";

// ── factory ─────────────────────────────────────────────────────────────

describe("SandboxToOpencodePlugin factory", () => {
  it("createSandboxToOpencodePlugin returns a translator instance", () => {
    const t = createSandboxToOpencodePlugin();
    expect(t).toBeInstanceOf(SandboxToOpencodePlugin);
  });

  it("exposes the plugin specifier", () => {
    expect(SandboxToOpencodePlugin.PLUGIN_SPECIFIER).toBe("@max/opencode-sandbox-plugin");
  });
});

// ── built-in profile snapshots ──────────────────────────────────────────

describe("SandboxToOpencodePlugin — Workspace profile", () => {
  const t = new SandboxToOpencodePlugin();
  const manifest = t.generate({
    profile: SANDBOX_PROFILES[SandboxProfileName.Workspace],
    workspaceId: WORKSPACE,
  });

  it("emits a single plugin entry with the right specifier", () => {
    expect(manifest.plugin).toHaveLength(1);
    const [specifier, options] = manifest.plugin[0]!;
    expect(specifier).toBe("@max/opencode-sandbox-plugin");
    expect(options.profile).toBe("workspace");
    expect(options.workspaceId).toBe(WORKSPACE);
  });

  it("carries the workspace path policy verbatim", () => {
    expect(manifest.options.paths.allow).toEqual(["**"]);
    expect(manifest.options.paths.deny).toEqual([
      "/etc/**",
      "/root/**",
      "/sys/**",
      "/proc/**",
    ]);
    expect(manifest.options.paths.allowParentTraversal).toBe(false);
  });

  it("carries the network policy (allow)", () => {
    expect(manifest.options.network).toEqual({ mode: "allow" });
  });

  it("emits allow rules for each allowed command", () => {
    const allowRules = manifest.options.permission.filter((r) => r.action === "allow");
    // Workspace allows git, npm, pnpm, yarn, node, make, gcc, g++, cargo, rustc
    // (note: 'npm' appears twice in the source — we de-dup at the
    // translator level via the rule shape)
    expect(allowRules.length).toBeGreaterThan(0);
    expect(allowRules.map((r) => r.pattern)).toEqual(
      expect.arrayContaining(["git", "npm", "pnpm", "yarn", "node", "make", "cargo"]),
    );
    for (const rule of allowRules) {
      expect(rule.permission).toBe("bash");
    }
  });

  it("does NOT include limits (none set on workspace)", () => {
    expect(manifest.options.limits).toBeUndefined();
  });

  it("marks inheritEnv=true", () => {
    expect(manifest.options.inheritEnv).toBe(true);
  });

  it("summary reflects the profile", () => {
    expect(manifest.summary).toEqual({
      profile: "workspace",
      workspaceId: WORKSPACE,
      pathAllowCount: 1,
      pathDenyCount: 4,
      rulesetCount: manifest.options.permission.length,
      hasNetworkRestriction: false,
      hasLimits: false,
    });
  });
});

describe("SandboxToOpencodePlugin — ReadOnly profile", () => {
  const t = new SandboxToOpencodePlugin();
  const manifest = t.generate({
    profile: SANDBOX_PROFILES[SandboxProfileName.ReadOnly],
    workspaceId: WORKSPACE,
  });

  it("denies the network", () => {
    expect(manifest.options.network).toEqual({ mode: "deny" });
    expect(manifest.summary.hasNetworkRestriction).toBe(true);
  });

  it("emits deny rules for each dangerous command", () => {
    const denyRules = manifest.options.permission.filter((r) => r.action === "deny");
    expect(denyRules.map((r) => r.pattern)).toEqual(
      expect.arrayContaining(["bash", "sh", "node", "python", "python3", "ruby", "perl", "php"]),
    );
  });

  it("does NOT emit allow rules (no allowCommands on ReadOnly)", () => {
    const allowRules = manifest.options.permission.filter((r) => r.action === "allow");
    expect(allowRules).toHaveLength(0);
  });
});

describe("SandboxToOpencodePlugin — Devbox profile", () => {
  const t = new SandboxToOpencodePlugin();
  const manifest = t.generate({
    profile: SANDBOX_PROFILES[SandboxProfileName.Devbox],
    workspaceId: WORKSPACE,
  });

  it("translates the allow-list network policy", () => {
    expect(manifest.options.network).toEqual({
      mode: "allow-list",
      hosts: ["localhost", "127.0.0.1", "::1"],
    });
  });

  it("carries memory and CPU limits", () => {
    expect(manifest.options.limits).toEqual({
      memoryLimitMB: 2048,
      cpuTimeLimit: 300,
    });
    expect(manifest.summary.hasLimits).toBe(true);
  });

  it("emits deny rules for destructive commands", () => {
    const denyRules = manifest.options.permission.filter((r) => r.action === "deny");
    expect(denyRules.map((r) => r.pattern)).toEqual(
      expect.arrayContaining(["rm", "dd", "mkfs", "fdisk", "mount", "umount"]),
    );
  });

  it("does not inherit env", () => {
    expect(manifest.options.inheritEnv).toBe(false);
  });
});

describe("SandboxToOpencodePlugin — Strict profile", () => {
  const t = new SandboxToOpencodePlugin();
  const manifest = t.generate({
    profile: SANDBOX_PROFILES[SandboxProfileName.Strict],
    workspaceId: WORKSPACE,
  });

  it("emits a single wildcard deny rule for bash", () => {
    const denyRules = manifest.options.permission.filter((r) => r.action === "deny");
    expect(denyRules).toEqual([
      { permission: "bash", pattern: "*", action: "deny" },
    ]);
  });

  it("carries the small resource limits", () => {
    expect(manifest.options.limits).toEqual({
      memoryLimitMB: 512,
      cpuTimeLimit: 60,
    });
  });

  it("denies everything by path", () => {
    expect(manifest.options.paths.allow).toEqual([]);
    expect(manifest.options.paths.deny).toEqual(["**"]);
  });
});

describe("SandboxToOpencodePlugin — Off profile", () => {
  const t = new SandboxToOpencodePlugin();
  const manifest = t.generate({
    profile: SANDBOX_PROFILES[SandboxProfileName.Off],
    workspaceId: WORKSPACE,
  });

  it("produces an empty ruleset (no commands gated)", () => {
    expect(manifest.options.permission).toEqual([]);
  });

  it("uses allow-all paths + network", () => {
    expect(manifest.options.paths).toEqual({
      allow: [],
      deny: [],
      allowParentTraversal: false,
    });
    expect(manifest.options.network).toEqual({ mode: "allow" });
  });
});

// ── ordering: deny rules precede allow rules ───────────────────────────

describe("SandboxToOpencodePlugin — rule ordering", () => {
  const t = new SandboxToOpencodePlugin();

  it("puts deny rules before allow rules so they win first-match-wins", () => {
    const profile: SandboxProfile = {
      name: "test-mixed",
      description: "Mixed allow+deny profile for ordering test",
      paths: { allow: ["**"], deny: [] },
      network: { mode: "allow" },
      allowedCommands: ["git", "npm"],
      deniedCommands: ["rm"],
    };
    const manifest = t.generate({ profile, workspaceId: WORKSPACE });
    const idxDeny = manifest.options.permission.findIndex((r) => r.action === "deny");
    const idxAllow = manifest.options.permission.findIndex((r) => r.action === "allow");
    expect(idxDeny).toBeGreaterThanOrEqual(0);
    expect(idxAllow).toBeGreaterThanOrEqual(0);
    expect(idxDeny).toBeLessThan(idxAllow);
  });
});

// ── custom profile without limits ──────────────────────────────────────

describe("SandboxToOpencodePlugin — custom profile", () => {
  const t = new SandboxToOpencodePlugin();

  it("translates a custom profile and omits limits when not set", () => {
    const profile: SandboxProfile = {
      name: "custom-1",
      paths: { allow: ["/workspace/**"], deny: ["/workspace/.env"] },
      network: { mode: "read-only" },
      allowedCommands: ["ls", "cat"],
    };
    const manifest = t.generate({ profile, workspaceId: WORKSPACE });
    expect(manifest.options.profile).toBe("custom-1");
    expect(manifest.options.paths.allow).toEqual(["/workspace/**"]);
    expect(manifest.options.paths.deny).toEqual(["/workspace/.env"]);
    expect(manifest.options.network).toEqual({ mode: "read-only" });
    expect(manifest.options.limits).toBeUndefined();
    expect(manifest.options.permission).toEqual([
      { permission: "bash", pattern: "ls", action: "allow" },
      { permission: "bash", pattern: "cat", action: "allow" },
    ]);
    expect(manifest.summary.hasNetworkRestriction).toBe(true);
    expect(manifest.summary.hasLimits).toBe(false);
  });
});

// ── generateByName ──────────────────────────────────────────────────────

describe("SandboxToOpencodePlugin.generateByName", () => {
  const t = new SandboxToOpencodePlugin();

  it("looks up a built-in profile by name", () => {
    const manifest = t.generateByName({
      name: SandboxProfileName.Strict,
      workspaceId: WORKSPACE,
    });
    expect(manifest.options.profile).toBe("strict");
    expect(manifest.options.limits).toEqual({
      memoryLimitMB: 512,
      cpuTimeLimit: 60,
    });
  });

  it("throws on unknown profile names", () => {
    expect(() =>
      t.generateByName({
        // @ts-expect-error — testing runtime guard
        name: "nonexistent",
        workspaceId: WORKSPACE,
      }),
    ).toThrow(/unknown profile/);
  });
});

// ── input validation ────────────────────────────────────────────────────

describe("SandboxToOpencodePlugin.generate — input validation", () => {
  const t = new SandboxToOpencodePlugin();

  it("rejects missing profile", () => {
    // @ts-expect-error — testing runtime guard
    expect(() => t.generate({ profile: undefined, workspaceId: WORKSPACE })).toThrow(
      /profile is required/,
    );
  });

  it("rejects missing workspaceId", () => {
    expect(() =>
      t.generate({
        profile: SANDBOX_PROFILES[SandboxProfileName.Off],
        // @ts-expect-error — testing runtime guard
        workspaceId: "",
      }),
    ).toThrow(/workspaceId is required/);
  });
});

// ── JSON-serializability ───────────────────────────────────────────────

describe("SandboxToOpencodePlugin — JSON round-trip", () => {
  const t = new SandboxToOpencodePlugin();

  it("the manifest is JSON-serializable for every built-in profile", () => {
    for (const name of Object.values(SandboxProfileName)) {
      const manifest = t.generate({
        profile: SANDBOX_PROFILES[name],
        workspaceId: WORKSPACE,
      });
      const json = JSON.stringify(manifest)
      expect(() => JSON.parse(json)).not.toThrow()
      const parsed = JSON.parse(json) as OpencodePluginManifest
      expect(parsed.options.profile).toBe(name)
    }
  });
});
