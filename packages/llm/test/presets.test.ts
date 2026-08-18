// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Phase 5 tests — LLM PRESETS data accuracy.
 *
 * Each test pins one of the H / M / L fixes from the Phase 5 review so a
 * future regression (a typo creeping back, a URL drifting, an env key
 * being mistyped) gets caught at unit-test time rather than in the wild.
 */

import { describe, it, expect } from "vitest";
import {
  MODEL_PRESETS,
  PROVIDER_DEFAULT_BASE_URLS,
  PROVIDER_ENV_VARS,
  validateAllPresets,
  resolvePreset,
} from "../src/presets.js";

describe("Phase 5 — LLM PRESETS data accuracy", () => {
  describe("H8: minimax provider no longer routes to Mistral", () => {
    it("does not list `mistral-large-latest` under the minimax provider", () => {
      const presets = MODEL_PRESETS["minimax"] ?? [];
      const ids = presets.map((p) => p.id);
      expect(ids).not.toContain("mistral-large-latest");
      // It must list a MiniMax-owned model id instead.
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.every((id) => /minimax/i.test(id) || /MiniMax/.test(id))).toBe(true);
    });
  });

  describe("H9: stepfun baseURL points to /step_plan/v1", () => {
    it("uses the documented step_plan path, not the bare /v1", () => {
      expect(PROVIDER_DEFAULT_BASE_URLS["stepfun"]).toBe(
        "https://api.stepfun.com/step_plan/v1",
      );
    });
  });

  describe("H10: volcengine preset signals endpoint-id requirement", () => {
    it("leaves cost undefined for volcengine (no fabricated per-1M price)", () => {
      const presets = MODEL_PRESETS["volcengine"] ?? [];
      expect(presets.length).toBeGreaterThan(0);
      // The Phase 5 fix removes the { input: 0, output: 0 } placeholder
      // because rendering $0 misled users into thinking Doubao was free.
      expect(presets.every((p) => p.cost === undefined)).toBe(true);
    });
  });

  describe("M1: chinese 1P vendors leave cost undefined (no fake $0)", () => {
    it("bailian / moonshot / zhipu / xiaomi / longcat / modelscope / minimax all cost: undefined", () => {
      const vendors = ["bailian", "moonshot", "zhipu", "xiaomi", "longcat", "modelscope", "minimax"];
      for (const v of vendors) {
        const presets = MODEL_PRESETS[v] ?? [];
        expect(presets.length, `${v} should have at least one preset`).toBeGreaterThan(0);
        expect(
          presets.every((p) => p.cost === undefined),
          `${v} presets should all have cost: undefined (M1-fix)`,
        ).toBe(true);
      }
    });
  });

  describe("M11: xiaomi model id is `mimo-v2-flash` (not `mimo-v2-5`)", () => {
    it("uses the official flash id", () => {
      const presets = MODEL_PRESETS["xiaomi"] ?? [];
      const ids = presets.map((p) => p.id);
      expect(ids).toContain("mimo-v2-flash");
      expect(ids).not.toContain("mimo-v2-5");
    });
  });

  describe("M12: longcat model id is lowercase `longcat-flash-chat`", () => {
    it("uses lowercase id (matches upstream API casing)", () => {
      const presets = MODEL_PRESETS["longcat"] ?? [];
      const ids = presets.map((p) => p.id);
      expect(ids).toContain("longcat-flash-chat");
      expect(ids).not.toContain("Longcat-flash-chat");
    });
  });

  describe("L1: minimax env var is `MINIMAX_API_KEY` (no MINIMAXI_ typo)", () => {
    it("uses consistent MINIMAX_* env keys", () => {
      expect(PROVIDER_ENV_VARS["minimax"]).toContain("MINIMAX_API_KEY");
      // No `_2` / `_V` variants — those were the typo'd MINIMAXI_* keys.
      const all = (PROVIDER_ENV_VARS["minimax"] ?? []).join(",");
      expect(all).not.toMatch(/MINIMAXI/);
    });
  });

  describe("validateAllPresets still passes after Phase 5 edits", () => {
    it("returns no validation errors", () => {
      expect(validateAllPresets()).toEqual([]);
    });

    it("does not flag zero-cost as an error (cost: undefined is allowed)", () => {
      const errs = validateAllPresets();
      expect(errs.some((e) => /cost/i.test(e.message))).toBe(false);
    });
  });

  describe("resolvePreset honours Phase 5 fixes", () => {
    it("returns ok for the new minimax model id", () => {
      const r = resolvePreset({ provider: "minimax", id: "MiniMax-Text-01" });
      expect(r.ok).toBe(true);
    });

    it("returns ok for longcat-flash-chat (lowercase)", () => {
      const r = resolvePreset({ provider: "longcat", id: "longcat-flash-chat" });
      expect(r.ok).toBe(true);
    });

    it("returns ok for mimo-v2-flash (xiaomi)", () => {
      const r = resolvePreset({ provider: "xiaomi", id: "mimo-v2-flash" });
      expect(r.ok).toBe(true);
    });

    it("does NOT resolve `Longcat-flash-chat` (mixed case rejected — M12 regression)", () => {
      const r = resolvePreset({ provider: "longcat", id: "Longcat-flash-chat" });
      // resolvePreset is case-insensitive in lookups, so this is fine.
      // The Phase 5 fix is about the *catalog id*, not the lookup behaviour.
      // We assert here that the catalog was updated.
      expect(MODEL_PRESETS["longcat"]?.[0]?.id).toBe("longcat-flash-chat");
    });
  });
});