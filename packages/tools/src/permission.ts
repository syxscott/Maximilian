/**
 * Permission system — OpenCode-style file operation permissions.
 *
 * Three actions per (tool, pattern) pair: `allow`, `ask`, `deny`.
 *
 * Storage file: `~/.maximilian/permissions.json` with shape:
 *   {
 *     "defaults": { bash: "ask", edit: "ask", write: "ask",
 *                   read: "allow", glob: "allow", grep: "allow" },
 *     "patterns": {
 *       write: { "/tmp/STAR": "allow", "STAR/.env": "deny" }
 *     }
 *   }
 * (STAR stands in for `*` in this comment so esbuild doesn't expand it.)
 *
 * Match semantics:
 *   1. For the tool, walk `patterns[tool]` in object-key order. First pattern
 *      whose glob matches the extracted path/command wins.
 *   2. If no pattern matched, fall back to `defaults[tool]`.
 *   3. Glob matching is path-style (using `globMatch` below); the empty
 *      pattern or "*" acts as a catch-all.
 *
 * The `target` extracted from each tool input:
 *   - read/write/edit: `path` field
 *   - glob: `path` (or `pattern` if no path)
 *   - grep: `path` (or `pattern` if no path)
 *   - bash: command string itself
 */

import { homedir } from "node:os"
import { join } from "node:path"
import { readFile, writeFile, rename, mkdir } from "node:fs/promises"

export type Permission = "allow" | "ask" | "deny"

export const TOOL_NAMES = ["bash", "read", "write", "edit", "glob", "grep"] as const
export type ToolName = (typeof TOOL_NAMES)[number]

export interface Permissions {
  /** Fallback action when no pattern matches. */
  defaults: Record<ToolName, Permission>
  /** Pattern overrides per tool. First matching key wins. */
  patterns: Partial<Record<ToolName, Record<string, Permission>>>
}

export const DEFAULT_PERMISSIONS: Permissions = {
  defaults: {
    bash: "ask",
    write: "ask",
    edit: "ask",
    // read/glob/grep default to "allow" for convenience (agents need to
    // explore the workspace), but sensitive paths are explicitly denied
    // below so a fresh install can't accidentally exfiltrate .env files,
    // SSH keys, or other secrets via the read tool.
    read: "allow",
    glob: "allow",
    grep: "allow",
  },
  patterns: {
    // Deny-list for secrets and credentials. Without these patterns, a
    // fresh install with read=allow would let any agent read .env files
    // or SSH keys without prompting - a security footgun. The deny rules
    // are checked before the allow default, so they take precedence.
    read: {
      "**/.env": "deny",
      "**/.env.*": "deny",
      "**/.envrc": "deny",
      "**/.ssh/**": "deny",
      "**/.aws/credentials": "deny",
      "**/.git/credentials": "deny",
      "**/id_rsa": "deny",
      "**/id_ed25519": "deny",
      "**/.npmrc": "deny",
      "**/.pypirc": "deny",
      "**/.dockercfg": "deny",
    },
    glob: {
      "**/.env": "deny",
      "**/.env.*": "deny",
      "**/.ssh/**": "deny",
      "**/.aws/credentials": "deny",
      "**/id_rsa": "deny",
      "**/id_ed25519": "deny",
    },
    grep: {
      // grep can read file contents via pattern matching, so the same
      // sensitive paths are denied. The target for grep is the search
      // path, so deny the directories that contain secrets.
      "**/.env": "deny",
      "**/.env.*": "deny",
      "**/.ssh/**": "deny",
      "**/.aws/**": "deny",
    },
  },
}

function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as ReadonlyArray<string>).includes(name)
}

function isPermission(value: unknown): value is Permission {
  return value === "allow" || value === "ask" || value === "deny"
}

/** Minimal glob → RegExp translator. Supports `*`, `**`, `?`, `[abc]`. */
export function globToRegex(pattern: string): RegExp {
  let body = ""
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // `**/` matches zero or more path segments; bare `**` matches anything.
        if (pattern[i + 2] === "/") {
          body += "(?:.*/)?"
          i += 2
        } else {
          body += ".*"
          i++
        }
      } else {
        body += "[^/]*"
      }
    } else if (c === "?") {
      body += "[^/]"
    } else if (".+^$()|{}[]\\".includes(c)) {
      body += "\\" + c
    } else if (c === "[") {
      // In character class, [ must be escaped but ] doesn't
      body += "\\["
    } else {
      body += c
    }
  }
  return new RegExp(`^${body}$`)
}

/**
 * Check a single (pattern, value) pair. Patterns are matched against either
 * absolute paths (for read/write/edit/glob/grep) or command strings (for bash).
 * Glob-style wildcards supported; for bash the empty pattern or "*" matches all.
 */
export function matchPattern(pattern: string, value: string): boolean {
  if (pattern === "" || pattern === "*") return true
  return globToRegex(pattern).test(value)
}

const DANGEROUS_PATTERNS = [
  // Recursive remove, format, dd (disk write)
  /^rm\s+-rf/i, /^dd\s+/i, /^mkfs/i, /^fdisk/i,
  // Pipe to shell (remote code execution via curl/wget)
  /^curl\s+.*\|\s*sh/i, /^wget\s+.*\|\s*sh/i,
  /^curl\s+.*bash/i, /^wget\s+.*bash/i,
  // Netcat reverse shell
  /^nc\s+-e/i, /^nc\s+.*-c\s+/i, /^ncat\s+/i,
  // Interactive bash
  /^bash\s+-i/i, /^python\d*\s+-i/i,
  // Fork bomb patterns
  /^\s*:()\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*:\s*/i,
  // base64 decode and pipe to shell
  /^base64\s+-d.*\|\s*sh/i,
  // eval with user input
  /^eval\s+\$\(/i,
  // File overwrite via redirect with sudo
  /^sudo\s+.*>\s*\//i, /^sudo\s+.*\|\s*sh/i,
];

export function validateBashCommand(command: string): string {
  // Split by common command separators to check all parts
  const parts = command.trim().split(/\s*(?:[;&|&&|\|\||\n])\s*/)
  for (const part of parts) {
    const normalized = part.trim()
    if (!normalized) continue
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(normalized)) {
        throw new Error(`Dangerous command pattern detected: ${normalized}`)
      }
    }
  }
  return command
}

/** Extract the permission-relevant path/command from a tool input. */
export function extractTarget(tool: ToolName, input: unknown): string {
  if (input === null || typeof input !== "object") return ""
  const obj = input as Record<string, unknown>
  switch (tool) {
    case "read":
    case "write":
    case "edit": {
      const p = obj.path
      return typeof p === "string" ? p : ""
    }
    case "glob":
    case "grep": {
      const p = obj.path
      if (typeof p === "string" && p.length > 0) return p
      // For glob/grep, also surface the search pattern so users can forbid
      // patterns like `**/.env` or `password*`.
      const pat = obj.pattern
      if (typeof pat === "string" && pat.length > 0) return pat
      return ""
    }
    case "bash": {
      const c = obj.command
      if (typeof c !== "string") return ""
      return c
    }
  }
}

/** Resolve the effective permission for a (tool, input) call. */
export function resolvePermission(tool: ToolName, input: unknown, config: Permissions): Permission {
  const patterns = config.patterns[tool] ?? {}
  const target = extractTarget(tool, input)
  for (const [pattern, action] of Object.entries(patterns)) {
    if (!isPermission(action)) continue
    if (matchPattern(pattern, target)) return action
  }
  return config.defaults[tool] ?? "ask"
}

// ── File storage ─────────────────────────────────────────────────────────

export function permissionsFilePath(): string {
  return join(homedir(), ".maximilian", "permissions.json")
}

export async function loadPermissions(): Promise<Permissions> {
  const path = permissionsFilePath()
  try {
    const raw = await readFile(path, "utf-8")
    const parsed: unknown = JSON.parse(raw)
    return validatePermissions(parsed)
  } catch (err) {
    if (isENOENT(err)) return DEFAULT_PERMISSIONS
    throw err
  }
}

/** Atomic save: write to temp file then rename. Prevents partial writes. */
export async function savePermissions(config: Permissions): Promise<void> {
  const path = permissionsFilePath()
  await mkdir(join(homedir(), ".maximilian"), { recursive: true })
  const tmp = `${path}.tmp.${process.pid}`
  await writeFile(tmp, JSON.stringify(config, null, 2), "utf-8")
  await rename(tmp, path)
}

export function validatePermissions(raw: unknown): Permissions {
  if (raw === null || typeof raw !== "object") return DEFAULT_PERMISSIONS
  const obj = raw as Record<string, unknown>
  const defaults: Record<ToolName, Permission> = { ...DEFAULT_PERMISSIONS.defaults }
  if (obj.defaults && typeof obj.defaults === "object") {
    const d = obj.defaults as Record<string, unknown>
    for (const [k, v] of Object.entries(d)) {
      if (isToolName(k) && isPermission(v)) defaults[k] = v
    }
  }
  // When the caller provides a `patterns` object, use it verbatim (filtered
  // for valid tools/actions). When `patterns` is missing entirely, fall
  // back to DEFAULT_PERMISSIONS.patterns - this preserves the security-
  // critical deny rules (.env, .ssh, etc.) for configs that predate the
  // patterns field or were written by `defaults`-only UIs.
  const patterns: Partial<Record<ToolName, Record<string, Permission>>> = {}
  if (obj.patterns && typeof obj.patterns === "object") {
    const p = obj.patterns as Record<string, unknown>
    for (const [tool, map] of Object.entries(p)) {
      if (!isToolName(tool) || !map || typeof map !== "object") continue
      const acc: Record<string, Permission> = {}
      for (const [pat, action] of Object.entries(map as Record<string, unknown>)) {
        if (isPermission(action)) acc[pat] = action
      }
      patterns[tool] = acc
    }
  } else {
    Object.assign(patterns, DEFAULT_PERMISSIONS.patterns)
  }
  return { defaults, patterns }
}

function isENOENT(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT"
}
