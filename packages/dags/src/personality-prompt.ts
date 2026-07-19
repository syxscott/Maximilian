/**
 * Personality-to-prompt injection (borrowed from agentos research).
 *
 * agentos models agent personality as a structured config (HEXACO + PAD +
 * tone + language + custom directives) rather than raw prompt text. This
 * module converts a `Personality` object into a concise system-prompt
 * fragment that:
 *   1. Maps each trait軸 to a short behavioural directive
 *   2. Appends PAD affect as "current mood" framing
 *   3. Applies tone + language + custom overlays verbatim
 *
 * The fragment is APPENDED to the agent's base `systemPrompt` by the
 * runtime — the base prompt stays untouched and the personality layer is
 * clearly delimited under a `## Personality` heading.
 *
 * Usage:
 *   const prefix = personalityToPrompt(blueprint.personality);
 *   const full = prefix ? `${blueprint.systemPrompt}\n\n${prefix}` : blueprint.systemPrompt;
 */

import type { Personality } from "./types.js";

const TRAIT_DIRECTIVES: Array<{
  key: keyof Personality;
  high: string;
  low: string;
  // Map numeric 0..1 to discrete levels. Default: >0.66 = high, <0.33 = low.
  threshold?: number;
}> = [
  { key: "honestyHumility", high: "Be honest and humble in your analysis; admit uncertainty openly.", low: "Be confident in your assertions." },
  { key: "emotionality", high: "Show empathy and emotional awareness in responses.", low: "Stay factual and stoic." },
  { key: "extraversion", high: "Be proactive and energetic in suggesting improvements.", low: "Be reserved and reactive; only respond when asked." },
  { key: "agreeableness", high: "Be accommodating; prioritize team consensus.", low: "Be direct and critical; point out flaws early." },
  { key: "conscientiousness", high: "Be meticulous; double-check every detail before declaring done.", low: "Prioritize speed over polish when appropriate." },
  { key: "openness", high: "Explore novel frameworks and unconventional approaches.", low: "Stick to proven patterns and conventional wisdom." },
];

/**
 * Build a system-prompt fragment from a Personality config.
 * Returns an empty string when the personality is empty/unset.
 */
export function personalityToPrompt(p: Personality): string {
  const parts: string[] = [];

  // 1. HEXACO trait directives
  for (const { key, high, low } of TRAIT_DIRECTIVES) {
    const v = p[key];
    if (typeof v !== "number") continue;
    const directive = v > 0.66 ? high : v < 0.33 ? low : "";
    if (directive) parts.push(directive);
  }
  // 2. PAD affect
  const pad: string[] = [];
  if (typeof p.pleasure === "number") pad.push(p.pleasure > 0.5 ? "positively disposed" : "guarded");
  if (typeof p.arousal === "number") pad.push(p.arousal > 0.5 ? "energetic" : "measured");
  if (typeof p.dominance === "number") pad.push(p.dominance > 0.5 ? "authoritative" : "deferential");
  if (pad.length > 0) parts.push(`Current affect: ${pad.join(", ")}.`);
  // 3. Tone
  if (p.tone && p.tone !== "neutral") parts.push(`Tone: ${p.tone}.`);
  // 4. Language
  if (p.language) parts.push(`Respond in language/dialect: ${p.language}.`);
  // 5. Custom directives
  for (const d of p.customDirectives) parts.push(d);

  if (parts.length === 0) return "";
  return `## Personality\n${parts.join("\n")}`;
}

/**
 * Apply personality to a base system prompt. Returns the combined prompt.
 */
export function applyPersonality(baseSystemPrompt: string, personality: Personality): string {
  const fragment = personalityToPrompt(personality);
  return fragment ? `${baseSystemPrompt}\n\n${fragment}` : baseSystemPrompt;
}