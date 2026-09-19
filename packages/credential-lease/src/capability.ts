import { randomBytes } from "node:crypto"
import { chmod, mkdir, open, rename, rm } from "node:fs/promises"
import path from "node:path"

import { CredentialLeaseProtocolError } from "./contracts.js"

export const CAPABILITY_BYTE_LENGTH = 32
export const CREDENTIAL_LEASE_CAPABILITY_PATTERN = /^[a-f0-9]{64}$/u

/** Generates the lease capability: 32 random bytes encoded as lowercase hex. */
export function createCapability(): string {
  return randomBytes(CAPABILITY_BYTE_LENGTH).toString("hex")
}

/**
 * Writes the capability file atomically: temp file with mode 0600 (exclusive create,
 * fsync), then rename over the target. The parent run directory is forced to 0700.
 */
export async function writeCapabilityFile(
  capabilityFile: string,
  capability: string,
): Promise<void> {
  if (!CREDENTIAL_LEASE_CAPABILITY_PATTERN.test(capability)) {
    throw new CredentialLeaseProtocolError("INVALID_REQUEST")
  }
  const directory = path.dirname(capabilityFile)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  if (process.platform !== "win32") await chmod(directory, 0o700)
  const temporaryFile = `${capabilityFile}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`
  let handle
  try {
    handle = await open(temporaryFile, "wx", 0o600)
    await handle.writeFile(`${capability}\n`, "utf8")
    await handle.sync()
    if (process.platform !== "win32") await handle.chmod(0o600)
    await handle.close()
    handle = undefined
    await rename(temporaryFile, capabilityFile)
    if (process.platform !== "win32") await chmod(capabilityFile, 0o600)
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await rm(temporaryFile, { force: true })
    throw error
  }
}
