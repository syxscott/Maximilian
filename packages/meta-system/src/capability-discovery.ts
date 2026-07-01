/**
 * 6.1 — CapabilityDiscoveryEngine
 *
 * Scans:
 *   - user requests (text mining for keywords not in CAPABILITY_LIBRARY)
 *   - failure patterns (frequent failure themes)
 *   - review suggestions (recurring improvement suggestions)
 *   - capability gaps (workspace used a placeholder fallback)
 *
 * Output: CapabilityProposal persisted to <rootDir>/capability-proposals/<id>.json
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  CapabilityProposalSchema,
  type CapabilityProposal,
  type ProposalSource,
  DISCOVERY_CONFIG,
} from "./types.js";

export interface DiscoverySignal {
  text: string;
  context: string;
  source: ProposalSource;
}

export interface DiscoveryResult {
  proposals: CapabilityProposal[];
  skippedExisting: string[];
}

export class CapabilityDiscoveryEngine {
  private static readonly KNOWN_CAPABILITIES = new Set<string>([
    "frontend",
    "backend",
    "review",
    "general",
    "devops",
    "database",
    "research_analysis",
    "product_design",
    "security_review",
    "testing",
    "documentation",
    "data_engineering",
    "machine_learning",
  ]);

  // Keywords that map to known capabilities (so we don't propose them).
  private static readonly KNOWN_KEYWORDS: Record<string, string> = {
    "frontend": "frontend",
    "backend": "backend",
    "react": "frontend",
    "vue": "frontend",
    "html": "frontend",
    "css": "frontend",
    "node": "backend",
    "express": "backend",
    "api": "backend",
    "database": "database",
    "postgres": "database",
    "mysql": "database",
    "docker": "devops",
    "kubernetes": "devops",
    "devops": "devops",
    "arxiv": "research_analysis",
    "research": "research_analysis",
    "paper": "research_analysis",
    "analyze": "research_analysis",
    "ml": "machine_learning",
    "machine learning": "machine_learning",
    "security": "security_review",
    "test": "testing",
    "doc": "documentation",
  };

  // Patterns that suggest missing capabilities.
  private static readonly GAP_PATTERNS: Array<{ re: RegExp; capabilityId: string; displayName: string }> = [
    { re: /\b(mobile|ios|android|swift|kotlin|flutter)\b/i, capabilityId: "mobile_app_development", displayName: "Mobile App Development" },
    { re: /\b(blockchain|web3|solidity|smart contract)\b/i, capabilityId: "blockchain_development", displayName: "Blockchain Development" },
    { re: /\b(game|godot|unity|unreal)\b/i, capabilityId: "game_development", displayName: "Game Development" },
    { re: /\b(data science|pandas|numpy|jupyter)\b/i, capabilityId: "data_science", displayName: "Data Science" },
    { re: /\b(nlp|gpt|llm|transformer|embedding)\b/i, capabilityId: "llm_engineering", displayName: "LLM Engineering" },
    { re: /\b(graphql|grpc|websocket)\b/i, capabilityId: "api_engineering", displayName: "API Engineering" },
    { re: /\b(cicd|jenkins|github actions)\b/i, capabilityId: "ci_cd", displayName: "CI/CD" },
    { re: /\b(seo|marketing|landing page)\b/i, capabilityId: "marketing_engineering", displayName: "Marketing Engineering" },
    { re: /\b(design|figma|ux|wireframe)\b/i, capabilityId: "design_engineering", displayName: "Design Engineering" },
    // Phase 7 — added for closed-loop E2E scenario (data pipeline projects).
    { re: /\b(data pipeline|etl|elt|data warehouse|olap|data ingestion|airflow|spark)\b/i, capabilityId: "data_pipeline", displayName: "Data Pipeline" },
  ];

  constructor(private rootDir: string) {}

  private dir(): string {
    return path.join(this.rootDir, "capability-proposals");
  }

  async listProposals(): Promise<CapabilityProposal[]> {
    try {
      const entries = await fs.readdir(this.dir());
      const out: CapabilityProposal[] = [];
      for (const name of entries) {
        if (!name.endsWith(".json")) continue;
        const raw = await fs.readFile(path.join(this.dir(), name), "utf-8");
        out.push(CapabilityProposalSchema.parse(JSON.parse(raw)));
      }
      return out;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  async discover(
    signals: DiscoverySignal[],
    knownCapabilityIds: string[] = []
  ): Promise<DiscoveryResult> {
    const proposals: CapabilityProposal[] = [];
    const skipped: string[] = [];

    const known = new Set<string>([
      ...CapabilityDiscoveryEngine.KNOWN_CAPABILITIES,
      ...knownCapabilityIds,
    ]);

    // Group signals by inferred capability candidate.
    const candidateMap = new Map<
      string,
      { displayName: string; signals: DiscoverySignal[] }
    >();

    for (const signal of signals) {
      const lowered = signal.text.toLowerCase();

      // 1) Match against known keywords first; if hit, skip.
      let matchedKnown: string | null = null;
      for (const [kw, cap] of Object.entries(CapabilityDiscoveryEngine.KNOWN_KEYWORDS)) {
        if (lowered.includes(kw)) {
          matchedKnown = cap;
          break;
        }
      }
      if (matchedKnown && known.has(matchedKnown)) continue;

      // 2) Match against gap patterns.
      for (const pat of CapabilityDiscoveryEngine.GAP_PATTERNS) {
        if (pat.re.test(signal.text)) {
          if (known.has(pat.capabilityId)) {
            skipped.push(pat.capabilityId);
            continue;
          }
          const cur = candidateMap.get(pat.capabilityId) ?? {
            displayName: pat.displayName,
            signals: [],
          };
          cur.signals.push(signal);
          candidateMap.set(pat.capabilityId, cur);
          break;
        }
      }
    }

    // 3) Only emit proposals for capabilities with enough evidence.
    for (const [capabilityId, { displayName, signals }] of candidateMap) {
      if (signals.length < DISCOVERY_CONFIG.minFrequency) continue;
      const sources = new Set(signals.map((s) => s.source));
      const evidence = signals.slice(0, 5).map((s) => s.text);
      const proposal: CapabilityProposal = CapabilityProposalSchema.parse({
        id: `prop-${randomUUID().slice(0, 8)}`,
        capabilityId,
        displayName,
        rationale: this.composeRationale(capabilityId, sources),
        source: this.pickSource(sources),
        evidence,
        proposedAt: new Date().toISOString(),
      });
      await this.save(proposal);
      proposals.push(proposal);
    }

    return { proposals, skippedExisting: skipped };
  }

  private composeRationale(capabilityId: string, sources: Set<ProposalSource>): string {
    const srcList = Array.from(sources).join(", ");
    return `Discovered new capability '${capabilityId}' from signals: ${srcList}.`;
  }

  private pickSource(sources: Set<ProposalSource>): ProposalSource {
    if (sources.has("capability_gap")) return "capability_gap";
    if (sources.has("failure_pattern_mining")) return "failure_pattern_mining";
    if (sources.has("review_suggestion")) return "review_suggestion";
    return "user_request_analysis";
  }

  private async save(p: CapabilityProposal): Promise<void> {
    const validated = CapabilityProposalSchema.parse(p);
    await fs.mkdir(this.dir(), { recursive: true });
    await fs.writeFile(
      path.join(this.dir(), `${validated.id}.json`),
      JSON.stringify(validated, null, 2),
      "utf-8"
    );
  }
}
