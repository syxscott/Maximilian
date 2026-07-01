/**
 * Locale-aware number / date / relative-time formatters.
 *
 * All formatters use the active i18n locale by default, so the displayed
 * digits, separators, and date format follow whatever the user picked.
 * Pass an explicit `locale` to override (e.g. for a fixed display in
 * dashboards where you always want en-US).
 *
 *   formatNumber(1234.5)               → "1,234.5"  (en-US)
 *   formatNumber(1234.5)               → "1.234,5"  (de-DE)
 *   formatPercent(0.123)                → "12%"
 *   formatBytes(1536)                  → "1.5 KB"
 *   formatTokens(1234)                 → "1.2K"      (compact, big-number friendly)
 *   formatDate(new Date())             → "6/29/2026" (en-US)
 *   formatRelative(Date.now() - 60_000)// → "1 minute ago"
 */
import { getLocale } from "./index.js";

/** BCP-47 tag used by every formatter by default. */
function locale(): string {
  return getLocale();
}

/** Round to N decimal places, returning a number (for chains). */
function round(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

/** Format a plain number with locale-aware separators. */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale(), options).format(value);
}

/** Format a fraction (0–1) as a percentage. 0.123 → "12%". */
export function formatPercent(value: number, decimals = 0): string {
  return new Intl.NumberFormat(locale(), {
    style: "percent",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** Compact big-number formatting: 1234 → "1.2K", 1_500_000 → "1.5M".
 *  Used for token counts, view counts, anything where 6+ digits don't help. */
export function formatCompact(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale(), {
    notation: "compact",
    maximumFractionDigits: 1,
    ...options,
  }).format(value);
}

/**
 * Token-aware shorthand. 1234 → "1.2K", 1234567 → "1.2M".
 * Same as formatCompact but tuned for token-like numbers (always 1 decimal).
 */
export function formatTokens(value: number): string {
  return formatCompact(value, { maximumFractionDigits: 1 });
}

/** Format bytes as KiB/MiB/GiB. 1536 → "1.5 KB". */
export function formatBytes(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs < 1024) return `${formatNumber(value, { maximumFractionDigits: 0 })} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let v = value / 1024;
  let i = 0;
  while (Math.abs(v) >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${formatNumber(round(v, decimals))} ${units[i]}`;
}

/** Format a date with locale-default short form. */
export function formatDate(value: Date | number | string, options?: Intl.DateTimeFormatOptions): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale(), options ?? { dateStyle: "short" }).format(d);
}

/** Format a date + time. */
export function formatDateTime(value: Date | number | string): string {
  return formatDate(value, { dateStyle: "short", timeStyle: "short" });
}

/** Locale-aware relative time. Returns strings like "1 minute ago" / "in 2 days".
 *  Uses Intl.RelativeTimeFormat under the hood. */
export function formatRelative(target: Date | number | string, now: Date | number = Date.now()): string {
  const t = target instanceof Date ? target : new Date(target);
  const n = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(t.getTime()) || Number.isNaN(n.getTime())) return "—";
  const diffMs = t.getTime() - n.getTime();
  const absMs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });

  const units: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
    { unit: "year", ms: 365 * 24 * 3600 * 1000 },
    { unit: "month", ms: 30 * 24 * 3600 * 1000 },
    { unit: "week", ms: 7 * 24 * 3600 * 1000 },
    { unit: "day", ms: 24 * 3600 * 1000 },
    { unit: "hour", ms: 3600 * 1000 },
    { unit: "minute", ms: 60 * 1000 },
    { unit: "second", ms: 1000 },
  ];
  for (const { unit, ms } of units) {
    if (absMs >= ms) {
      const value = Math.round(diffMs / ms);
      return rtf.format(value, unit);
    }
  }
  return rtf.format(0, "second");
}

/** Format a duration in milliseconds as "1h 23m" / "45s". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const absMs = Math.abs(ms);
  const sec = Math.round(absMs / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return remSec > 0 ? `${min}m ${remSec}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
}

/** Locale-aware list join. ["a", "b", "c"] → "a, b, c" (en) / "a、b、c" (zh). */
export function formatList(items: string[], options?: Intl.ListFormatOptions): string {
  if (items.length === 0) return "";
  return new Intl.ListFormat(locale(), options ?? { style: "long", type: "conjunction" }).format(items);
}