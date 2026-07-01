/**
 * Performance tier controller — auto-detects device capability and lets the
 * user override it. The chosen tier drives:
 *   1. CSS class on `<html>` (`.perf-low` / `.perf-high`) for animation /
 *      shadow / blur toggles.
 *   2. Component-level decisions (skip virtualization on `high`, lazy-load
 *      all tabs on `low`).
 *
 * Detection (when mode is "auto"): combines `navigator.deviceMemory` and
 * `navigator.hardwareConcurrency` with a 16-frame RAF microbenchmark. Score
 * thresholds are tuned for desktop + laptop hardware — the goal is to keep
 * `high` on real workstations and `low` on phones / netbooks, never the
 * other way around.
 *
 * Storage key: `maximilian-perf-tier` (JSON `"auto" | "low" | "high"`).
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export type PerfTierMode = "auto" | "low" | "high";
export type PerfTier = "low" | "high"; // "auto" never reaches the DOM as a tier

export const PERF_TIER_STORAGE_KEY = "maximilian-perf-tier";

function isPerfTierMode(value: unknown): value is PerfTierMode {
  return value === "auto" || value === "low" || value === "high";
}

export function getStoredPerfTier(): PerfTierMode {
  if (typeof localStorage === "undefined") return "auto";
  const raw = localStorage.getItem(PERF_TIER_STORAGE_KEY);
  if (!raw) return "auto";
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPerfTierMode(parsed) ? parsed : "auto";
  } catch {
    return "auto";
  }
}

export function setStoredPerfTier(mode: PerfTierMode): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(PERF_TIER_STORAGE_KEY, JSON.stringify(mode));
}

/**
 * Microbenchmark: run 16 RAF frames, time the gaps between them, take the
 * median. ~50ms work total. Devices that can sustain ≤16ms frames (60fps)
 * count as fast.
 *
 * Returns the median frame time in ms; lower = faster.
 */
async function measureFrameTime(signal?: AbortSignal): Promise<number> {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
    return 16;
  }
  return new Promise<number>((resolve) => {
    const samples: number[] = [];
    let last = performance.now();
    let frames = 0;
    const MAX = 16;
    const tick = (now: number) => {
      samples.push(now - last);
      last = now;
      frames += 1;
      if (frames >= MAX || (signal && signal.aborted)) {
        const sorted = [...samples].sort((a, b) => a - b);
        resolve(sorted[Math.floor(sorted.length / 2)] ?? 16);
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * Heuristic score → tier. Tuned for desktop / laptop / phones.
 * We deliberately bias toward `low` on unknown devices (no `deviceMemory`)
 * because under-detection is preferable to jank.
 */
export async function detectTier(signal?: AbortSignal): Promise<PerfTier> {
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const hardwareConcurrency = navigator.hardwareConcurrency ?? 4;

  let score = 0;
  if (typeof deviceMemory === "number") score += Math.min(deviceMemory, 16);
  if (typeof hardwareConcurrency === "number") score += Math.min(hardwareConcurrency, 16);

  // Frame time: ≥ 22ms median → low. < 18ms → adds 8 to score.
  const frameMs = await measureFrameTime(signal);
  if (frameMs < 18) score += 8;
  else if (frameMs > 26) score -= 4;

  // Threshold: ≥ 18 → high, else low.
  return score >= 18 ? "high" : "low";
}

function applyPerfTierClass(tier: PerfTier): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("perf-low", "perf-high");
  root.classList.add(`perf-${tier}`);
}

export interface PerfController {
  mode: PerfTierMode;
  effective: PerfTier;
  setMode: (mode: PerfTierMode) => void;
}

export function usePerfTier(): PerfController {
  const mode = useSyncExternalStore(
    (handler) => {
      if (typeof window === "undefined") return () => {};
      const onStorage = (e: StorageEvent) => {
        if (e.key === PERF_TIER_STORAGE_KEY) handler();
      };
      window.addEventListener("storage", onStorage);
      return () => window.removeEventListener("storage", onStorage);
    },
    () => getStoredPerfTier(),
    () => "auto" as PerfTierMode,
  );

  const [effective, setEffective] = useState<PerfTier>("low");
  const [detected, setDetected] = useState<PerfTier | null>(null);

  // Run detection exactly once on mount (or when switching back to auto).
  useEffect(() => {
    if (mode !== "auto") {
      setEffective(mode);
      applyPerfTierClass(mode);
      return;
    }
    if (detected !== null) {
      setEffective(detected);
      applyPerfTierClass(detected);
      return;
    }
    const ctrl = new AbortController();
    detectTier(ctrl.signal)
      .then((t) => {
        if (!ctrl.signal.aborted) {
          setDetected(t);
          setEffective(t);
          applyPerfTierClass(t);
        }
      })
      .catch(() => {
        setDetected("low");
        setEffective("low");
        applyPerfTierClass("low");
      });
    return () => ctrl.abort();
  }, [mode, detected]);

  const setMode = useCallback((next: PerfTierMode) => {
    setStoredPerfTier(next);
    if (next !== "auto") {
      // Clear the cached detection so re-entering "auto" re-runs the bench.
      setDetected(null);
    }
    window.dispatchEvent(new StorageEvent("storage", { key: PERF_TIER_STORAGE_KEY }));
  }, []);

  return { mode, effective, setMode };
}