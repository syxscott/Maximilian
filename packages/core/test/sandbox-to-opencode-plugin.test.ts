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

  it("emits bash allow rules for each allowed command plus file-tool allow rules from paths.allow", () => {
    // M3-fix: in addition to the bash allow rules, the file-tool
    // permission ruleset now receives allow rules for paths.allow.
    // This test focuses on bash; the file-tool part is covered in
    // the dedicated M3 describe block below.
    const allowRules = manifest.options.permission.filter((r) => r.action === "allow");
    // Workspace allows git, npm, pnpm, yarn, node, make, gcc, g++, cargo, rustc
    expect(allowRules.length).toBeGreaterThan(0);
    expect(allowRules.map((r) => r.pattern)).toEqual(
      expect.arrayContaining(["git", "npm", "pnpm", "yarn", "node", "make", "cargo"]),
    );
    const bashAllowRules = allowRules.filter((r) => r.permission === "bash");
    expect(bashAllowRules.length).toBeGreaterThan(0);
    // After M3: 5 file-tool allow rules for paths.allow=["**"]
    const fileAllowRules = allowRules.filter((r) =>
      ["read", "write", "edit", "glob", "grep"].includes(r.permission),
    );
    expect(fileAllowRules.length).toBe(5);
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

  it("does NOT emit bash allow rules (no allowCommands on ReadOnly), but emits file-tool allow rules from paths.allow", () => {
    // M3-fix: paths.allow=["**"] now propagates to the file-tool
    // permission ruleset. Bash allow rules remain zero (ReadOnly has
    // no allowedCommands).
    const allowRules = manifest.options.permission.filter((r) => r.action === "allow");
    expect(allowRules).toHaveLength(5);
    const bashAllowRules = allowRules.filter((r) => r.permission === "bash");
    expect(bashAllowRules).toHaveLength(0);
    const fileAllowRules = allowRules.filter((r) =>
      ["read", "write", "edit", "glob", "grep"].includes(r.permission),
    );
    expect(fileAllowRules).toHaveLength(5);
    for (const r of fileAllowRules) {
      expect(r.pattern).toBe("**");
    }
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

  it("emits a single wildcard deny rule for bash plus file-tool deny rules from path policy", () => {
    // M3-fix: in addition to the bash wildcard deny, the file tools
    // (read/write/edit/glob/grep) must each receive a deny rule for
    // "**" because paths.deny=["**"]. The first rule is the bash
    // wildcard deny (already-existing behavior); the rest are the
    // file-tool rules added by M3.
    const denyRules = manifest.options.permission.filter((r) => r.action === "deny");
    expect(denyRules[0]).toEqual({ permission: "bash", pattern: "*", action: "deny" });
    // After M3: 5 file-tool deny rules (one per file tool)
    const fileDenyRules = denyRules.filter((r) =>
      ["read", "write", "edit", "glob", "grep"].includes(r.permission),
    );
    expect(fileDenyRules).toHaveLength(5);
    for (const r of fileDenyRules) {
      expect(r.pattern).toBe("**");
      expect(r.action).toBe("deny");
    }
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
    // M3-fix: bash allow rules are still emitted, and now file-tool
    // rules are too. Order: deny rules (per file tool) → bash allow
    // rules → file-tool allow rules.
    expect(manifest.options.permission).toEqual([
      // /workspace/.env deny × 5 file tools
      { permission: "read", pattern: "/workspace/.env", action: "deny" },
      { permission: "write", pattern: "/workspace/.env", action: "deny" },
      { permission: "edit", pattern: "/workspace/.env", action: "deny" },
      { permission: "glob", pattern: "/workspace/.env", action: "deny" },
      { permission: "grep", pattern: "/workspace/.env", action: "deny" },
      // bash allow-list
      { permission: "bash", pattern: "ls", action: "allow" },
      { permission: "bash", pattern: "cat", action: "allow" },
      // /workspace/** allow × 5 file tools
      { permission: "read", pattern: "/workspace/**", action: "allow" },
      { permission: "write", pattern: "/workspace/**", action: "allow" },
      { permission: "edit", pattern: "/workspace/**", action: "allow" },
      { permission: "glob", pattern: "/workspace/**", action: "allow" },
      { permission: "grep", pattern: "/workspace/**", action: "allow" },
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

// ── M3: PathPolicy translates into file-tool permission rules ────────────

describe("SandboxToOpencodePlugin — M3 path policy → file-tool rules", () => {
  const t = new SandboxToOpencodePlugin();
  const FILE_TOOLS = ["read", "write", "edit", "glob", "grep"] as const;

  it("Strict profile emits deny rules for all five file tools", () => {
    // The Strict profile denies everything via paths.deny=["**"]. M3
    // requires that this deny propagates to the file-tool permission
    // ruleset so opencode's read/write/edit/glob/grep honor the
    // restriction. Before M3, only bash deny rules were emitted.
    const manifest = t.generateByName({
      name: SandboxProfileName.Strict,
      workspaceId: WORKSPACE,
    });
    for (const tool of FILE_TOOLS) {
      const denyRule = manifest.options.permission.find(
        (r) => r.permission === tool && r.pattern === "**" && r.action === "deny",
      );
      expect(denyRule).toBeDefined();
    }
  });

  it("Workspace profile emits deny rules for /etc/**, /root/**, /sys/**, /proc/** on all file tools", () => {
    const manifest = t.generateByName({
      name: SandboxProfileName.Workspace,
      workspaceId: WORKSPACE,
    });
    const denyPatterns = ["/etc/**", "/root/**", "/sys/**", "/proc/**"];
    for (const tool of FILE_TOOLS) {
      for (const pattern of denyPatterns) {
        const rule = manifest.options.permission.find(
          (r) => r.permission === tool && r.pattern === pattern && r.action === "deny",
        );
        expect(rule, `missing deny rule for ${tool}:${pattern}`).toBeDefined();
      }
    }
  });

  it("Workspace profile emits allow rule for /** on all file tools", () => {
    const manifest = t.generateByName({
      name: SandboxProfileName.Workspace,
      workspaceId: WORKSPACE,
    });
    for (const tool of FILE_TOOLS) {
      const allowRule = manifest.options.permission.find(
        (r) => r.permission === tool && r.pattern === "**" && r.action === "allow",
      );
      expect(allowRule, `missing /** allow rule for ${tool}`).toBeDefined();
    }
  });

  it("custom profile with paths emits file-tool rules in deny-then-allow order", () => {
    const profile: SandboxProfile = {
      name: SandboxProfileName.Off,
      paths: { allow: ["**"], deny: ["/secret/**"] },
    };
    const manifest = t.generate({ profile, workspaceId: WORKSPACE });
    // For each file tool, deny for /secret/** must appear BEFORE
    // allow for /** so opencode's first-match-wins honors the deny.
    for (const tool of FILE_TOOLS) {
      const denyIdx = manifest.options.permission.findIndex(
        (r) => r.permission === tool && r.pattern === "/secret/**" && r.action === "deny",
      );
      const allowIdx = manifest.options.permission.findIndex(
        (r) => r.permission === tool && r.pattern === "**" && r.action === "allow",
      );
      expect(denyIdx).toBeGreaterThanOrEqual(0);
      expect(allowIdx).toBeGreaterThanOrEqual(0);
      expect(denyIdx, `${tool}: /secret/** deny must precede /** allow`).toBeLessThan(allowIdx);
    }
  });

  it("profile with no paths emits zero file-tool rules", () => {
    const profile: SandboxProfile = {
      name: SandboxProfileName.Off,
      // no `paths` field
    };
    const manifest = t.generate({ profile, workspaceId: WORKSPACE });
    const fileRules = manifest.options.permission.filter((r) =>
      FILE_TOOLS.includes(r.permission as (typeof FILE_TOOLS)[number]),
    );
    expect(fileRules).toEqual([]);
  });
});
