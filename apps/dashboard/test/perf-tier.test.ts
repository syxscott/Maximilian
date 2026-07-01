/**
 * Tests for the performance tier controller — storage helpers and the
 * heuristic detector. We don't run the RAF microbenchmark in jsdom (it
 * doesn't tick rAF), so we test `detectTier()` by mocking the inputs.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  detectTier,
  getStoredPerfTier,
  setStoredPerfTier,
  PERF_TIER_STORAGE_KEY,
  type PerfTier,
} from "../src/lib/perf-tier";

describe("perf-tier storage helpers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to 'auto' when nothing is stored", () => {
    expect(getStoredPerfTier()).toBe("auto");
  });

  it("round-trips valid modes", () => {
    for (const mode of ["auto", "low", "high"] as const) {
      setStoredPerfTier(mode);
      expect(getStoredPerfTier()).toBe(mode);
    }
  });

  it("falls back to 'auto' on garbage values", () => {
    localStorage.setItem(PERF_TIER_STORAGE_KEY, JSON.stringify("ultra"));
    expect(getStoredPerfTier()).toBe("auto");
    localStorage.setItem(PERF_TIER_STORAGE_KEY, "not-json");
    expect(getStoredPerfTier()).toBe("auto");
  });
});

describe("detectTier", () => {
  it("returns 'high' for desktop-class hardware (16GB + 8 cores + smooth RAF)", async () => {
    Object.defineProperty(navigator, "deviceMemory", { configurable: true, value: 16 });
    Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, value: 8 });

    let rafCount = 0;
    const origRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafCount += 1;
      // 15 fast frames at 16ms apart → median < 18ms → +8 score
      cb(performance.now() + rafCount * 16);
      return rafCount;
    }) as typeof window.requestAnimationFrame;

    const tier: PerfTier = await detectTier();
    expect(tier).toBe("high");

    window.requestAnimationFrame = origRaf;
  });

  it("returns 'low' for low-spec hardware (no deviceMemory + 2 cores)", async () => {
    Object.defineProperty(navigator, "deviceMemory", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, value: 2 });

    let rafCount = 0;
    const origRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafCount += 1;
      // Slow frames: 30ms apart → median > 26ms → -4 score
      cb(performance.now() + rafCount * 30);
      return rafCount;
    }) as typeof window.requestAnimationFrame;

    const tier = await detectTier();
    expect(tier).toBe("low");

    window.requestAnimationFrame = origRaf;
  });

  it("aborts cleanly when the signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const tier = await detectTier(ctrl.signal);
    expect(["low", "high"]).toContain(tier);
  });
});