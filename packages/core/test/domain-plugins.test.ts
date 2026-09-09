import { describe, expect, it } from "vitest";
import { createGeologicalEngineeringPlugin, PluginManager, type DomainToolCollection } from "../src/index.js";

describe("geological engineering domain plugin", () => {
  it("registers a domain tool collection through the existing PluginManager", async () => {
    const pm = new PluginManager();
    await pm.register(createGeologicalEngineeringPlugin());

    const ctx: { domainToolCollections?: DomainToolCollection[] } = {};
    await pm.dispatch("plan-created", ctx);

    expect(pm.has("domain:geological-engineering")).toBe(true);
    expect(ctx.domainToolCollections).toHaveLength(1);
    expect(ctx.domainToolCollections?.[0]?.domain).toBe("geological-engineering");
    expect(ctx.domainToolCollections?.[0]?.tools.map((tool) => tool.name)).toEqual([
      "classify_lithology",
      "slope_stability_screen",
      "borehole_log_summarizer",
    ]);
  });
});
