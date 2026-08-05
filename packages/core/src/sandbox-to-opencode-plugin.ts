// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * SandboxToOpencodePlugin — converts a Maximilian `SandboxProfile` into an
 * opencode plugin manifest.
 *
 * 借鉴 opencode:
 *   - Plugins are loaded from `opencode.config.ts` / `opencode.config.json`
 *     as either a bare specifier (`"./my-plugin.js"`) or a tuple with
 *     options (`["./sandbox-plugin.js", { profile: "workspace" }]`).
 *     See `packages/plugin/src/index.ts:Config`.
 *   - A plugin manifest in opencode is a module that exports a `Plugin`
 *     function returning `Hooks`. The `Hooks.permission.ask` hook is
 *     the natural place for the runtime to consult a Maximilian
 *     sandbox policy before letting a tool call through.
 *   - `permission.ask` returns one of `"ask" | "deny" | "allow"`, matching
 *     opencode's `PermissionAction` (`packages/sdk/js/src/v2/gen/types.gen.ts`
 *     line 160).
 *
 * The translator itself does NOT generate executable plugin code (we
 * can't safely emit TS without a build step); it generates the
 * *config* that wires the plugin into opencode. The runtime registers
 * a single maximilian-authored plugin (`@max/opencode-sandbox-plugin`)
 * that, at load time, reads its options to decide how to gate tool
 * calls. `generate()` here produces that options blob.
 *
 * This keeps the migration surface small: opencode doesn't need to
 * understand SandboxProfile, and Maximilian doesn't need to fork the
 * plugin SDK — the two sides agree on a JSON contract.
 */

import {
  SANDBOX_PROFILES,
  SandboxProfileName,
  type NetworkPolicy,
  type PathPolicy,
  type SandboxProfile,
} from "./sandbox-profile.js"

// ── opencode-side shapes ────────────────────────────────────────────────

/**
 * Mirrors the shape opencode expects in `Config.plugin` for a single
 * entry:
 *
 *   plugin: Array<string | [string, PluginOptions]>
 *
 * (`packages/plugin/src/index.ts:Config`)
 *
 * We always emit the tuple form so we can pass the sandbox options
 * through. The `specifier` points to the maximilian-published sandbox
 * plugin module; the `options` is what this translator generates.
 */
export interface OpencodePluginManifest {
  /** Plugin entry in opencode config. */
  plugin: Array<[string, OpencodePluginOptions]>
  /**
   * The generated options blob — exposed separately so callers can
   * pass the same object to a non-opencode consumer (e.g. writing it
   * to `~/.maximilian/sandbox.json` for diagnostics).
   */
  options: OpencodePluginOptions
  /**
   * Stable, deterministic summary of the profile used to generate the
   * options. Useful for logging / cache keys.
   */
  summary: SandboxPluginSummary
}

/** Plugin options accepted by `@max/opencode-sandbox-plugin`. */
export interface OpencodePluginOptions {
  /** Source-of-truth profile name; the plugin reads this first. */
  profile: SandboxProfileName
  /** Workspace the plugin should scope to. */
  workspaceId: string
  /** Path policy translated into the plugin's native shape. */
  paths: OpencodePluginPathPolicy
  /** Network policy translated into the plugin's native shape. */
  network: OpencodePluginNetworkPolicy
  /** Tool allow / deny lists as opencode `permission.ruleset` entries. */
  permission: OpencodePluginPermissionRuleset
  /** Resource limits (memory / cpu), only present when set on the profile. */
  limits?: OpencodePluginLimits
  /** Whether the plugin should inherit the host env when shelling out. */
  inheritEnv: boolean
}

/** Path policy in the plugin's vocabulary. */
export interface OpencodePluginPathPolicy {
  /** Glob patterns that ARE allowed. Empty array = no path restriction. */
  allow: string[]
  /** Glob patterns that are NEVER allowed (checked before allow). */
  deny: string[]
  /** Whether parent-directory traversal (`..`) is permitted. */
  allowParentTraversal: boolean
}

/** Network policy in the plugin's vocabulary. */
export type OpencodePluginNetworkPolicy =
  | { mode: "allow" }
  | { mode: "deny" }
  | { mode: "allow-list"; hosts: string[] }
  | { mode: "read-only" }

/**
 * Mirrors `PermissionRule[]` from
 * `packages/sdk/js/src/v2/gen/types.gen.ts:160-168`:
 *
 *   type PermissionRule = { permission: string; pattern: string; action: "allow" | "deny" | "ask" }
 *
 * 借鉴 opencode - we emit rules in *first-match-wins* order, which is
 * the same order the Maximilian `patterns` map uses
 * (`packages/tools/src/permission.ts:resolvePermission`). Order
 * matters: `deny` rules for sensitive paths must appear before the
 * blanket `allow` rules or they get shadowed.
 */
export interface OpencodePluginPermissionRule {
  permission: string
  pattern: string
  action: "allow" | "deny" | "ask"
}

export type OpencodePluginPermissionRuleset = OpencodePluginPermissionRule[]

/** Optional resource limits carried by the plugin options. */
export interface OpencodePluginLimits {
  memoryLimitMB?: number
  cpuTimeLimit?: number
}

/** Compact, log-friendly summary of the generated plugin config. */
export interface SandboxPluginSummary {
  profile: SandboxProfileName
  workspaceId: string
  pathAllowCount: number
  pathDenyCount: number
  rulesetCount: number
  hasNetworkRestriction: boolean
  hasLimits: boolean
}

// ── internal helpers ────────────────────────────────────────────────────

/** Map Maximilian `PathPolicy` to plugin vocabulary. */
function translatePaths(paths: PathPolicy | undefined): OpencodePluginPathPolicy {
  if (!paths) {
    return { allow: [], deny: [], allowParentTraversal: false }
  }
  return {
    allow: paths.allow ? [...paths.allow] : [],
    deny: paths.deny ? [...paths.deny] : [],
    allowParentTraversal: paths.allowParentTraversal ?? false,
  }
}

/**
 * Map Maximilian `NetworkPolicy` to plugin vocabulary.
 * The Maximilian enum already uses string literals compatible with
 * the opencode side, but we re-emit via a switch to lock the contract.
 */
function translateNetwork(network: NetworkPolicy | undefined): OpencodePluginNetworkPolicy {
  if (!network) return { mode: "allow" }
  switch (network.mode) {
    case "allow":
    case "deny":
    case "read-only":
      return { mode: network.mode }
    case "allow-list":
      return { mode: "allow-list", hosts: [...network.hosts] }
    default: {
      const exhaustive: never = network
      throw new Error(
        `SandboxToOpencodePlugin: unknown network mode "${String(exhaustive)}"`,
      )
    }
  }
}

/**
 * Build the `permission.ruleset` array from the profile's
 * allowed/denied command lists.
 *
 * The translator emits one rule per command; order is deny-then-allow
 * so a deny on a specific command always shadows a broad allow.
 * Deny-list patterns are first because the opencode plugin evaluates
 * them in array order (same as Maximilian).
 */
function translatePermissionRules(profile: SandboxProfile): OpencodePluginPermissionRuleset {
  const rules: OpencodePluginPermissionRuleset = []

  // 1) Explicit denies first.
  for (const cmd of profile.deniedCommands ?? []) {
    if (cmd === "*") {
      // "deny everything" — emit a single wildcard rule and stop. An
      // "allow all" followed by "deny *" would be shadowed by opencode's
      // first-match-wins, so we *only* emit the deny.
      rules.push({ permission: "bash", pattern: "*", action: "deny" })
      continue
    }
    rules.push({ permission: "bash", pattern: cmd, action: "deny" })
  }

  // 2) Then allow-list. If empty, do NOT emit a blanket "*" allow — the
  // plugin should fall back to opencode's default permission config,
  // which already gates write/edit/etc.
  for (const cmd of profile.allowedCommands ?? []) {
    rules.push({ permission: "bash", pattern: cmd, action: "allow" })
  }

  return rules
}

// ── SandboxToOpencodePlugin ─────────────────────────────────────────────

/**
 * `SandboxToOpencodePlugin` is a stateless translator. It is exposed
 * as a class so it can be mocked / DI'd in the same way as Maximilian's
 * other sandbox helpers. All public methods are pure.
 */
export class SandboxToOpencodePlugin {
  /** Specifier of the maximilian-published sandbox plugin module. */
  static readonly PLUGIN_SPECIFIER = "@max/opencode-sandbox-plugin"

  /**
   * Generate an opencode plugin manifest for the given profile.
   *
   * @param opts.profile     A Maximilian `SandboxProfile` (use one of
   *                          `SANDBOX_PROFILES[profileName]` for the
   *                          built-in presets, or a custom profile).
   * @param opts.workspaceId The workspace this plugin should scope to.
   *                          Used by the plugin to attach the policy
   *                          to the right session.
   *
   * The returned manifest is JSON-serializable — callers can
   * `JSON.stringify(...)` it without further preparation. The
   * `plugin` array is shaped to drop directly into opencode's
   * `Config.plugin` field.
   */
  generate(opts: {
    profile: SandboxProfile
    workspaceId: string
  }): OpencodePluginManifest {
    const { profile, workspaceId } = opts
    if (!profile) {
      throw new Error("SandboxToOpencodePlugin.generate: profile is required")
    }
    if (!workspaceId || typeof workspaceId !== "string") {
      throw new Error("SandboxToOpencodePlugin.generate: workspaceId is required")
    }

    const options: OpencodePluginOptions = {
      profile: profile.name,
      workspaceId,
      paths: translatePaths(profile.paths),
      network: translateNetwork(profile.network),
      permission: translatePermissionRules(profile),
      inheritEnv: profile.inheritEnv ?? false,
    }

    if (profile.memoryLimitMB !== undefined) {
      options.limits = { ...(options.limits ?? {}), memoryLimitMB: profile.memoryLimitMB }
    }
    if (profile.cpuTimeLimit !== undefined) {
      options.limits = { ...(options.limits ?? {}), cpuTimeLimit: profile.cpuTimeLimit }
    }

    const summary: SandboxPluginSummary = {
      profile: profile.name,
      workspaceId,
      pathAllowCount: options.paths.allow.length,
      pathDenyCount: options.paths.deny.length,
      rulesetCount: options.permission.length,
      hasNetworkRestriction: options.network.mode !== "allow",
      hasLimits: options.limits !== undefined,
    }

    return {
      plugin: [[SandboxToOpencodePlugin.PLUGIN_SPECIFIER, options]],
      options,
      summary,
    }
  }

  /**
   * Convenience helper that builds the manifest for one of the
   * built-in sandbox profiles by name. Equivalent to
   * `generate({ profile: SANDBOX_PROFILES[name], workspaceId })`.
   */
  generateByName(opts: {
    name: SandboxProfileName
    workspaceId: string
  }): OpencodePluginManifest {
    const profile = SANDBOX_PROFILES[opts.name]
    if (!profile) {
      throw new Error(
        `SandboxToOpencodePlugin.generateByName: unknown profile "${opts.name}"`,
      )
    }
    return this.generate({ profile, workspaceId: opts.workspaceId })
  }
}

/** Convenience factory mirroring `OpencodePermissionTranslator`. */
export function createSandboxToOpencodePlugin(): SandboxToOpencodePlugin {
  return new SandboxToOpencodePlugin()
}
