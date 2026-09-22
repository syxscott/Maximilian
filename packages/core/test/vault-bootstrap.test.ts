// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for loadProviderCredentialsFromVault: env-shaped credentials from
 * encrypted vault entries titled `provider:<presetId>`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Vault, loadProviderCredentialsFromVault } from "../src/index.js"

let dir: string
const SAVED_ENV: Record<string, string | undefined> = {}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-bootstrap-"))
  for (const key of ["MAXIMILIAN_VAULT_PATH", "MAXIMILIAN_VAULT_PASSPHRASE"]) {
    SAVED_ENV[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
  for (const [key, value] of Object.entries(SAVED_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe("loadProviderCredentialsFromVault", () => {
  it("returns an empty map when the vault is not configured", async () => {
    expect(await loadProviderCredentialsFromVault({})).toEqual({})
  })

  it("resolves provider:<presetId> entries into env-shaped credentials", async () => {
    const vaultPath = path.join(dir, "vault.json")
    const vault = new Vault(vaultPath, "test-passphrase")
    await vault.load()
    await vault.save({ title: "provider:kimi", secret: "sk-kimi-123", username: "kimi" })
    await vault.save({ title: "provider:deepseek", secret: "sk-ds-456" })
    await vault.save({ title: "unrelated-entry", secret: "not-a-provider-key" })

    const creds = await loadProviderCredentialsFromVault({
      MAXIMILIAN_VAULT_PATH: vaultPath,
      MAXIMILIAN_VAULT_PASSPHRASE: "test-passphrase",
    })
    // envKey of the kimi/deepseek presets.
    expect(Object.values(creds)).toContain("sk-kimi-123")
    expect(Object.values(creds)).toContain("sk-ds-456")
    expect(Object.values(creds)).not.toContain("not-a-provider-key")
  })

  it("returns an empty map for a wrong passphrase (degrade, not crash)", async () => {
    const vaultPath = path.join(dir, "vault.json")
    const vault = new Vault(vaultPath, "correct-passphrase")
    await vault.load()
    await vault.save({ title: "provider:kimi", secret: "sk-kimi-123" })

    const creds = await loadProviderCredentialsFromVault({
      MAXIMILIAN_VAULT_PATH: vaultPath,
      MAXIMILIAN_VAULT_PASSPHRASE: "wrong-passphrase",
    })
    expect(creds).toEqual({})
  })

  it("treats a missing vault file as empty", async () => {
    const creds = await loadProviderCredentialsFromVault({
      MAXIMILIAN_VAULT_PATH: path.join(dir, "absent.json"),
      MAXIMILIAN_VAULT_PASSPHRASE: "whatever",
    })
    expect(creds).toEqual({})
  })
})
