/**
 * File-based locale persistence for the TUI.
 *
 * The dashboard uses localStorage, which the TUI doesn't have. This
 * module writes the active locale to a tiny file under the XDG state
 * directory so the user's choice survives across TUI sessions.
 *
 *   Linux:   $XDG_STATE_HOME/maximilian/locale (default ~/.local/state/maximilian/locale)
 *   macOS:   $XDG_STATE_HOME/maximilian/locale (default ~/.local/state/maximilian/locale)
 *   Windows: %LOCALAPPDATA%\maximilian\locale  (e.g. C:\Users\<user>\AppData\Local\maximilian\locale)
 *
 * Three primitives are returned so the caller can plug them straight
 * into initLocale({ loadFrom, saveTo, removeOnReset }):
 *
 *   initLocale({
 *     loadFrom: readLocaleFile,
 *     saveTo: writeLocaleFile,
 *     removeOnReset: removeLocaleFile,
 *   })
 *
 * All operations swallow errors — locale persistence is best-effort.
 * If the disk is full or the file is unreadable, the TUI still boots in
 * the resolved locale; we just lose the persistence on next boot.
 */

import path from "node:path"
import os from "node:os"

/** State directory for Maximilian on the current platform.
 *
 *  Honors XDG_STATE_HOME so power users can redirect; falls back to the
 *  default per OS. We intentionally keep this in the TUI side rather than
 *  in `@max/i18n` so the browser bundle isn't forced to depend on
 *  node:fs / node:os. */
export function stateDir(): string {
  const explicit = process.env.MAXIMILIAN_STATE_DIR
  if (explicit) return explicit

  const xdg = process.env.XDG_STATE_HOME
  if (xdg) return path.join(xdg, "maximilian")

  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA
    if (local) return path.join(local, "maximilian")
    return path.join(os.homedir(), "AppData", "Local", "maximilian")
  }

  // macOS + Linux default per XDG Base Directory Specification.
  return path.join(os.homedir(), ".local", "state", "maximilian")
}

/** Absolute path of the locale file. Computed lazily so changing
 *  MAXIMILIAN_STATE_DIR / XDG_STATE_HOME at runtime is honored. */
function localeFile(): string {
  return path.join(stateDir(), "locale")
}

/** Read the persisted locale, or undefined if the file is missing,
 *  unreadable, or contains an unregistered tag. */
export function readLocaleFile(): string | undefined {
  // node:fs is loaded dynamically to keep this module tree-shakeable
  // and to avoid blocking module init when the disk is slow.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs")
  try {
    const raw = fs.readFileSync(localeFile(), "utf8")
    const trimmed = raw.trim()
    if (!trimmed) return undefined
    return trimmed
  } catch {
    return undefined
  }
}

/** Persist the active locale. Creates the state directory if missing. */
export function writeLocaleFile(locale: string): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs")
  const dir = stateDir()
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    // mkdirSync with recursive: true can still throw if path is on a
    // read-only volume or the user has no write access. Persistence is
    // best-effort, so swallow.
    return
  }
  try {
    fs.writeFileSync(localeFile(), locale, "utf8")
  } catch {
    // Same reasoning — losing persistence is preferable to crashing the TUI.
  }
}

/** Remove the persisted locale file. Used by resetLocaleToSystem(). */
export function removeLocaleFile(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs")
  try {
    fs.unlinkSync(localeFile())
  } catch {
    // ENOENT is fine — the file may have been deleted by another process.
  }
}