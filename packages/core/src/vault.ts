// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Credential Vault core (hermes borrowing: vault_store.py / redaction
 * registry). Storage-side only — the browser-fill tool integration is a
 * later step.
 *
 * Security model ported from hermes:
 *  - Secrets are encrypted at rest (AES-256-GCM, scrypt-derived key from a
 *    master passphrase) in a 0600 file under the state dir.
 *  - Consumers (tools, prompts) only ever see an OPAQUE HANDLE plus
 *    metadata. The secret value is resolved at the last possible moment
 *    and registered for REDACTION so it never survives into tool results,
 *    logs, or model context.
 *  - The vault file never stores plaintext, and `resolve()` returns a
 *    value that MUST be scrubbed — expose {@link Vault.redact} for that.
 */

import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"

export interface VaultEntryMeta {
  handle: string
  title: string
  username?: string
  /** Origin this secret is bound to (e.g. "https://example.com"). */
  origin?: string
  createdAt: string
}

interface StoredEntry {
  meta: VaultEntryMeta
  /** AES-256-GCM: iv:ciphertext:authtag, all base64. */
  payload: string
}

interface VaultFile {
  version: 1
  /** scrypt salt. */
  salt: string
  entries: Record<string, StoredEntry>
}

export interface VaultSaveInput {
  title: string
  secret: string
  username?: string
  origin?: string
}

export class Vault {
  private file: VaultFile
  private readonly redactions = new Set<string>()

  constructor(
    private readonly filePath: string,
    private readonly masterPassphrase: string,
  ) {
    this.file = { version: 1, salt: randomBytes(16).toString("hex"), entries: {} }
  }

  /** Load the encrypted store from disk (missing file = empty vault). */
  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8")
      const parsed = JSON.parse(raw) as VaultFile
      if (parsed?.version !== 1 || typeof parsed.salt !== "string") {
        throw new Error("vault file has an unrecognized format")
      }
      this.file = parsed
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === "ENOENT") return
      throw err
    }
  }

  private key(): Buffer {
    return scryptSync(this.masterPassphrase, this.file.salt, 32)
  }

  private encrypt(plaintext: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv)
    const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
    return `${iv.toString("base64")}:${enc.toString("base64")}:${cipher.getAuthTag().toString("base64")}`
  }

  private decrypt(payload: string): string {
    const [ivB64, dataB64, tagB64] = payload.split(":")
    const decipher = createDecipheriv("aes-256-gcm", this.key(), Buffer.from(ivB64!, "base64"))
    decipher.setAuthTag(Buffer.from(tagB64!, "base64"))
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64!, "base64")),
      decipher.final(),
    ]).toString("utf8")
  }

  /** Persist with 0600 permissions via temp+rename (atomic, private). */
  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp.${process.pid}`
    await fs.writeFile(tmp, JSON.stringify(this.file, null, 2), { mode: 0o600 })
    await fs.rename(tmp, this.filePath)
    await fs.chmod(this.filePath, 0o600).catch(() => {})
  }

  /**
   * Store a secret and register it for redaction. Returns the OPAQUE
   * handle — the only thing callers may keep or log.
   */
  async save(input: VaultSaveInput): Promise<VaultEntryMeta> {
    const handle = `vh_${randomBytes(8).toString("hex")}`
    this.file.entries[handle] = {
      meta: {
        handle,
        title: input.title,
        username: input.username,
        origin: input.origin,
        createdAt: new Date().toISOString(),
      },
      payload: this.encrypt(input.secret),
    }
    this.redactions.add(input.secret)
    await this.persist()
    return { ...this.file.entries[handle]!.meta }
  }

  /**
   * Resolve a handle to its secret. The returned value is auto-registered
   * for redaction — use {@link redact} on any output that might contain it.
   */
  resolve(handle: string): string {
    const entry = this.file.entries[handle]
    if (!entry) throw new Error(`vault: unknown handle ${handle}`)
    const secret = this.decrypt(entry.payload)
    this.redactions.add(secret)
    return secret
  }

  /** Replace any stored secret value found in `text` with `[redacted]`. */
  redact(text: string): string {
    let out = text
    for (const entry of Object.values(this.file.entries)) {
      try {
        const secret = this.decrypt(entry.payload)
        if (secret) out = out.split(secret).join("[redacted]")
      } catch {
        // Undecryptable entry (wrong passphrase changed mid-flight) — skip.
      }
    }
    for (const secret of this.redactions) {
      if (secret) out = out.split(secret).join("[redacted]")
    }
    return out
  }

  /** Metadata listing (no secrets) for UI/audit. */
  list(): VaultEntryMeta[] {
    return Object.values(this.file.entries).map((e) => ({ ...e.meta }))
  }

  /** Remove an entry (e.g. user deletes a saved login). */
  async remove(handle: string): Promise<boolean> {
    if (!this.file.entries[handle]) return false
    delete this.file.entries[handle]
    await this.persist()
    return true
  }
}
