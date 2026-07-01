import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentPanel } from "../src/components/AgentPanel";
import type { Workspace } from "../src/api";

const baseWorkspace: Workspace = {
  id: "ws-1",
  userRequest: "test",
  status: "running",
  plan: null,
  results: [],
  review: null,
  error: null,
  createdAt: "2026-06-25T10:00:00Z",
};

describe("AgentPanel", () => {
  it("shows 'No active agents' when no workspace", () => {
    render(<AgentPanel workspace={null} events={[]} />);
    expect(screen.getByText(/no agents yet/i)).toBeInTheDocument();
  });

  it("shows 'No active agents' when workspace has no plan", () => {
    render(<AgentPanel workspace={baseWorkspace} events={[]} />);
    expect(screen.getByText(/no agents yet/i)).toBeInTheDocument();
  });

  it("renders agent roles from plan tasks", () => {
    const ws: Workspace = {
      ...baseWorkspace,
      plan: {
        rationale: "test",
        tasks: [
          { id: "t1", description: "Build UI", agentRole: "frontend", dependsOn: [], status: "running" },
          { id: "t2", description: "Build API", agentRole: "backend", dependsOn: [], status: "pending" },
        ],
      },
    };
    render(<AgentPanel workspace={ws} events={[]} />);
    expect(screen.getByText("frontend")).toBeInTheDocument();
    expect(screen.getByText("backend")).toBeInTheDocument();
  });

  it("shows agent status indicators", () => {
    const ws: Workspace = {
      ...baseWorkspace,
      plan: {
        rationale: "test",
        tasks: [
          { id: "t1", description: "Build UI", agentRole: "frontend", dependsOn: [], status: "completed" },
          { id: "t2", description: "Build API", agentRole: "backend", dependsOn: [], status: "running" },
        ],
      },
    };
    render(<AgentPanel workspace={ws} events={[]} />);
    // Should show both agents
    expect(screen.getByText("frontend")).toBeInTheDocument();
    expect(screen.getByText("backend")).toBeInTheDocument();
  });
});
