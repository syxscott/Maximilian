// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { personalityToPrompt, applyPersonality, PersonalitySchema } from "../src/index.js";
import type { Personality } from "../src/index.js";

/** Empty-but-zod-defaulted personality (for callers that pass `{}`). */
const empty: Personality = PersonalitySchema.parse({});

describe("Borrowed — personality-to-prompt (agentos pattern)", () => {
  it("returns empty string for empty personality", () => {
    expect(personalityToPrompt(empty)).toBe("");
    expect(applyPersonality("Base prompt.", empty)).toBe("Base prompt.");
  });

  it("maps high-extraversion to proactive directive", () => {
    const p: Personality = { ...empty, extraversion: 0.9 };
    expect(personalityToPrompt(p)).toContain("proactive");
  });

  it("maps low-extraversion to reserved directive", () => {
    const p: Personality = { ...empty, extraversion: 0.1 };
    expect(personalityToPrompt(p)).toContain("reserved");
  });

  it("omits neutral values (0.33..0.66)", () => {
    const p: Personality = { ...empty, extraversion: 0.5 };
    expect(personalityToPrompt(p)).toBe("");
  });

  it("emits PAD affect summary", () => {
    const p: Personality = { ...empty, pleasure: 0.8, arousal: 0.7, dominance: 0.3 };
    const out = personalityToPrompt(p);
    expect(out).toContain("positively disposed");
    expect(out).toContain("energetic");
    expect(out).toContain("deferential");
  });

  it("includes tone + language", () => {
    const p: Personality = { ...empty, tone: "playful", language: "zh-CN" };
    const out = personalityToPrompt(p);
    expect(out).toContain("playful");
    expect(out).toContain("zh-CN");
  });

  it("appends custom directives", () => {
    const p: Personality = { ...empty, customDirectives: ["Always output valid JSON.", "Never use emojis."] };
    const out = personalityToPrompt(p);
    expect(out).toContain("Always output valid JSON.");
    expect(out).toContain("Never use emojis.");
  });

  it("applyPersonality combines base + fragment", () => {
    const p: Personality = { ...empty, extraversion: 0.9, tone: "formal" };
    const out = applyPersonality("Base prompt.", p);
    expect(out.startsWith("Base prompt.")).toBe(true);
    expect(out).toContain("## Personality");
    expect(out).toContain("proactive");
    expect(out).toContain("formal");
  });

  it("handles all traits at once", () => {
    const p: Personality = {
      ...empty,
      honestyHumility: 0.9,
      emotionality: 0.8,
      extraversion: 0.1,
      agreeableness: 0.2,
      conscientiousness: 0.95,
      openness: 0.3,
      pleasure: 0.6,
      arousal: 0.4,
      dominance: 0.7,
      tone: "stern",
      language: "en",
      customDirectives: ["Test directive"],
    };
    const out = personalityToPrompt(p);
    expect(out).toContain("honest");
    expect(out).toContain("empathy");
    expect(out).toContain("reserved");
  });
});