/**
 * Built-in capability library.
 *
 * Initial set covers common software/research tasks. To add a new capability:
 *   1. Append a Capability entry to CAPABILITY_LIBRARY below, OR
 *   2. Call CapabilityLibrary.register(capability) at startup.
 *
 * Capabilities are pure data — no behavior, no side effects.
 */

import type { Capability } from "./types.js";

export const CAPABILITY_LIBRARY: Capability[] = [
  {
    id: "product_design",
    displayName: "Product Design",
    description: "Define requirements, user stories, and product scope.",
    category: "product",
    keywords: ["产品", "PRD", "需求", "requirement", "product", "user story", "scope"],
    defaultGoal: "Define a clear product specification and user-facing scope.",
    promptTemplate: `You are a Product Designer. Analyze the user request and produce:
1. A concise product scope (what's in / what's out)
2. 3-5 user stories
3. Non-functional requirements
4. Acceptance criteria

User request: {{userRequest}}`,
    defaultTools: [],
    defaultConstraints: { outputFormat: "markdown" },
    dependsOn: [],
    tags: ["product", "spec"],
  },
  {
    id: "frontend",
    displayName: "Frontend",
    description: "Generate client-side code (HTML / CSS / JS / TS / React).",
    category: "frontend",
    keywords: [
      "前端", "网页", "UI", "HTML", "CSS", "JS", "JavaScript", "React", "Vue", "Angular",
      "frontend", "web app", "界面", "客户端", "browser",
    ],
    defaultGoal: "Generate working client-side code that satisfies the product scope.",
    promptTemplate: `You are a Frontend Engineer. Build the user-facing part of: {{userRequest}}.

Rules:
1. Output only code, in fenced code blocks with language tags.
2. Prefer single-file deliverables when reasonable.
3. If a backend API exists in prior context, consume its contract exactly.
4. No external CDNs unless explicitly required.`,
    defaultTools: [],
    defaultConstraints: { outputFormat: "code", mustIncludeCodeBlocks: true, maxTokens: 4096, temperature: 0.4 },
    dependsOn: ["product_design", "backend"],
    tags: ["frontend", "ui"],
  },
  {
    id: "backend",
    displayName: "Backend",
    description: "Generate server-side code (Node.js / Python / Go / Java).",
    category: "backend",
    keywords: [
      "后端", "API", "服务端", "Node.js", "Express", "Python", "Flask", "Django", "Go", "Java",
      "backend", "server", "service", "REST", "GraphQL",
    ],
    defaultGoal: "Generate a working server-side service with a clear API contract.",
    promptTemplate: `You are a Backend Engineer. Implement the server for: {{userRequest}}.

Rules:
1. Expose REST endpoints with a clear JSON contract.
2. Include request/response examples in the output.
3. If a database layer exists, integrate with it.
4. Handle errors explicitly.`,
    defaultTools: [],
    defaultConstraints: { outputFormat: "code", mustIncludeCodeBlocks: true, maxTokens: 4096, temperature: 0.3 },
    dependsOn: ["product_design"],
    tags: ["backend", "api"],
  },
  {
    id: "database",
    displayName: "Database",
    description: "Design schemas, write migrations, optimize queries.",
    category: "data",
    keywords: [
      "数据库", "DB", "SQL", "PostgreSQL", "MySQL", "MongoDB", "Redis", "schema",
      "database", "storage", "表", "数据模型", "migration",
    ],
    defaultGoal: "Design and implement the data layer for the system.",
    promptTemplate: `You are a Database Engineer. Design the data layer for: {{userRequest}}.

Output:
1. Schema definition (tables / fields / types)
2. Migration scripts
3. Sample queries
4. Index recommendations`,
    defaultTools: [],
    defaultConstraints: { outputFormat: "code", mustIncludeCodeBlocks: true, maxTokens: 3000 },
    dependsOn: ["product_design"],
    tags: ["data", "db"],
  },
  {
    id: "devops",
    displayName: "DevOps",
    description: "Deployment, CI/CD, containerization, infrastructure.",
    category: "devops",
    keywords: [
      "部署", "CI", "CD", "Docker", "K8s", "Kubernetes", "AWS", "GCP", "Azure",
      "deploy", "pipeline", "infrastructure", "运维", "容器",
    ],
    defaultGoal: "Produce deployment artifacts (Dockerfile, CI config, infra scripts).",
    promptTemplate: `You are a DevOps Engineer. Provide deployment artifacts for: {{userRequest}}.

Output:
1. Dockerfile
2. CI/CD pipeline config (GitHub Actions YAML or equivalent)
3. Environment variable documentation
4. Run / start instructions`,
    defaultTools: [],
    defaultConstraints: { outputFormat: "code", mustIncludeCodeBlocks: true },
    dependsOn: ["backend"],
    tags: ["devops", "deploy"],
  },
  {
    id: "testing",
    displayName: "Testing",
    description: "Write and run unit / integration / e2e tests.",
    category: "testing",
    keywords: [
      "测试", "QA", "单元测试", "集成测试", "E2E",
      "test", "testing", "QA", "unit test", "integration test", "jest", "pytest",
    ],
    defaultGoal: "Write a comprehensive test suite for the implemented system.",
    promptTemplate: `You are a QA Engineer. Produce a test suite for: {{userRequest}}.

Output:
1. Unit tests for core logic
2. Integration tests for API contracts
3. E2E test scenarios
4. Coverage report expectations`,
    defaultTools: [],
    defaultConstraints: { outputFormat: "code", mustIncludeCodeBlocks: true, maxTokens: 3000 },
    dependsOn: ["backend", "frontend"],
    tags: ["test", "qa"],
  },
  {
    id: "research_analysis",
    displayName: "Research Analysis",
    description: "Analyze academic papers / research output / literature.",
    category: "research",
    keywords: [
      "论文", "研究", "文献", "paper", "research", "literature", "analysis", "arxiv",
      "scholar", "academic", "summarize", "综述",
    ],
    defaultGoal: "Analyze research material and produce a structured summary.",
    promptTemplate: `You are a Research Analyst. Analyze: {{userRequest}}.

Output:
1. Key findings
2. Methodology
3. Strengths and limitations
4. Open questions
5. Related work`,
    defaultTools: [],
    defaultConstraints: { outputFormat: "markdown", maxTokens: 3000 },
    dependsOn: [],
    tags: ["research"],
  },
  {
    id: "data_visualization",
    displayName: "Data Visualization",
    description: "Build dashboards, charts, and visual reports.",
    category: "data",
    keywords: [
      "图表", "可视化", "dashboard", "chart", "graph", "visualization", "matplotlib", "d3",
      "plotly", "仪表盘",
    ],
    defaultGoal: "Produce visual artifacts that communicate the data clearly.",
    promptTemplate: `You are a Data Visualization Engineer. Create visual output for: {{userRequest}}.

Output:
1. Chart definitions
2. Sample data bindings
3. Layout / dashboard structure
4. Color and accessibility considerations`,
    defaultTools: [],
    defaultConstraints: { outputFormat: "code", mustIncludeCodeBlocks: true },
    dependsOn: ["data"],
    tags: ["viz"],
  },
  {
    id: "writing",
    displayName: "Technical Writing",
    description: "Produce documentation, READMEs, API references.",
    category: "writing",
    keywords: ["文档", "README", "API doc", "documentation", "doc", "manual", "guide", "manual"],
    defaultGoal: "Write clear, complete technical documentation.",
    promptTemplate: `You are a Technical Writer. Produce documentation for: {{userRequest}}.

Output:
1. Overview
2. Quick start
3. API reference (if applicable)
4. Examples
5. FAQ`,
    defaultTools: [],
    defaultConstraints: { outputFormat: "markdown" },
    dependsOn: ["backend", "frontend"],
    tags: ["doc"],
  },
  {
    id: "review",
    displayName: "Review",
    description: "Review artifacts and produce a structured verdict.",
    category: "review",
    keywords: ["评审", "review", "code review", "审核", "检查"],
    defaultGoal: "Critique generated artifacts and produce a structured review.",
    promptTemplate: `You are a Reviewer. Review the artifacts produced for: {{userRequest}}.

Output (JSON only):
{
  "score": <0-10>,
  "issues": [...],
  "suggestions": [...],
  "summary": "..."
}`,
    defaultTools: [],
    defaultConstraints: { outputFormat: "json", maxTokens: 1500, temperature: 0.2 },
    dependsOn: [],
    tags: ["review"],
  },
  {
    id: "general",
    displayName: "General",
    description: "Catch-all for unspecified work.",
    category: "general",
    keywords: [],
    defaultGoal: "Handle the request using general best practices.",
    promptTemplate: `You are a general-purpose engineer. Address: {{userRequest}}.`,
    defaultTools: [],
    defaultConstraints: { outputFormat: "free" },
    dependsOn: [],
    tags: ["fallback"],
  },
];

export class CapabilityLibrary {
  private byId = new Map<string, Capability>();
  private keywords: Array<{ keyword: string; capabilityId: string }> = [];
  /** IDs registered via replaceDynamic() — these are the ones we replace on next call. */
  private dynamicIds = new Set<string>();

  constructor(entries: Capability[] = CAPABILITY_LIBRARY) {
    for (const e of entries) this.register(e);
  }

  register(c: Capability): void {
    this.byId.set(c.id, c);
    for (const k of c.keywords) {
      this.keywords.push({ keyword: k.toLowerCase(), capabilityId: c.id });
    }
  }

  /**
   * Phase 7 — replace all capabilities previously installed via this method
   * with the supplied set. Static (constructor) entries are preserved.
   * Used by DAGS to inject CapabilityRegistry-derived active capabilities
   * on every compose() call without restart.
   */
  replaceDynamic(caps: Capability[]): void {
    // Remove previously-installed dynamic entries.
    for (const id of this.dynamicIds) {
      this.byId.delete(id);
    }
    this.keywords = this.keywords.filter(
      (k) => !this.dynamicIds.has(k.capabilityId)
    );
    this.dynamicIds.clear();

    // Install new dynamic entries.
    for (const c of caps) {
      this.register(c);
      this.dynamicIds.add(c.id);
    }
  }

  get(id: string): Capability | undefined {
    return this.byId.get(id);
  }

  list(): Capability[] {
    return Array.from(this.byId.values());
  }

  /** IDs currently registered as dynamic (registry-injected). */
  listDynamic(): string[] {
    return Array.from(this.dynamicIds);
  }

  /**
   * Naive keyword-based detection. Returns capability IDs sorted by
   * match count (desc). Always includes "general" as a baseline.
   */
  detectByKeywords(text: string): string[] {
    const lower = text.toLowerCase();
    const counts = new Map<string, number>();
    for (const { keyword, capabilityId } of this.keywords) {
      if (lower.includes(keyword)) {
        counts.set(capabilityId, (counts.get(capabilityId) ?? 0) + 1);
      }
    }
    const sorted = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
    if (!sorted.includes("general")) sorted.push("general");
    return sorted;
  }
}
