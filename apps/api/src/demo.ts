/**
 * E2E Demo: "开发一个简单的 Todo Web App"
 *
 * Exercises the full chain without the UI:
 *   Commander → Backend Agent → Frontend Agent → Review Agent
 *
 * Usage:
 *   pnpm --filter @max/api demo
 */

import "dotenv/config";
import { getRegistry, type Provider } from "@max/providers";
import { Commander } from "@max/commander";
import { AgentRuntime } from "@max/core";
import { FileWorkspaceStore } from "@max/workspace";
import { defaultAgentFactory } from "@max/agents";

const USER_REQUEST =
  process.argv[2] ?? "开发一个简单的 Todo Web App（支持增删改查，使用 Node.js + Express 后端和纯 HTML/CSS/JS 前端）";

async function main() {
  const registry = getRegistry();
  const provider: Provider | undefined = registry.default();
  if (!provider) {
    console.error("No LLM provider configured. Set API keys in .env");
    process.exit(1);
  }
  console.log(`[demo] using provider: ${provider.id} (${provider.defaultModel})`);

  const workspaceDir = process.env.WORKSPACE_DIR ?? "./workspaces";
  const store = new FileWorkspaceStore(workspaceDir);

  const factory = defaultAgentFactory(() => provider);
  const commander = new Commander(() => provider);

  const runtime = new AgentRuntime(factory, store);
  runtime.on((event) => {
    switch (event.type) {
      case "plan":
        console.log(`\n[plan] workspaceId=${event.workspaceId}, tasks=${event.plan.tasks.length}`);
        for (const t of event.plan.tasks) {
          console.log(`  - [${t.agentRole}] ${t.description.slice(0, 80)}${t.description.length > 80 ? "..." : ""}`);
        }
        break;
      case "task-start":
        console.log(`\n[task-start] ${event.taskId} (${event.agentRole})`);
        break;
      case "task-complete":
        console.log(`[task-complete] ${event.taskId} → ${event.result.output.length} chars`);
        break;
      case "task-failed":
        console.error(`[task-failed] ${event.taskId}: ${event.error}`);
        break;
      case "workspace-status":
        console.log(`[status] ${event.workspaceId} → ${event.status}`);
        break;
      case "done":
        console.log(`\n[done] workspaceId=${event.workspaceId}, status=${event.workspace.status}`);
        break;
    }
  });

  console.log(`\n[user-request] ${USER_REQUEST}\n`);

  const { workspace, plan } = await commander.plan(USER_REQUEST);
  await store.saveWorkspace(workspace);

  const final = await runtime.execute(workspace);

  // Attach review as structured field.
  const reviewResult = final.results.find((r) => r.agentRole === "review");
  const review = reviewResult?.metadata?.review as
    | import("@max/core").ReviewResult
    | undefined;
  if (review) {
    final.review = review;
    await store.saveWorkspace(final);
  }

  // Save artifacts.
  for (const result of final.results) {
    if (result.agentRole === "review") continue;
    const blocks = extractCodeBlocks(result.output);
    if (blocks.length === 0) {
      await store.saveArtifact(
        final.id,
        `${result.agentRole}-${result.id.slice(0, 6)}.txt`,
        result.output
      );
    } else {
      for (const b of blocks) {
        const ext = langToExt(b.lang);
        await store.saveArtifact(
          final.id,
          `${result.agentRole}-${b.lang ?? "code"}-${result.id.slice(0, 6)}${ext}`,
          b.code
        );
      }
    }
  }

  console.log(`\n[result] workspace=${final.id}, status=${final.status}`);
  console.log(`[result] artifacts saved to ${workspaceDir}/${final.id}/files/`);
  if (final.review) {
    console.log(`[result] review score: ${final.review.score}/10`);
    console.log(`[result] issues: ${final.review.issues.length}`);
    console.log(`[result] suggestions: ${final.review.suggestions.length}`);
  }
}

function extractCodeBlocks(text: string): { lang: string | null; code: string }[] {
  const blocks: { lang: string | null; code: string }[] = [];
  const re = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    blocks.push({ lang: m[1] || null, code: m[2] });
  }
  return blocks;
}

function langToExt(lang: string | null): string {
  const map: Record<string, string> = {
    html: ".html", css: ".css", js: ".js", javascript: ".js",
    ts: ".ts", typescript: ".ts", json: ".json", py: ".py", python: ".py",
    md: ".md", markdown: ".md", sh: ".sh", bash: ".sh",
  };
  return map[lang ?? ""] ?? ".txt";
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});