/**
 * Atomic file write helper — write to a temp file in the same directory,
 * then rename over the target. On POSIX filesystems `rename(2)` is atomic
 * for same-filesystem operations, so readers see either the old content
 * or the new content — never a half-written file.
 *
 * Why not `fs.writeFile` directly: a crash (or `setItem` race) mid-write
 * leaves the file truncated, and the next reader either crashes on JSON
 * parse or reads corrupted state. The temp-and-rename pattern avoids both.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function writeFileAtomic(target: string, content: string): Promise<void> {
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  // Put the temp file in the same directory so the rename is on the
  // same filesystem (cross-device renames are not atomic on Linux).
  const tmp = path.join(dir, `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(tmp, content, "utf-8");
    await fs.rename(tmp, target);
  } catch (err) {
    // Best-effort cleanup of the temp file on failure.
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

/**
 * Read-modify-write serialized by a directory-based file lock. Reads
 * the file, applies `transform`, writes atomically. Multiple concurrent
 * callers for the same `target` are queued via `mkdir` of a lock
 * directory — `mkdir(2)` is atomic on POSIX, so exactly one caller
 * holds the lock at a time.
 *
 * The previous mtime-CAS version wasn't reliable on filesystems with
 * millisecond mtime resolution: two writers within the same millisecond
 * both saw the same mtime, both wrote, and one clobbered the other.
 * The mkdir-lock pattern is correct on any POSIX filesystem.
 *
 * Bounded retries (200 × ~10ms jitter = ~2s worst case) to avoid
 * livelock if a holder crashes without releasing the lock; in that
 * case the lock is stale and we'll time out rather than hang forever.
 */
export async function readModifyWriteAtomic<T>(
  target: string,
  defaultValue: T,
  transform: (current: T) => T,
): Promise<T> {
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });

  return await withFileLock(target, async () => {
    let current: T;
    try {
      const raw = await fs.readFile(target, "utf-8");
      current = JSON.parse(raw) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        current = defaultValue;
      } else {
        throw err;
      }
    }
    const next = transform(current);
    await writeFileAtomic(target, JSON.stringify(next, null, 2));
    return next;
  });
}

/**
 * POSIX file lock via mkdir. `mkdir` is atomic — only one process can
 * succeed in creating a directory that doesn't exist. We use the lock
 * directory's existence as the mutex: holder removes it on release.
 *
 * Retries with jittered backoff for up to ~2s before failing. Stale
 * locks (process crashed mid-section) block subsequent writers until
 * the timeout, but that's safer than letting two writers race.
 */
async function withFileLock<T>(target: string, fn: () => Promise<T>): Promise<T> {
  const lockDir = `${target}.lock`;
  const MAX_ATTEMPTS = 200;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      await fs.mkdir(lockDir);
      try {
        return await fn();
      } finally {
        await fs.rmdir(lockDir).catch(() => {});
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      // 5–25ms jittered backoff so concurrent waiters don't thunder
      // and re-collide on the same tick.
      await new Promise((r) => setTimeout(r, 5 + Math.floor(Math.random() * 20)));
    }
  }
  throw new Error(`readModifyWriteAtomic: could not acquire lock for ${target} (stale?)`);
}
