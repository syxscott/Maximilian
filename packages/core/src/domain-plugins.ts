import type { Plugin } from "./plugin-system.js";

export interface DomainToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface DomainToolCollection {
  domain: string;
  tools: DomainToolSpec[];
}

export function createGeologicalEngineeringPlugin(): Plugin {
  const collection: DomainToolCollection = {
    domain: "geological-engineering",
    tools: [
      {
        name: "classify_lithology",
        description: "Classify lithology from field notes, grain size, color, texture, and mineral observations.",
        inputSchema: {
          type: "object",
          properties: {
            fieldNotes: { type: "string" },
            grainSize: { type: "string" },
            color: { type: "string" },
            minerals: { type: "array", items: { type: "string" } },
          },
          required: ["fieldNotes"],
        },
      },
      {
        name: "slope_stability_screen",
        description: "Screen a slope for qualitative stability risk from angle, material, water, and discontinuity observations.",
        inputSchema: {
          type: "object",
          properties: {
            slopeAngleDeg: { type: "number" },
            material: { type: "string" },
            groundwater: { type: "string" },
            discontinuities: { type: "array", items: { type: "string" } },
          },
          required: ["slopeAngleDeg", "material"],
        },
      },
      {
        name: "borehole_log_summarizer",
        description: "Summarize borehole intervals into engineering units and flag weak layers or groundwater observations.",
        inputSchema: {
          type: "object",
          properties: {
            intervals: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  fromM: { type: "number" },
                  toM: { type: "number" },
                  description: { type: "string" },
                },
                required: ["fromM", "toM", "description"],
              },
            },
          },
          required: ["intervals"],
        },
      },
    ],
  };

  return {
    name: "domain:geological-engineering",
    hooks: {
      "plan-created": (ctx) => {
        const collections = Array.isArray(ctx.domainToolCollections)
          ? ctx.domainToolCollections as DomainToolCollection[]
          : [];
        collections.push(collection);
        ctx.domainToolCollections = collections;
      },
    },
  };
}
