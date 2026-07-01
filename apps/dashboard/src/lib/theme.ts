/**
 * Theme controller — system / light / dark with localStorage persistence.
 *
 * Contract with index.html: the inline boot script reads `localStorage`'s
 * `maximilian-theme` value (JSON-stringified `"system" | "light" | "dark"`)
 * and `prefers-color-scheme` to set `<html class="light|dark">` before any
 * CSS paints. This module mirrors those changes from React and keeps them
 * in sync across tabs and when the OS preference changes at runtime.
 *
 * Storage key: `maximilian-theme`
 *   - "system" (default): follow `prefers-color-scheme`
 *   - "light": force light mode
 *   - "dark":  force dark mode
 *
 * Effective scheme is derived: `mode === "system" ? (osLight ? light : dark) : mode`.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";

export type ThemeMode = "system" | "light" | "dark";
export type EffectiveTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "maximilian-theme";
const MODES: ReadonlyArray<ThemeMode> = ["system", "light", "dark"];

function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && (MODES as ReadonlyArray<string>).includes(value);
}

/** Read the persisted mode (always returns a valid ThemeMode). */
export function getStoredTheme(): ThemeMode {
  if (typeof localStorage === "undefined") return "system";
  const raw = localStorage.getItem(THEME_STORAGE_KEY);
  if (!raw) return "system";
  try {
    const parsed: unknown = JSON.parse(raw);
    return isThemeMode(parsed) ? parsed : "system";
  } catch {
    return "system";
  }
}

export function setStoredTheme(mode: ThemeMode): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(mode));
}

/** Subscribe to OS light/dark preference changes. */
function subscribeSystemPref(handler: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const listener = () => handler();
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }
  // Safari < 14 fallback
  mq.addListener(listener);
  return () => mq.removeListener(listener);
}

function readSystemPref(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: light)").matches;
}

export function getEffectiveTheme(mode: ThemeMode, systemLight: boolean): EffectiveTheme {
  if (mode === "light") return "light";
  if (mode === "dark") return "dark";
  return systemLight ? "light" : "dark";
}

/**
 * Apply the theme to the document: set `<html class="light|dark">` and the
 * `color-scheme` style so native form controls (scrollbars, inputs) follow.
 */
function applyTheme(effective: EffectiveTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(effective);
  root.style.colorScheme = effective;
}

export interface ThemeController {
  mode: ThemeMode;
  effective: EffectiveTheme;
  setMode: (mode: ThemeMode) => void;
}

/**
 * React hook — returns the current mode, the resolved effective theme, and a
 * setter that updates localStorage + applies to the DOM. When `mode` is
 * `"system"`, the hook re-renders whenever `prefers-color-scheme` changes.
 */
export function useTheme(): ThemeController {
  const mode = useSyncExternalStore(
    (handler) => {
      if (typeof window === "undefined") return () => {};
      const onStorage = (e: StorageEvent) => {
        if (e.key === THEME_STORAGE_KEY) handler();
      };
      window.addEventListener("storage", onStorage);
      return () => window.removeEventListener("storage", onStorage);
    },
    () => getStoredTheme(),
    () => "system" as ThemeMode,
  );

  const systemLight = useSyncExternalStore(
    subscribeSystemPref,
    readSystemPref,
    () => false,
  );

  const effective = getEffectiveTheme(mode, systemLight);

  useEffect(() => {
    applyTheme(effective);
  }, [effective]);

  const setMode = useCallback((next: ThemeMode) => {
    setStoredTheme(next);
    // Notify same-tab listeners (storage event only fires across tabs).
    window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY }));
  }, []);

  return { mode, effective, setMode };
}