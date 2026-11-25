// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Vault → provider credentials bootstrap.
 *
 * The provider registry reads API keys ONLY from env vars (its contract:
 * keys never enter registry state or the DB). This module is the bridge
 * that lets those env vars come from the encrypted {@link Vault} instead
 * of a process environment: entries titled `provider:<presetId>` are
 * resolved and returned as an env-shaped map that callers merge into
 * `process.env` BEFORE creating the registry singleton.
 *
 * Convention: vault entry title `provider:kimi` holds the API key for the
 * preset with id `kimi` (its `envKey` receives the secret). Entries that
 * fail to decrypt are skipped — a wrong passphrase degrades to
 * env-var-only credentials rather than failing the boot.
 */

import { PROVIDER_PRESETS } from "@max/providers"
import { Vault } from "./vault.js"

export const VAULT_PROVIDER_TITLE_PREFIX = "provider:"

/**
 * Process-local registry of provider secrets this process resolved from the
 * vault. The bootstrap opens a Vault, resolves entries, and then only the
 * env-shaped map leaves the function — but tool output can echo a key that
 * pattern masking does not recognise (a user-configured provider, say).
 * Recording the exact values here gives scrubbing
 * (`scrubForModelContext`) the same redaction source the Vault itself would
 * have provided, without threading a Vault instance through every entrypoint.
 *
 * The values are already present as plaintext in `process.env` by the time
 * callers merge the returned map, so this adds no new exposure.
 */
const resolvedProviderSecrets = new Set<string>()

/**
 * Redact every provider secret this process resolved from the vault. Use as
 * the `vault` of {@link scrubForModelContext} / `RuntimeOptions.vault`; the
 * runtime defaults to it when no explicit vault is supplied.
 */
export function redactResolvedProviderCredentials(text: string): string {
  let out = text
  for (const secret of resolvedProviderSecrets) {
    if (secret) out = out.split(secret).join("[redacted]")
  }
  return out
}

/**
 * Collect provider API keys from the vault, when configured.
 * Configuration: `MAXIMILIAN_VAULT_PATH` + `MAXIMILIAN_VAULT_PASSPHRASE`.
 * Returns an env-shaped map (`{ [envKey]: secret }`), empty when the
 * vault is not configured or cannot be opened.
 */
export async function loadProviderCredentialsFromVault(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, string>> {
  const vaultPath = env.MAXIMILIAN_VAULT_PATH
  const passphrase = env.MAXIMILIAN_VAULT_PASSPHRASE
  if (!vaultPath || !passphrase) return {}

  let vault: Vault
  try {
    vault = new Vault(vaultPath, passphrase)
    await vault.load()
  } catch {
    return {}
  }

  const out: Record<string, string> = {}
  const entries = vault.list()
  for (const preset of PROVIDER_PRESETS) {
    const entry = entries.find((e) => e.title === `${VAULT_PROVIDER_TITLE_PREFIX}${preset.id}`)
    if (!entry) continue
    try {
      // resolve() auto-registers the secret in the Vault; mirror it into the
      // process-local registry so output scrubbing can redact it later.
      const secret = vault.resolve(entry.handle)
      resolvedProviderSecrets.add(secret)
      out[preset.envKey] = secret
    } catch {
      // Undecryptable entry (wrong passphrase, corrupted payload) — skip
      // this provider; env-var credentials still apply.
    }
  }
  return out
}
