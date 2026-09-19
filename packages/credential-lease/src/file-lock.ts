import { open, rm, stat } from "node:fs/promises"
import { dirname } from "node:path"

import { ensurePrivateDirectory } from "./atomic-write.js"

export interface FileLockOptions {
  /** Age (ms) after which a leftover lock file is considered stale and broken. */
  staleMs?: number
  /** Total budget (ms) spent retrying the exclusive create before failing. */
  timeoutMs?: number
  /** Base delay (ms) between retries; grows linearly up to 50ms. */
  retryDelayMs?: number
}

const DEFAULT_STALE_MS = 30_000
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_RETRY_DELAY_MS = 5
const MAX_RETRY_DELAY_MS = 50

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}

/**
 * Zero-dependency cross-process lock (the source uses `proper-lockfile`; this port
 * must stay dependency-free). Mutual exclusion via exclusive-create of a mode-0600
 * lock file, with stale-lock breaking based on mtime. Not reentrant.
 */
export async function withFileLock<T>(
  lockPath: string,
  operation: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  await ensurePrivateDirectory(dirname(lockPath))
  const deadline = Date.now() + timeoutMs
  let attempt = 0
  let handle
  for (;;) {
    try {
      handle = await open(lockPath, "wx", 0o600)
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      if (Date.now() >= deadline) {
        throw new Error(`Timed out acquiring credential lease lock: ${lockPath}`)
      }
      try {
        const metadata = await stat(lockPath)
        if (Date.now() - metadata.mtimeMs > staleMs) await rm(lockPath, { force: true })
      } catch {
        // The holder released it first; retry immediately.
      }
      await sleep(Math.min(MAX_RETRY_DELAY_MS, retryDelayMs * (attempt + 1)))
      attempt += 1
    }
  }
  await handle.close()
  try {
    return await operation()
  } finally {
    await rm(lockPath, { force: true })
  }
}
