// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach } from "vitest";
import {
  PersonaComposer,
  BUILT_IN_PERSONAS,
  HARD_RULES_FOOTER,
  type Persona,
} from "../src/persona-composer.js";

describe("Borrowed — PersonaComposer", () => {
  let composer: PersonaComposer;

  beforeEach(() => {
    composer = new PersonaComposer();
    for (const p of BUILT_IN_PERSONAS) composer.register(p);
  });

  it("registers all built-in personas", () => {
    expect(composer.list().length).toBe(BUILT_IN_PERSONAS.length);
    expect(composer.has("developer")).toBe(true);
    expect(composer.has("orchestrator")).toBe(true);
  });

  it("picks the right persona for each role", () => {
    expect(composer.forRole("frontend").id).toBe("developer");
    expect(composer.forRole("backend").id).toBe("developer");
    expect(composer.forRole("review").id).toBe("reviewer");
    expect(composer.forRole("general").id).toBe("operator");
  });

  it("composeMasterPrompt produces a structured composite", () => {
    const master = composer.composeMasterPrompt();
    // Includes each non-orchestrator persona header.
    for (const p of BUILT_IN_PERSONAS) {
      if (p.id === "orchestrator") continue;
      expect(master).toContain(`=== [${p.name}] ===`);
    }
    // Includes the ORCHESTRATOR prelude.
    expect(master).toContain("# ORCHESTRATOR");
    // Includes the hard-rules footer.
    expect(master).toContain(HARD_RULES_FOOTER);
    // Hard-rules forbid "reveal" of routing.
    expect(master).toMatch(/do NOT reveal/i);
  });

  it("composeForRole inlines persona + context + hard rules", () => {
    const out = composer.composeForRole("frontend", undefined, {
      sharedContext: "User is debugging a React hook.",
      priorFailures: ["Hooks called conditionally"],
    });
    expect(out).toContain("software developer"); // developer persona text
    expect(out).toContain("User is debugging a React hook.");
    expect(out).toContain("Hooks called conditionally");
    expect(out).toContain(HARD_RULES_FOOTER);
  });

  it("hard-rules footer forbids revealing internal routing", () => {
    expect(HARD_RULES_FOOTER).toMatch(/do NOT reveal/i);
    expect(HARD_RULES_FOOTER).toMatch(/unified/i);
  });

  it("custom persona can be registered and queried", () => {
    const custom: Persona = {
      id: "developer",
      name: "Senior Developer",
      description: "More careful variant of the developer persona.",
      systemPrompt: "Be extra cautious.",
    };
    composer.register(custom);
    const p = composer.forRole("frontend");
    expect(p.name).toBe("Senior Developer");
  });

  it("composes without orchestrator when option disabled", () => {
    const c2 = new PersonaComposer({ includeOrchestrator: false });
    for (const p of BUILT_IN_PERSONAS) c2.register(p);
    const master = c2.composeMasterPrompt();
    expect(master).not.toContain("# ORCHESTRATOR");
  });
});