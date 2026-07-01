/**
 * Tests for the locale-aware format helpers in @max/i18n.
 *
 * Covers:
 *   - formatNumber / formatCompact / formatTokens — locale-aware digits
 *   - formatBytes — IEC binary units
 *   - formatDate / formatDateTime / formatRelative — Intl.DateTimeFormat / RelativeTimeFormat
 *   - formatDuration — wall-clock style ("1h 23m")
 *   - formatList — Intl.ListFormat
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  formatNumber,
  formatCompact,
  formatTokens,
  formatBytes,
  formatDate,
  formatDateTime,
  formatRelative,
  formatDuration,
  formatList,
  formatPercent,
  setLocale,
  __resetI18n,
} from "../src/index.js";

describe("format — number helpers", () => {
  beforeEach(() => __resetI18n());

  it("formatNumber uses the active locale's separators", () => {
    setLocale("en-US");
    // en-US uses commas for thousands.
    expect(formatNumber(1234.5)).toMatch(/1,234\.5/);
  });

  it("formatPercent converts a fraction to %", () => {
    setLocale("en-US");
    expect(formatPercent(0.123)).toBe("12%");
    expect(formatPercent(0.1234, 1)).toBe("12.3%");
  });

  it("formatCompact produces short forms like '1.2K'", () => {
    setLocale("en-US");
    expect(formatCompact(1234)).toMatch(/1\.2K/);
    expect(formatCompact(1_500_000)).toMatch(/1\.5M/);
  });

  it("formatTokens is an alias for formatCompact tuned for tokens", () => {
    setLocale("en-US");
    expect(formatTokens(1234)).toMatch(/1\.2K/);
  });
});

describe("format — formatBytes (binary IEC units)", () => {
  beforeEach(() => __resetI18n());

  it("formats sub-KB as B", () => {
    setLocale("en-US");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toMatch(/512 B/);
  });

  it("scales up to KB / MB / GB", () => {
    setLocale("en-US");
    expect(formatBytes(1536)).toMatch(/1\.5 KB/);
    expect(formatBytes(1.5 * 1024 * 1024)).toMatch(/1\.5 MB/);
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toMatch(/1\.5 GB/);
  });

  it("returns an em-dash for non-finite input", () => {
    setLocale("en-US");
    expect(formatBytes(NaN)).toBe("—");
    expect(formatBytes(Infinity)).toBe("—");
  });
});

describe("format — dates", () => {
  beforeEach(() => __resetI18n());

  it("formatDate produces a non-empty short string", () => {
    setLocale("en-US");
    const out = formatDate(new Date(2026, 0, 15));
    expect(out.length).toBeGreaterThan(0);
    // en-US short date uses 2-digit year ("1/15/26") — match 26 or 2026.
    expect(out).toMatch(/26/);
  });

  it("formatDateTime includes both date and time components", () => {
    setLocale("en-US");
    const out = formatDateTime(new Date(2026, 5, 1, 14, 30));
    // Some Intl locales use 24h, some AM/PM — accept either.
    expect(out).toMatch(/26|2026/);
    expect(out).toMatch(/14|2|PM/);
  });

  it("returns em-dash for invalid dates", () => {
    setLocale("en-US");
    expect(formatDate("not a date")).toBe("—");
  });
});

describe("format — formatRelative", () => {
  beforeEach(() => __resetI18n());

  it("uses seconds for very recent deltas", () => {
    setLocale("en-US");
    const out = formatRelative(Date.now() - 5_000);
    expect(out).toMatch(/second/);
  });

  it("uses minutes for delta in minute range", () => {
    setLocale("en-US");
    const out = formatRelative(Date.now() - 5 * 60_000);
    expect(out).toMatch(/minute/);
  });

  it("uses days for delta in day range", () => {
    setLocale("en-US");
    const out = formatRelative(Date.now() - 3 * 24 * 3600 * 1000);
    expect(out).toMatch(/day/);
  });
});

describe("format — formatDuration (wall-clock style)", () => {
  beforeEach(() => __resetI18n());

  it("returns '0s' for zero", () => {
    setLocale("en-US");
    expect(formatDuration(0)).toBe("0s");
  });

  it("formats seconds under a minute", () => {
    setLocale("en-US");
    expect(formatDuration(45_000)).toBe("45s");
  });

  it("formats minutes + seconds", () => {
    setLocale("en-US");
    expect(formatDuration((5 * 60 + 12) * 1000)).toBe("5m 12s");
  });

  it("formats hours + minutes", () => {
    setLocale("en-US");
    expect(formatDuration((2 * 3600 + 15 * 60) * 1000)).toBe("2h 15m");
  });

  it("returns em-dash for negative / NaN input", () => {
    setLocale("en-US");
    expect(formatDuration(-100)).toBe("—");
    expect(formatDuration(NaN)).toBe("—");
  });
});

describe("format — formatList (Intl.ListFormat)", () => {
  beforeEach(() => __resetI18n());

  it("joins a few items with the locale's separator", () => {
    setLocale("en-US");
    const out = formatList(["a", "b", "c"]);
    expect(out).toMatch(/a.+b.+c/);
  });

  it("returns '' for an empty list", () => {
    setLocale("en-US");
    expect(formatList([])).toBe("");
  });
});