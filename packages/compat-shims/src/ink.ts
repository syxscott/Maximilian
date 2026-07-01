/**
 * Ink adapter — absorbs upstream API drift between ink 5 and ink 6.
 *
 * Current TUI uses ink 5.2.1. ink 6 (in beta as of 2026) is rumored to
 * rename `useInput` → `useKeyInput` and move `Box` props to a new namespace.
 * Rather than rewrite the TUI when that lands, this shim gives us one
 * place to maintain the mapping.
 *
 * The shape exposed here is intentionally small — just the surface every
 * Maximilian component actually uses. If we ever need more, add it here
 * rather than re-importing from "ink" directly anywhere else.
 */
import { createRequire } from "node:module";

import { resolveMajor } from "./version.js";

const cjsRequire = createRequire(import.meta.url);

// ---- Public surface ----

/**
 * The `useInput` handler signature we expose to consumers. Same shape as
 * ink 5/6 so existing code drops in unchanged. If ink 6 splits the flags
 * out into a separate `useKey` hook, we extend this here, not in callers.
 */
export type InkInputHandler = (input: string, key: InkKey) => void;

export interface InkKey {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  escape: boolean;
  return: boolean;
  tab: boolean;
  backspace: boolean;
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
}

export interface UseInputOptions {
  isActive?: boolean;
}

export interface InkApp {
  exit: (error?: Error) => void;
}

/**
 * Synchronous wrapper around ink's `useInput`. Call this from inside a
 * React function component the same way you'd call ink's hook directly.
 *
 * When ink 6 ships breaking changes, the branch below is the only place
 * that needs editing.
 */
export function useInputShim(handler: InkInputHandler, options?: UseInputOptions): void {
  const ink = loadInk();
  const inkMajor = resolveMajor("ink", 5);
  if (inkMajor >= 6) {
    // Placeholder for ink 6 migration. Today we just call through.
    ink.useInput(handler as never, options as never);
    return;
  }
  ink.useInput(handler as never, options as never);
}

/**
 * Synchronous wrapper around ink's `useApp`. Returns an object with at
 * least `exit()`. If ink 6 introduces more app-level methods, expose
 * them here.
 */
export function useAppShim(): InkApp {
  const ink = loadInk();
  const app = ink.useApp() as { exit: (e?: Error) => void };
  return { exit: app.exit };
}

/**
 * Box props re-export. Today this is a thin pass-through; if ink 6 renames
 * `flexDirection` → `direction` (a rumored change), we map here.
 */
export type BoxProps = Record<string, unknown>;

// ---- internal ----

/**
 * Load ink from the calling package's `node_modules`. We use CommonJS
 * `require` (via `createRequire`) because:
 *   - React hook bodies are sync, so an `await import()` won't work there.
 *   - `compat-shims` is itself an ESM package, so a top-level `import`
 *     would force ink as a hard dependency, which we don't want — this
 *     shim is consumed by the TUI (which has ink), the API (which
 *     doesn't), and the dashboard (which doesn't).
 *
 * If ink isn't installed this throws a clean `MODULE_NOT_FOUND` at the
 * call site, which is the right signal — callers should only import this
 * module from packages that depend on ink.
 */
function loadInk(): typeof import("ink") {
  return cjsRequire("ink") as typeof import("ink");
}
