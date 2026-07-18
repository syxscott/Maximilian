// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Toolkit — domain-grouped tool collection (借鉴 SuperAGI Toolkit).
 *
 * SuperAGI organises tools into Toolkits that bundle related capabilities
 * (e.g., FileSystem toolkit, CodeReview toolkit). Each Toolkit optionally
 * restricts which roles can use it. Maximilian adapts this with:
 *  - Tool: a named, risk-rated, schema-documented callable
 *  - Toolkit: a labelled group of tools with optional role-based access control
 *  - ToolRegistry: global registry with role-gated tool lookup and
 *    dynamic discovery via manifest.json scan
 *
 * @see https://github.com/TransformerOptimus/SuperAGI/blob/main/superagi/tools/tool_kit.py
 */

import { readdir, readFile } from "node:fs/promises"
import { join, resolve } from "node:path"

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * A single callable tool.
 */
export interface Tool {
  name: string
  description: string
  /** JSON Schema for the tool's input arguments. */
  schema: Record<string, unknown>
  /** Risk level used by permission-gating logic. */
  risk: "safe" | "medium" | "high" | "critical"
  execute(args: Record<string, unknown>): Promise<unknown>
  /** Optional toolkit membership (set automatically when added via registerToolkit). */
  toolkitId?: string
}

/**
 * A labelled group of related tools.
 */
export interface Toolkit {
  id: string
  name: string
  description: string
  tools: Tool[]
  /** Role IDs allowed to use this toolkit. Undefined = all roles. */
  allowedRoles?: string[]
  version?: string
}

export interface ToolRegistry {
  register(tool: Tool): void
  registerToolkit(toolkit: Toolkit): void
  get(name: string): Tool | undefined
  getToolkit(toolkitId: string): Toolkit | undefined
  listTools(): Tool[]
  listToolkits(): Toolkit[]
  /**
   * Return tools available to a given role, merging:
   *  - Toolkit.allowedRoles (if set)
   *  - RoleSpec.allowedTools (if set)
   *  - minus RoleSpec.deniedTools
   *  - minus any tool with risk > 'medium' unless role is explicitly allowed
   */
  getToolsForRole(roleId: string, roleSpec: { allowedTools?: string[]; deniedTools?: string[] }): Tool[]
  /**
   * Recursively scan `rootDir` for `manifest.json` files and register
   * each discovered toolkit. manifest.json must export a Toolkit-compatible
   * object (tools may reference local modules; the registry does not
   * auto-import them — callers must register tool implementations separately).
   */
  discover(rootDir: string): Promise<void>
}

// ── Built-in toolkits ────────────────────────────────────────────────────────

/**
 * Placeholder toolkits declared for discovery. The actual Tool instances
 * are populated by the @max/tools barrel export.
 */
export const BUILT_IN_TOOLKITS: Toolkit[] = [
  {
    id: "filesystem",
    name: "File System",
    description: "Read, write, edit, and search files on the local filesystem.",
    tools: [],
    allowedRoles: ["backend", "frontend", "data", "architect"],
  },
  {
    id: "code-review",
    name: "Code Review",
    description: "Search and analyse code using grep, glob, and structural queries.",
    tools: [],
    allowedRoles: ["reviewer"],
  },
]

// ── DefaultToolRegistry ──────────────────────────────────────────────────────

export class DefaultToolRegistry implements ToolRegistry {
  private readonly tools = new Map<string, Tool>()
  private readonly toolkits = new Map<string, Toolkit>()

  register(tool: Tool): void {
    if (!tool.name) throw new Error("Tool name is required")
    this.tools.set(tool.name, tool)
  }

  registerToolkit(toolkit: Toolkit): void {
    if (!toolkit.id) throw new Error("Toolkit id is required")
    // 修复 Bug 19 — remove tools from previous version of this toolkit before registering new ones
    const existing = this.toolkits.get(toolkit.id)
    if (existing) {
      for (const t of existing.tools) {
        this.tools.delete(t.name)
      }
    }
    // 修复 Bug 19 — validate that each tool has required fields before registering
    for (const tool of toolkit.tools) {
      if (!tool.name) throw new Error(`Toolkit "${toolkit.id}" has a tool with missing name`)
      if (typeof tool.execute !== "function") {
        throw new Error(`Tool "${tool.name}" in toolkit "${toolkit.id}" is missing required execute function`)
      }
      const registered = { ...tool, toolkitId: toolkit.id }
      this.tools.set(tool.name, registered)
    }
    this.toolkits.set(toolkit.id, toolkit)
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  getToolkit(toolkitId: string): Toolkit | undefined {
    return this.toolkits.get(toolkitId)
  }

  listTools(): Tool[] {
    return [...this.tools.values()]
  }

  listToolkits(): Toolkit[] {
    return [...this.toolkits.values()]
  }

  getToolsForRole(
    roleId: string,
    roleSpec: { allowedTools?: string[]; deniedTools?: string[] },
  ): Tool[] {
    const denied = new Set(roleSpec.deniedTools ?? [])
    const allowedSet = roleSpec.allowedTools ? new Set(roleSpec.allowedTools) : null

    return this.listTools().filter((tool) => {
      // Apply role-level denylist first.
      if (denied.has(tool.name)) return false

      // Apply role-level allowlist.
      if (allowedSet !== null && !allowedSet.has(tool.name)) return false

      // Apply toolkit-level role restriction.
      if (tool.toolkitId) {
        const tk = this.toolkits.get(tool.toolkitId)
        if (tk?.allowedRoles && !tk.allowedRoles.includes(roleId)) return false
      }

      // High/critical tools are blocked unless the role explicitly allows them.
      if (tool.risk === "high" || tool.risk === "critical") {
        if (allowedSet === null || !allowedSet.has(tool.name)) return false
      }

      return true
    })
  }

  /**
   * Discover toolkits by scanning `rootDir` for `manifest.json` files.
   * Each manifest must export a Toolkit-compatible object.
   * Tool implementations must be registered separately; this only registers
   * the toolkit metadata and tool names.
   */
  async discover(rootDir: string): Promise<void> {
    const manifests = await this.findManifests(resolve(rootDir))
    for (const manifestPath of manifests) {
      try {
        const raw = await readFile(manifestPath, "utf-8")
        // 修复 Bug 18 (same issue) — preserve // inside URLs
        const stripped = raw.replace(/(?<!https?:)\/\/[^\n]*/g, "").replace(/,\s*([}\]])/g, "$1")
        const parsed = JSON.parse(stripped) as Toolkit
        if (!parsed.id) {
           
          console.warn(`[DefaultToolRegistry] manifest at ${manifestPath} missing "id", skipping`)
          continue
        }
        this.registerToolkit(parsed)
      } catch (err) {
         
        console.error(`[DefaultToolRegistry] failed to load manifest ${manifestPath}:`, err)
      }
    }
  }

  private async findManifests(dir: string): Promise<string[]> {
    const results: string[] = []
    let entries: import("node:fs").Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return results
    }

    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...(await this.findManifests(full)))
      } else if (entry.name === "manifest.json") {
        results.push(full)
      }
    }

    return results
  }
}
