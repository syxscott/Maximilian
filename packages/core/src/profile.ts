// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Profile — agent runtime profile (借鉴 Open Interpreter Profile).
 *
 * Open Interpreter profiles are YAML files that bundle a system prompt,
 * model choice, tool enablement, and sandbox backend into a single named
 * configuration. Maximilian adapts this with:
 *  - AgentProfile: a serialisable manifest (ID, name, prompts, tool list,
 *    sandbox backend, model/temperature settings)
 *  - ProfileRegistry: resolves profiles by ID and loads from directories
 *
 * Profiles are the unit of "agent persona" configuration — a profile can
 * be selected at runtime to reconfigure an agent without code changes.
 *
 * @see https://github.com/OpenInterpreter/open-interpreter/blob/main/interpreter/terminal_interface/profiles/default.yaml
 */

import { readFile } from "node:fs/promises"
import { readdir } from "node:fs/promises"
import { resolve, extname } from "node:path"
import type { SandboxBackend } from "./sandbox.js"

// ── Minimal RoleRegistry / ToolRegistry interfaces ─────────────────────────────
// These are defined locally to avoid a circular dependency between
// @max/core (profile.ts) and @max/agents (roles.ts).

export interface RoleRegistry {
  get(roleId: string): unknown
  list(): unknown[]
}

export interface ToolRegistry {
  listTools(): unknown[]
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentProfile {
  id: string
  name: string
  /** System prompt prepended to every agent conversation. */
  systemPrompt: string
  /** Default model identifier (e.g., "gpt-4o"). */
  model?: string
  /** Explicit list of enabled tool names. Undefined = all registered. */
  enabledTools?: string[]
  /** Toolkit IDs to enable. */
  enabledToolkits?: string[]
  /** Sandbox backend to use for command execution. */
  sandboxBackend?: SandboxBackend
  maxTokens?: number
  temperature?: number
}

// ── Built-in profiles ──────────────────────────────────────────────────────────

export const BUILT_IN_PROFILES: AgentProfile[] = [
  {
    id: "default",
    name: "Default",
    systemPrompt:
      "You are a helpful AI assistant. Follow the user's request carefully and produce working, well-structured code.",
    sandboxBackend: "local",
  },
  {
    id: "security",
    name: "Security Hardened",
    systemPrompt:
      "You are a security-focused AI assistant. Before writing any code, consider security implications. Do not suggest code that could be exploited. Reject requests that ask for dangerous operations.",
    sandboxBackend: "docker",
    enabledTools: ["read", "bash"],
  },
]

// ── ProfileRegistry ─────────────────────────────────────────────────────────────

export class ProfileRegistry {
  private readonly profiles = new Map<string, AgentProfile>()
  private readonly roleRegistry: RoleRegistry
  private readonly toolRegistry: ToolRegistry

  constructor(roleRegistry: RoleRegistry, toolRegistry: ToolRegistry) {
    this.roleRegistry = roleRegistry
    this.toolRegistry = toolRegistry
    // Seed with built-in profiles.
    for (const profile of BUILT_IN_PROFILES) {
      this.profiles.set(profile.id, profile)
    }
  }

  register(profile: AgentProfile): void {
    if (!profile.id) throw new Error("Profile id is required")
    this.profiles.set(profile.id, profile)
  }

  get(id: string): AgentProfile | undefined {
    return this.profiles.get(id)
  }

  list(): AgentProfile[] {
    return [...this.profiles.values()]
  }

  /**
   * Load all .json and .yaml profile files from `dir`.
   * Each file should export a single AgentProfile object or an array of them.
   */
  async loadFromDir(dir: string): Promise<void> {
    const absDir = resolve(dir)
    let entries: import("node:fs").Dirent[]
    try {
      entries = await readdir(absDir, { withFileTypes: true })
    } catch {
      // Directory doesn't exist — no-op.
      return
    }

    for (const entry of entries) {
      if (entry.isFile() && (extname(entry.name) === ".json" || extname(entry.name) === ".yaml")) {
        await this.loadFromFile(resolve(absDir, entry.name))
      }
    }
  }

  /** Load a single profile file (JSON or YAML). */
  async loadFromFile(filePath: string): Promise<void> {
    const raw = await readFile(resolve(filePath), "utf-8")
    // 修复 Bug 18 — preserve // inside URLs (e.g. https://example.com)
    const stripped = raw.replace(/(?<!https?:)\/\/[^\n]*/g, "").replace(/,\s*([}\]])/g, "$1")
    let parsed: unknown
    try {
      parsed = JSON.parse(stripped)
    } catch {
      parsed = this.parseYaml(raw)
    }

    const items = Array.isArray(parsed) ? parsed : [parsed]
    for (const item of items as AgentProfile[]) {
      if (!item.id) {
         
        console.warn(`[ProfileRegistry] skipping profile with missing id in ${filePath}`)
        continue
      }
      this.profiles.set(item.id, item)
    }
  }

  /** Minimal YAML parser for profile files (flat key-value + lists). */
  private parseYaml(raw: string): unknown {
    const obj: Record<string, unknown> = {}
    let currentKey = ""
    let inList = false
    let listBuffer: string[] = []

    for (const line of raw.split("\n")) {
      const trimmed = line.trim()
      if (trimmed === "") {
        if (inList && currentKey) {
          obj[currentKey] = listBuffer
          inList = false
          listBuffer = []
        }
        continue
      }

      // List item.
      if (inList && (line.startsWith("  - ") || line.startsWith("- "))) {
        listBuffer.push(trimmed.slice(2).trim())
        continue
      }

      const kvMatch = trimmed.match(/^(\w+):\s*(.*)$/)
      if (kvMatch) {
        if (inList && currentKey) {
          obj[currentKey] = listBuffer
          inList = false
          listBuffer = []
        }
        currentKey = kvMatch[1]!
        const rest = kvMatch[2]!.trim()
        if (rest === "" || rest === "|") {
          inList = true
          listBuffer = []
        } else {
          obj[currentKey] = rest
          inList = false
        }
      }
    }
    if (inList && currentKey) {
      obj[currentKey] = listBuffer
    }
    return obj
  }
}
