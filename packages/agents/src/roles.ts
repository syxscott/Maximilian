// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Role — role registry with centralized prompt management (借鉴 ChatDev RoleConfig.json).
 *
 * ChatDev keeps all role prompts in a single RoleConfig.json so they can be
 * modified without touching code. Maximilian adapts this with a programmatic
 * RoleSpec interface and a DefaultRoleRegistry that supports both in-memory
 * registration and YAML/JSON file loading.
 *
 * Each role specifies:
 *  - id / name / systemPrompt
 *  - capabilities (free-form list for tooling/hint matching)
 *  - allowedTools / deniedTools (for tool-gating)
 *  - modelHints / maxTokens / temperature (provider suggestions)
 *
 * @see https://github.com/OpenBMB/ChatDev/blob/main/CompanyConfig/RoleConfig.json
 */

import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RoleSpec {
  id: string
  name: string
  /** System prompt injected at the start of every conversation for this role. */
  systemPrompt: string
  /** Capabilities for tooling / routing hints (not enforced). */
  capabilities: string[]
  /** Tools this role may call. Undefined = all registered tools. */
  allowedTools?: string[]
  /** Tools explicitly denied (higher priority than allowedTools). */
  deniedTools?: string[]
  /** Preferred model IDs for this role. */
  modelHints?: string[]
  maxTokens?: number
  temperature?: number
}

export interface RoleRegistry {
  get(roleId: string): RoleSpec | undefined
  register(role: RoleSpec): void
  unregister(roleId: string): void
  list(): RoleSpec[]
  listIds(): string[]
  /**
   * Returns the merged tool list for a role:
   * (allowedTools ?? all) \ deniedTools
   */
  getAllowedTools(roleId: string): string[]
  /** Load roles from a JSON or YAML file. */
  loadFromFile(filePath: string): Promise<void>
}

// ── Built-in roles ────────────────────────────────────────────────────────────

/**
 * Built-in roles shipped with @max/agents.
 * These can be overridden by user-registered roles.
 */
export const BUILT_IN_ROLES: Record<string, RoleSpec> = {
  architect: {
    id: "architect",
    name: "Architect",
    systemPrompt:
      "You are a software architect. Your responsibility is to design scalable, maintainable system architectures. When given a requirement, produce a high-level design covering component boundaries, data flow, technology choices, and key non-functional considerations (performance, security, scalability).",
    capabilities: ["system-design", "technology-selection", "architecture-review"],
    allowedTools: ["read", "glob", "grep"],
  },
  backend: {
    id: "backend",
    name: "Backend Engineer",
    systemPrompt:
      "You are a backend engineer. Your job is to generate clean, working server-side code. Output only code wrapped in a fenced block. Prefer Node.js + Express for server-side work. Include a brief API contract comment. Respond to review feedback from the reviewer role.",
    capabilities: ["api-design", "database-schema", "node.js", "python", "rest-api"],
    allowedTools: ["read", "write", "edit", "bash", "glob", "grep"],
  },
  frontend: {
    id: "frontend",
    name: "Frontend Engineer",
    systemPrompt:
      "You are a frontend engineer. Generate clean HTML, CSS, and JavaScript/TypeScript code. Prefer React for component-based UIs. Output code in fenced blocks. Respond to review feedback from the reviewer role.",
    capabilities: ["react", "css", "ui-design", "typescript", "html"],
    allowedTools: ["read", "write", "edit", "bash", "glob", "grep"],
  },
  reviewer: {
    id: "reviewer",
    name: "Code Reviewer",
    systemPrompt:
      "You are a code reviewer. Your job is to critically evaluate code for correctness, maintainability, security, and testability. Provide specific, actionable feedback. When satisfied with the code, explicitly say APPROVED.",
    capabilities: ["code-review", "testing", "bug-detection", "security-review"],
    allowedTools: ["read", "bash", "grep", "glob"],
  },
  data: {
    id: "data",
    name: "Data Engineer",
    systemPrompt:
      "You are a data engineer. Design and implement data pipelines, SQL schemas, ETL processes, and analytics workflows. Output code in fenced blocks. Prefer SQL and Python.",
    capabilities: ["data-pipeline", "sql", "etl", "python", "data-modeling"],
    allowedTools: ["read", "write", "bash", "glob"],
  },
}

// ── DefaultRoleRegistry ──────────────────────────────────────────────────────

/**
 * In-memory RoleRegistry with optional file-based bulk loading.
 */
export class DefaultRoleRegistry implements RoleRegistry {
  private readonly roles = new Map<string, RoleSpec>()

  constructor() {
    // Seed with built-in roles.
    for (const role of Object.values(BUILT_IN_ROLES)) {
      this.roles.set(role.id, role)
    }
  }

  get(roleId: string): RoleSpec | undefined {
    // 修复 Bug 14 — return deep copy to prevent caller mutation
    const role = this.roles.get(roleId) ?? BUILT_IN_ROLES[roleId]
    return role ? structuredClone(role) : undefined
  }

  register(role: RoleSpec): void {
    if (!role.id) throw new Error("Role id is required")
    this.roles.set(role.id, role)
  }

  unregister(roleId: string): void {
    // Prevent removing built-ins via unregister (they can be overridden instead).
    if (Object.hasOwn(BUILT_IN_ROLES, roleId)) {
      throw new Error(`Cannot unregister built-in role "${roleId}" — override it instead`)
    }
    this.roles.delete(roleId)
  }

  list(): RoleSpec[] {
    // 修复 Bug 14 — return deep copies to prevent caller mutation
    return [...this.roles.values()].map((r) => structuredClone(r))
  }

  listIds(): string[] {
    return [...this.roles.keys()]
  }

  getAllowedTools(roleId: string): string[] {
    const role = this.roles.get(roleId)
    if (!role) return []
    // If allowedTools is undefined, return empty (caller should fall back to all tools).
    const allowed = role.allowedTools
    const denied = new Set(role.deniedTools ?? [])
    if (!allowed) return []
    return allowed.filter((t) => !denied.has(t))
  }

  /**
   * Load roles from a JSON or YAML file.
   * The file must export a top-level array of RoleSpec objects.
   * Comments and trailing commas are stripped before parsing.
   */
  async loadFromFile(filePath: string): Promise<void> {
    const raw = await readFile(resolve(filePath), "utf-8")
    // Strip JSON comments (// …) but preserve // inside URLs (e.g. https://example.com).
    const stripped = raw.replace(/(?<!https?:)\/\/[^\n]*/g, "").replace(/,\s*([}\]])/g, "$1")
    let parsed: unknown
    try {
      parsed = JSON.parse(stripped)
    } catch {
      // Try YAML (manual simple parse for the subset we need).
      parsed = this.parseSimpleYaml(stripped)
    }

    if (!Array.isArray(parsed)) {
      throw new Error(`Role file must export an array of roles, got ${typeof parsed}`)
    }

    for (const item of parsed) {
      const role = item as RoleSpec
      if (!role.id) {
         
        console.warn(`[DefaultRoleRegistry] skipping role with missing id in ${filePath}`)
        continue
      }
      this.roles.set(role.id, role)
    }
  }

  /** Minimal YAML subset parser for role files. Handles only the flat key-value form we emit. */
  private parseSimpleYaml(raw: string): unknown[] {
    const roles: Record<string, string>[] = []
    let current: Record<string, string> | null = null
    let currentKey = ""
    let inValue = false
    let valueBuffer = ""

    for (const line of raw.split("\n")) {
      const indent = line.match(/^(\s*)/)![1].length
      if (indent > 0) {
        // Continuation of multi-line value.
        if (current && inValue) {
          valueBuffer += "\n" + line.trim()
          if (line.trim() === "") {
            current[currentKey] = valueBuffer.trim()
            inValue = false
            valueBuffer = ""
          }
          continue
        }
      }

      const kvMatch = line.match(/^(\w+):\s*(.*)$/)
      if (kvMatch) {
        // 修复 Bug 13 — finalize any pending multi-line value before switching keys
        if (inValue && current && currentKey) {
          current[currentKey] = valueBuffer.trim()
          inValue = false
          valueBuffer = ""
        }
        if (current) {
          // Save previous.
          roles.push(current)
        }
        currentKey = kvMatch[1]!
        const rest = kvMatch[2]!.trim()
        if (rest === "" || rest === "|") {
          inValue = true
          valueBuffer = ""
          current = current ?? {}
          continue
        }
        current = current ?? {}
        current[kvMatch[1]!] = rest
        inValue = false
      }
    }
    // 修复 Bug 13 — flush final multi-line value before pushing last role
    if (inValue && current && currentKey) {
      current[currentKey] = valueBuffer.trim()
      inValue = false
      valueBuffer = ""
    }
    if (current) roles.push(current)
    return roles
  }
}
