import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OutputPanel } from "../src/components/OutputPanel";
import type { Workspace } from "../src/api";

const baseWorkspace: Workspace = {
  id: "ws-1",
  userRequest: "test",
  status: "completed",
  plan: null,
  results: [],
  review: null,
  error: null,
  createdAt: "2026-06-25T10:00:00Z",
};

describe("OutputPanel", () => {
  it("shows 'No outputs yet' when no results", () => {
    render(<OutputPanel workspace={null} />);
    expect(screen.getByText(/no outputs yet/i)).toBeInTheDocument();
  });

  it("renders non-review results as tabs", () => {
    const ws: Workspace = {
      ...baseWorkspace,
      results: [
        { id: "r1", taskId: "t1", agentRole: "frontend", output: "<div>Hello</div>" },
        { id: "r2", taskId: "t2", agentRole: "backend", output: "app.get('/api')" },
      ],
    };
    render(<OutputPanel workspace={ws} />);
    expect(screen.getByText("frontend #1")).toBeInTheDocument();
    expect(screen.getByText("backend #2")).toBeInTheDocument();
    expect(screen.getByText("<div>Hello</div>")).toBeInTheDocument();
  });

  it("filters out review results", () => {
    const ws: Workspace = {
      ...baseWorkspace,
      results: [
        { id: "r1", taskId: "t1", agentRole: "frontend", output: "UI code" },
        { id: "r2", taskId: "t2", agentRole: "review", output: "Score: 9/10" },
      ],
    };
    render(<OutputPanel workspace={ws} />);
    expect(screen.getByText("frontend #1")).toBeInTheDocument();
    expect(screen.queryByText(/review/)).not.toBeInTheDocument();
  });

  it("shows 'No outputs yet' when only review results exist", () => {
    const ws: Workspace = {
      ...baseWorkspace,
      results: [
        { id: "r1", taskId: "t1", agentRole: "review", output: "Looks good" },
      ],
    };
    render(<OutputPanel workspace={ws} />);
    expect(screen.getByText(/no outputs yet/i)).toBeInTheDocument();
  });
});
