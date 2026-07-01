/**
 * Tests for @max/i18n.
 *
 * Covers:
 *   - Default locale is zh-CN
 *   - t() returns current locale value, falls back when missing
 *   - setLocale() persists and notifies subscribers
 *   - initLocale() reads from storage, falls back to navigator.language
 *   - Missing-key warning fires once per key, not on every call
 *   - useLocale() (React) re-renders on change
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  t,
  getLocale,
  setLocale,
  initLocale,
  subscribe,
  localeDisplayName,
  useLocale,
  __resetI18n,
  DEFAULT_LOCALE,
  listLocales,
  registerLocale,
  tn,
  ts,
} from "../src/index.js";

describe("i18n — defaults", () => {
  beforeEach(() => {
    __resetI18n();
    localStorage.clear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("default locale is zh-CN", () => {
    expect(DEFAULT_LOCALE).toBe("zh-CN");
    expect(getLocale()).toBe("zh-CN");
  });

  it("listLocales contains exactly zh-CN and en-US by default", () => {
    expect(new Set(listLocales())).toEqual(new Set(["zh-CN", "en-US"]));
  });

  it("localeDisplayName renders the locale in its own language", () => {
    expect(localeDisplayName("zh-CN")).toBe("中文 (简体)");
    expect(localeDisplayName("en-US")).toBe("English");
  });
});

describe("i18n — t()", () => {
  beforeEach(() => {
    __resetI18n();
    localStorage.clear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns the zh-CN value by default", () => {
    expect(t("common.save")).toBe("保存");
    expect(t("chat.title")).toBe("对话");
    expect(t("provider.setDefault")).toBe("设为默认");
  });

  it("returns the en-US value after setLocale('en-US')", () => {
    setLocale("en-US");
    expect(t("common.save")).toBe("Save");
    expect(t("chat.title")).toBe("Chat");
  });

  it("interpolates {param} placeholders when given an object", () => {
    setLocale("zh-CN");
    expect(t("chat.completed", { score: 9 })).toBe("执行完成。评审得分：9/10");
    setLocale("en-US");
    expect(t("chat.completed", { score: 9 })).toBe("Execution complete. Review score: 9/10");
  });

  it("substitutes multiple placeholders in one call", () => {
    setLocale("en-US");
    // app.tabLoading has {label}; confirm replacement happens (we don't ship
    // a multi-param key in the dictionaries, so just exercise the loop).
    const label = "Chat";
    expect(t("app.tabLoading", { label })).toBe(`Loading ${label}…`);
  });

  it("leaves unknown placeholders alone", () => {
    setLocale("en-US");
    expect(t("app.tabLoading", { wrongKey: "x" })).toBe("Loading {label}…");
  });

  it("falls back to the explicit fallback arg when key missing", () => {
    expect(t("definitely.not.a.key", "FALLBACK")).toBe("FALLBACK");
  });

  it("falls back to the key itself when no fallback given", () => {
    expect(t("definitely.not.a.key")).toBe("definitely.not.a.key");
  });

  it("warns once per missing key (not on every call)", () => {
    const warn = vi.mocked(console.warn);
    t("missing.key.A");
    t("missing.key.A");
    t("missing.key.A");
    t("missing.key.B");
    const warnings = warn.mock.calls.filter((c) => String(c[0]).includes("[i18n]"));
    expect(warnings.length).toBe(2);
  });
});

describe("i18n — setLocale & persistence", () => {
  beforeEach(() => {
    __resetI18n();
    localStorage.clear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("setLocale persists to localStorage", () => {
    setLocale("en-US");
    expect(localStorage.getItem("maximilian.locale")).toBe("en-US");
  });

  it("ignores unsupported locales (no crash)", () => {
    setLocale("fr-FR" as never);
    expect(getLocale()).toBe("zh-CN"); // unchanged
  });

  it("notifies subscribers on change", () => {
    const listener = vi.fn();
    const unsub = subscribe(listener);
    setLocale("en-US");
    expect(listener).toHaveBeenCalledTimes(1);
    setLocale("zh-CN");
    expect(listener).toHaveBeenCalledTimes(2);
    unsub();
    setLocale("en-US");
    expect(listener).toHaveBeenCalledTimes(2); // unsubscribed
  });
});

describe("i18n — initLocale()", () => {
  beforeEach(() => {
    __resetI18n();
    localStorage.clear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("reads from localStorage when set", () => {
    localStorage.setItem("maximilian.locale", "en-US");
    expect(initLocale()).toBe("en-US");
    expect(getLocale()).toBe("en-US");
  });

  it("ignores garbage in localStorage and falls back to navigator", () => {
    localStorage.setItem("maximilian.locale", "garbage");
    Object.defineProperty(navigator, "language", { value: "zh-CN", configurable: true });
    expect(initLocale()).toBe("zh-CN");
  });

  it("uses zh-CN when navigator.language starts with 'zh'", () => {
    Object.defineProperty(navigator, "language", { value: "zh-TW", configurable: true });
    expect(initLocale()).toBe("zh-CN");
  });

  it("uses en-US when navigator.language does not start with 'zh'", () => {
    Object.defineProperty(navigator, "language", { value: "en-GB", configurable: true });
    expect(initLocale()).toBe("en-US");
  });
});

describe("i18n — useLocale() React hook", () => {
  beforeEach(() => {
    __resetI18n();
    localStorage.clear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns the current locale and a setter that re-renders", () => {
    const { result } = renderHook(() => useLocale());
    expect(result.current.locale).toBe("zh-CN");
    act(() => {
      result.current.setLocale("en-US");
    });
    expect(result.current.locale).toBe("en-US");
  });

  it("reflects external setLocale() calls after re-render", () => {
    const { result } = renderHook(() => useLocale());
    expect(result.current.locale).toBe("zh-CN");
    act(() => {
      setLocale("en-US");
    });
    expect(result.current.locale).toBe("en-US");
  });
});

describe("i18n — registerLocale (3+ language support)", () => {
  beforeEach(() => {
    __resetI18n();
    localStorage.clear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("adding a 3rd language does not require source changes", () => {
    registerLocale("ja-JP", { "common.save": "保存" }, "日本語");
    expect(listLocales()).toContain("ja-JP");
    expect(localeDisplayName("ja-JP")).toBe("日本語");
    setLocale("ja-JP");
    expect(t("common.save")).toBe("保存");
    expect(getLocale()).toBe("ja-JP");
  });

  it("re-registering the same locale overwrites the dictionary", () => {
    registerLocale("ja-JP", { "common.save": "保存" });
    setLocale("ja-JP");
    registerLocale("ja-JP", { "common.save": "save" });
    expect(t("common.save")).toBe("save");
  });

  it("setLocale warns on an unregistered locale and keeps the current one", () => {
    const warn = vi.mocked(console.warn);
    setLocale("ja-JP");
    expect(getLocale()).toBe("zh-CN");
    expect(warn.mock.calls.some((c) => String(c[0]).includes("unknown locale"))).toBe(true);
  });
});

describe("i18n — tn() plural forms (ICU)", () => {
  beforeEach(() => {
    __resetI18n();
    localStorage.clear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Use a real BCP-47 tag — Intl.PluralRules rejects fake ones.
    registerLocale("fr-FR", {
      "item.count.one": "{count} article",
      "item.count.other": "{count} articles",
    });
  });

  it("selects the right plural branch for cardinal numbers", () => {
    setLocale("fr-FR");
    // French: 0 and 1 are "one" form, 2+ are "other".
    expect(tn("item.count", { count: 1 })).toBe("1 article");
    expect(tn("item.count", { count: 5 })).toBe("5 articles");
  });

  it("falls back to t() when no plural form is registered", () => {
    setLocale("en-US");
    // No plural forms registered for "common.save" in en-US — should fall back.
    expect(tn("common.save", { count: 1 })).toBe("Save");
  });
});

describe("i18n — ts() select forms (ICU)", () => {
  beforeEach(() => {
    __resetI18n();
    localStorage.clear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    registerLocale("test-se", {
      "status.ok": "all good",
      "status.error": "something broke",
      "status": "unknown status",
    });
  });

  it("selects the right branch by value", () => {
    setLocale("test-se");
    expect(ts("status", { status: "ok" }, { fallback: "unknown" })).toBe("all good");
    expect(ts("status", { status: "error" }, { fallback: "unknown" })).toBe("something broke");
  });

  it("falls back when no branch matches", () => {
    setLocale("test-se");
    expect(ts("status", { status: "weird" }, { fallback: "unknown" })).toBe("unknown status");
  });
});

describe("i18n — initLocale() with loadFrom/saveTo (TUI case)", () => {
  beforeEach(() => {
    __resetI18n();
    localStorage.clear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("loadFrom is consulted first and short-circuits storage", () => {
    localStorage.setItem("maximilian.locale", "en-US");
    expect(initLocale({ loadFrom: () => "zh-CN" })).toBe("zh-CN");
  });

  it("saveTo is called with the resolved locale (TUI persistence)", () => {
    const saved: string[] = [];
    initLocale({ saveTo: (l) => saved.push(l) });
    expect(saved.length).toBe(1);
    expect(saved[0]).toMatch(/zh-CN|en-US/);
  });

  it("falls through to localStorage when loadFrom returns undefined", () => {
    localStorage.setItem("maximilian.locale", "en-US");
    expect(initLocale({ loadFrom: () => undefined })).toBe("en-US");
  });

  it("setLocale() after initLocale() also calls the installed saveTo", () => {
    const saved: string[] = [];
    initLocale({ saveTo: (l) => saved.push(l) });
    const initialWrites = saved.length;
    setLocale("en-US");
    expect(saved).toContain("en-US");
    expect(saved.length).toBe(initialWrites + 1);
  });

  it("resetLocaleToSystem() calls the installed removeOnReset", () => {
    const removed: number[] = [];
    initLocale({ removeOnReset: () => removed.push(1) });
    // Switch first so we know reset() doesn't bail early.
    setLocale("en-US");
    const before = removed.length;
    // resetLocaleToSystem re-detects and may call setLocale under the hood —
    // we just want to confirm removeOnReset ran.
    // Use the public hook wrapper:
    const { reset } = useLocaleShim();
    void reset();
    expect(removed.length).toBeGreaterThan(before);
  });
});

// Tiny shim so the reset test can call reset without pulling in the React
// hook (which requires @testing-library/react setup we don't want here).
import { resetLocaleToSystem } from "../src/index.js";
function useLocaleShim() {
  return { reset: resetLocaleToSystem };
}
