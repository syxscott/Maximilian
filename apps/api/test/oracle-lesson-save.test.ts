// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Unit tests for PUT /evolution/oracle-lessons/{role} (admin-status route):
 * real fs semantics against a temp directory (create + wholesale overwrite),
 * the strict [a-z0-9-] role whitelist (400 + no write on drift, traversal
 * included) and the mandatory configured directory. The route definition
 * itself is contract-guarded by test/api-contract.test.ts via
 * openapi-paths.json.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { oracleLessonSaveHandler, ORACLE_ROLE_NAME_PATTERN } from "../src/routes/admin-status.js"

// The handler reads the lessons dir from getConfig(); swap the module for a
// deterministic stub whose directory each test points at a fresh tmp dir.
let lessonsDir: string | undefined
vi.mock("@max/config", () => ({
  getConfig: () => ({ EVOLUTION_ORACLE_LESSONS_DIR: lessonsDir }),
}))

let workDir: string

beforeEach(async () => {
  workDir = await fs.mkdtemp(join(tmpdir(), "oracle-lessons-"))
  lessonsDir = workDir
})

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true })
  lessonsDir = undefined
})

function makeContext(role: string, body: unknown) {
  return {
    req: {
      param: (key: string) => (key === "role" ? role : undefined),
      json: async () => body,
    },
    json: (payload: unknown, status?: number) => ({ payload, status: status ?? 200 }),
  } as never
}

const handler = () => oracleLessonSaveHandler()

async function dirNames(): Promise<string[]> {
  return (await fs.readdir(workDir)).sort()
}

describe("PUT /evolution/oracle-lessons/{role}", () => {
  it("creates a new <role>.md file in the configured directory", async () => {
    const content = "# planner\n\nPrefer explicit acceptance criteria."
    const res = (await handler()(makeContext("planner", { content }))) as {
      status: number
      payload: Record<string, unknown>
    }

    expect(res.status).toBe(200)
    expect(res.payload).toEqual({
      ok: true,
      role: "planner",
      bytes: Buffer.byteLength(content, "utf8"),
    })
    expect(await dirNames()).toEqual(["planner.md"])
    expect(await fs.readFile(join(workDir, "planner.md"), "utf8")).toBe(content)
  })

  it("overwrites an existing lesson wholesale and reports the new size", async () => {
    await fs.writeFile(join(workDir, "executor.md"), "old corpus text", "utf8")

    const content = "# executor v2"
    const res = (await handler()(makeContext("executor", { content }))) as {
      status: number
      payload: { ok: boolean; bytes: number }
    }

    expect(res.status).toBe(200)
    expect(res.payload.ok).toBe(true)
    expect(res.payload.bytes).toBe(content.length)
    expect(await dirNames()).toEqual(["executor.md"]) // no stray temp files
    expect(await fs.readFile(join(workDir, "executor.md"), "utf8")).toBe(content)
  })

  it("answers 400 and writes nothing for unsafe role names", async () => {
    // Empty string never reaches the whitelist — it is "missing".
    const missing = (await handler()(makeContext("", { content: "x" }))) as {
      status: number
      payload: { error: string }
    }
    expect(missing.status).toBe(400)
    expect(missing.payload.error).toContain("Missing role")

    const unsafe = ["..", ".", "a/b", "../escape", "Upper", "has space", "under_score", "中文名"]
    for (const role of unsafe) {
      const res = (await handler()(makeContext(role, { content: "x" }))) as {
        status: number
        payload: { error: string }
      }
      expect(res.status, role).toBe(400)
      expect(res.payload.error).toContain("Invalid role name")
    }
    expect(await dirNames()).toEqual([])
    // The whitelist itself: lowercase digits and dashes only.
    expect(ORACLE_ROLE_NAME_PATTERN.test("code-reviewer")).toBe(true)
    expect(ORACLE_ROLE_NAME_PATTERN.test("Code.Reviewer")).toBe(false)
  })

  it("answers 400 when no lessons directory is configured", async () => {
    lessonsDir = undefined
    const res = (await handler()(makeContext("planner", { content: "x" }))) as {
      status: number
      payload: { error: string }
    }
    expect(res.status).toBe(400)
    expect(res.payload.error).toContain("not configured")
  })

  it("answers 400 for bodies that are not valid lesson content", async () => {
    const badBodies: unknown[] = [
      "not an object",
      {}, // missing content
      { content: "" }, // empty content
      { content: 42 }, // non-string content
      { content: "y".repeat(262_145) }, // over the ceiling
    ]
    for (const body of badBodies) {
      const res = (await handler()(makeContext("planner", body))) as {
        status: number
        payload: { error: string }
      }
      expect(res.status, JSON.stringify(body).slice(0, 40)).toBe(400)
      expect(res.payload.error).toContain("Invalid lesson content")
    }
    // Malformed JSON never even parses.
    const ctx = {
      req: {
        param: () => "planner",
        json: async () => {
          throw new Error("unexpected end of body")
        },
      },
      json: (payload: unknown, status?: number) => ({ payload, status: status ?? 200 }),
    } as never
    const res = (await handler()(ctx)) as { status: number; payload: { error: string } }
    expect(res.status).toBe(400)
    expect(res.payload.error).toContain("JSON")
    expect(await dirNames()).toEqual([])
  })

  it("creates the configured directory when it does not exist yet", async () => {
    lessonsDir = join(workDir, "not-yet", "lessons")
    const res = (await handler()(makeContext("judge", { content: "# judge" }))) as {
      status: number
      payload: { ok: boolean }
    }
    expect(res.status).toBe(200)
    expect(res.payload.ok).toBe(true)
    expect(await fs.readFile(join(lessonsDir, "judge.md"), "utf8")).toBe("# judge")
  })
})
