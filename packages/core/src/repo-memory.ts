/**
 * Repo memory — file-based repo-scoped memory store (借鉴 codebase-memory-mcp).
 *
 * codebase-memory-mcp exposes a SQLite-backed knowledge graph over
 * indexed repositories (function/class nodes + edges) with 14 tools
 * (search_graph, trace_path, get_architecture, ...).
 *
 * Maximilian's adaptation is intentionally much simpler: a file-based
 * repo memory store that lets agents persist repo context (file lists,
 * build commands, conventions, learned facts) across sessions.
 * Scoped by repoPath + key, stored as JSON files under a base dir.
 *
 * Use cases:
 *   - First run of an agent on a new repo: index_basic_structure() saves
 *     file tree, languages detected, build/test commands.
 *   - Subsequent runs: recall() reuses the saved context so the agent
 *     doesn't re-discover the repo from scratch.
 *   - Cross-workspace sharing: multiple workspaces can share one repo's
 *     memory if they target the same repoPath.
 */

import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises"
import { join, dirname } from "node:path"

export interface RepoMemoryEntry {
  key: string
  content: unknown
  updatedAt: string
}

export interface RepoMemoryStoreOptions {
  /** Base directory under which repo memory is stored. */
  baseDir: string
}

/**
 * File-based repo memory store. Each repoPath gets a subdirectory
 * containing one JSON file per key.
 *
 * Repo paths are sanitized (colons, slashes → underscores) for use as
 * filenames.
 */
export class FileRepoMemoryStore {
  constructor(private readonly options: RepoMemoryStoreOptions) {}

  private filePath(repoPath: string, key: string): string {
    const safeRepo = repoPath.replace(/[^a-zA-Z0-9._-]/g, "_")
    const safeKey = key.replace(/[^a-zA-Z0-9._-]/g, "_")
    return join(this.options.baseDir, safeRepo, `${safeKey}.json`)
  }

  /** Save `content` at `key` for the given `repoPath`. */
  async save(repoPath: string, key: string, content: unknown): Promise<void> {
    const path = this.filePath(repoPath, key)
    await mkdir(dirname(path), { recursive: true })
    const entry: RepoMemoryEntry = { key, content, updatedAt: new Date().toISOString() }
    await writeFile(path, JSON.stringify(entry, null, 2), "utf-8")
  }

  /** Read the entry at `key`, or undefined if not found. */
  async load(repoPath: string, key: string): Promise<RepoMemoryEntry | undefined> {
    const path = this.filePath(repoPath, key)
    try {
      const raw = await readFile(path, "utf-8")
      return JSON.parse(raw) as RepoMemoryEntry
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined
      throw err
    }
  }

  /** List all keys saved for `repoPath`. */
  async listKeys(repoPath: string): Promise<string[]> {
    const safeRepo = repoPath.replace(/[^a-zA-Z0-9._-]/g, "_")
    const dir = join(this.options.baseDir, safeRepo)
    try {
      const files = await readdir(dir)
      return files.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return []
      throw err
    }
  }

  /** Delete the entry at `key`. Returns true if it existed. */
  async delete(repoPath: string, key: string): Promise<boolean> {
    const path = this.filePath(repoPath, key)
    try {
      await unlink(path)
      return true
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false
      throw err
    }
  }
}