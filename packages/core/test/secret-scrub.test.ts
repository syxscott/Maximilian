// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for scrub-before-truncate (hermes-agent borrowing: "mask before
 * cutting"). The key case is a credential whose prefix falls inside the
 * truncation window: scrubbing the WHOLE text first removes it, while
 * cutting first would strand the prefix where the masker cannot match it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Vault } from "../src/vault.js"
import { scrubForModelContext } from "../src/secret-scrub.js"

let dir: string
let vault: Vault
const SECRET = "Zq7Xv2Lm9Pd4Rt6Yw1Ub3Ce5Fg8Hj0Ka2Nm4Pz6Xs9Qd1Wv3Ty5Uo7Ir9El2Ao4Gs6"

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "secret-scrub-"))
  vault = new Vault(path.join(dir, "vault.json"), "test-passphrase")
  await vault.load()
  await vault.save({ title: "provider:test", secret: SECRET })
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe("scrubForModelContext", () => {
  it("redacts an exact-match vault secret from the whole text", () => {
    const out = scrubForModelContext(`prefix ${SECRET} suffix`, vault)
    expect(out).not.toContain(SECRET)
    expect(out).toContain("[redacted]")
    expect(out).toBe("prefix [redacted] suffix")
  })

  it("keeps a secret's prefix out of a window that starts inside it (scrub → cut)", () => {
    // Window start (index 10) lands inside the secret. Cutting first would
    // leave `SECRET.slice(0, 10)` in the output; scrubbing first does not.
    const text = `${"A".repeat(10)}${SECRET}${"B".repeat(100)}`
    const scrubbed = scrubForModelContext(text, vault)
    const cut = scrubbed.slice(0, 20)
    expect(cut).toBe(`${"A".repeat(10)}[redacted]`)
    expect(cut).not.toContain(SECRET.slice(0, 10))
    expect(scrubbed).not.toContain(SECRET)
  })

  it("masks pattern-shaped credentials even without a vault", () => {
    const aws = "AKIAIOSFODNN7EXAMPLE"
    const out = scrubForModelContext(`key=${aws}`, undefined)
    expect(out).not.toContain(aws)
    expect(out).toContain("[REDACTED]")
  })

  it("leaves ordinary text unchanged", () => {
    const text = "build the login page and run the tests"
    expect(scrubForModelContext(text, vault)).toBe(text)
    expect(scrubForModelContext(text)).toBe(text)
  })
})
