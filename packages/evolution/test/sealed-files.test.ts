// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Sealed-file vault tests (oh-my-claudecode self-improve borrowing).
 *
 * The vault is the evaluation loop's tamper-evidence: benchmarks may be
 * read for scoring but never written during an evolution step.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import path from "node:path"
import os from "node:os"

import { SealedFileVault, SealedFileViolationError, compileGlob } from "../src/sealed-files.js"

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "max-evo-seals-"))
  await fs.mkdir(path.join(tmp, "benchmarks", "sub"), { recursive: true })
  await fs.mkdir(path.join(tmp, "src"), { recursive: true })
  await fs.writeFile(path.join(tmp, "benchmarks", "task1.json"), '{"id":1}')
  await fs.writeFile(path.join(tmp, "benchmarks", "sub", "task2.json"), '{"id":2}')
  await fs.writeFile(path.join(tmp, "src", "main.ts"), "export {};") // unsealed path
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe("compileGlob", () => {
  it("matches ** across segments", () => {
    const re = compileGlob("benchmarks/**")
    expect(re.test("benchmarks/task1.json")).toBe(true)
    expect(re.test("benchmarks/sub/task2.json")).toBe(true)
    expect(re.test("src/main.ts")).toBe(false)
  })

  it("matches * within a single segment only", () => {
    const re = compileGlob("src/*.ts")
    expect(re.test("src/main.ts")).toBe(true)
    expect(re.test("src/sub/main.ts")).toBe(false)
  })

  it("treats a trailing slash as everything below", () => {
    const re = compileGlob("benchmarks/")
    expect(re.test("benchmarks/sub/task2.json")).toBe(true)
  })

  it("supports leading ** and ? wildcards", () => {
    expect(compileGlob("**/fixtures.json").test("a/b/fixtures.json")).toBe(true)
    expect(compileGlob("**/fixtures.json").test("fixtures.json")).toBe(true)
    expect(compileGlob("task?.json").test("task1.json")).toBe(true)
    expect(compileGlob("task?.json").test("task10.json")).toBe(false)
  })

  it("escapes regex metacharacters in literal segments", () => {
    const re = compileGlob("a.b/c(d).txt")
    expect(re.test("a.b/c(d).txt")).toBe(true)
    expect(re.test("aXb/c(d).txt")).toBe(false)
  })
})

describe("SealedFileVault", () => {
  it("seals matching files and verifies cleanly when nothing moved", async () => {
    const vault = new SealedFileVault(tmp)
    const manifest = await vault.seal(["benchmarks/**"])
    expect(Object.keys(manifest.files).sort()).toEqual([
      "benchmarks/sub/task2.json",
      "benchmarks/task1.json",
    ])
    expect(await vault.verify()).toEqual([])
    expect(await vault.isIntact()).toBe(true)
  })

  it("flags modified sealed files", async () => {
    const vault = new SealedFileVault(tmp)
    await vault.seal(["benchmarks/**"])
    await fs.writeFile(path.join(tmp, "benchmarks", "task1.json"), '{"id":1,"tampered":true}')
    const violations = await vault.verify()
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ kind: "modified", file: "benchmarks/task1.json" })
  })

  it("flags deleted sealed files", async () => {
    const vault = new SealedFileVault(tmp)
    await vault.seal(["benchmarks/**"])
    await fs.rm(path.join(tmp, "benchmarks", "sub", "task2.json"))
    const violations = await vault.verify()
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ kind: "missing", file: "benchmarks/sub/task2.json" })
  })

  it("flags new files matching the sealed patterns", async () => {
    const vault = new SealedFileVault(tmp)
    await vault.seal(["benchmarks/**"])
    await fs.writeFile(path.join(tmp, "benchmarks", "sneaky.json"), "{}")
    const violations = await vault.verify()
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ kind: "unsealed", file: "benchmarks/sneaky.json" })
  })

  it("guard() passes when the operation only touches unsealed paths", async () => {
    const vault = new SealedFileVault(tmp)
    await vault.seal(["benchmarks/**"])
    const out = await vault.guard(async () => {
      await fs.writeFile(path.join(tmp, "src", "main.ts"), "export const x = 1;")
      return "ok"
    })
    expect(out).toBe("ok")
    expect(await vault.isIntact()).toBe(true)
  })

  it("guard() throws when the operation modifies a sealed file", async () => {
    const vault = new SealedFileVault(tmp)
    await vault.seal(["benchmarks/**"])
    await expect(
      vault.guard(async () => {
        await fs.writeFile(path.join(tmp, "benchmarks", "task1.json"), "tampered")
      }),
    ).rejects.toBeInstanceOf(SealedFileViolationError)
  })

  it("guard() fails fast when the seals are already broken", async () => {
    const vault = new SealedFileVault(tmp)
    await vault.seal(["benchmarks/**"])
    await fs.rm(path.join(tmp, "benchmarks", "task1.json"))
    let ran = false
    await expect(
      vault.guard(async () => {
        ran = true
      }),
    ).rejects.toBeInstanceOf(SealedFileViolationError)
    expect(ran).toBe(false)
  })

  it("ignores node_modules and the manifest itself while collecting", async () => {
    await fs.mkdir(path.join(tmp, "benchmarks", "node_modules"), { recursive: true })
    await fs.writeFile(path.join(tmp, "benchmarks", "node_modules", "dep.json"), "{}")
    const vault = new SealedFileVault(tmp)
    const manifest = await vault.seal(["benchmarks/**"])
    expect(Object.keys(manifest.files)).not.toContain("benchmarks/node_modules/dep.json")
  })
})
