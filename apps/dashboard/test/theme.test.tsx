/**
 * Tests for the theme controller — covers localStorage persistence,
 * prefers-color-scheme detection, and the setMode dispatch path.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTheme, getStoredTheme, setStoredTheme, THEME_STORAGE_KEY } from "../src/lib/theme";

describe("theme storage helpers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns 'system' when nothing is stored", () => {
    expect(getStoredTheme()).toBe("system");
  });

  it("returns the stored value when present", () => {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify("light"));
    expect(getStoredTheme()).toBe("light");
  });

  it("ignores garbage values and falls back to 'system'", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "not json");
    expect(getStoredTheme()).toBe("system");
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify("purple"));
    expect(getStoredTheme()).toBe("system");
  });

  it("setStoredTheme writes JSON-stringified mode", () => {
    setStoredTheme("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('"dark"');
  });
});

describe("useTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("light", "dark");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts in system mode and reflects the OS preference", () => {
    const matchMediaMock = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    Object.defineProperty(window, "matchMedia", { writable: true, value: matchMediaMock });

    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe("system");
    expect(result.current.effective).toBe("light");
  });

  it("setMode persists to localStorage and updates the hook", () => {
    const matchMediaMock = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    Object.defineProperty(window, "matchMedia", { writable: true, value: matchMediaMock });

    const { result } = renderHook(() => useTheme());
    act(() => result.current.setMode("light"));
    expect(getStoredTheme()).toBe("light");
    expect(result.current.mode).toBe("light");
    expect(result.current.effective).toBe("light");
  });

  it("forced dark mode overrides the OS preference", () => {
    const matchMediaMock = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    Object.defineProperty(window, "matchMedia", { writable: true, value: matchMediaMock });

    const { result } = renderHook(() => useTheme());
    act(() => result.current.setMode("dark"));
    expect(result.current.effective).toBe("dark");
  });

  it("applies the effective theme class on document.documentElement", () => {
    const matchMediaMock = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    Object.defineProperty(window, "matchMedia", { writable: true, value: matchMediaMock });

    const { result } = renderHook(() => useTheme());
    act(() => result.current.setMode("light"));
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("responds to cross-tab storage events", () => {
    const matchMediaMock = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    Object.defineProperty(window, "matchMedia", { writable: true, value: matchMediaMock });

    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe("system");

    act(() => {
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify("light"));
      window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY }));
    });

    expect(result.current.mode).toBe("light");
  });
});