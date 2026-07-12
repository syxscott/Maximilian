import "@testing-library/jest-dom/vitest"
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { TaskPanel } from "../src/components/TaskPanel"
import type { Workspace } from "../src/api"

const baseWorkspace: Workspace = {
  id: "ws-1",
  userRequest: "Build a todo app",
  status: "running",
  plan: null,
  results: [],
  review: null,
  error: null,
  createdAt: "2026-06-25T10:00:00Z",
}

describe("TaskPanel", () => {
  it("renders task list from plan", () => {
    const ws: Workspace = {
      ...baseWorkspace,
      plan: {
        rationale: "Break into frontend + backend",
        tasks: [
          {
            id: "t1",
            description: "Build UI",
            agentRole: "frontend",
            dependsOn: [],
            status: "completed",
          },
          {
            id: "t2",
            description: "Build API",
            agentRole: "backend",
            dependsOn: ["t1"],
            status: "running",
          },
        ],
      },
    }
    render(<TaskPanel workspace={ws} />)
    expect(screen.getByText("Build UI")).toBeInTheDocument()
    expect(screen.getByText("Build API")).toBeInTheDocument()
  })

  it("shows 'No tasks yet' when workspace has no plan", () => {
    render(<TaskPanel workspace={null} />)
    expect(screen.getByText(/no tasks yet/i)).toBeInTheDocument()
  })

  it("shows dependency info", () => {
    const ws: Workspace = {
      ...baseWorkspace,
      plan: {
        rationale: "Sequential",
        tasks: [
          {
            id: "t1",
            description: "First task",
            agentRole: "general",
            dependsOn: [],
            status: "completed",
          },
          {
            id: "t2",
            description: "Second task",
            agentRole: "general",
            dependsOn: ["t1"],
            status: "pending",
          },
        ],
      },
    }
    render(<TaskPanel workspace={ws} />)
    expect(screen.getByText((_, el) => el?.textContent === "← t1")).toBeInTheDocument()
  })

  it("shows error for failed tasks", () => {
    const ws: Workspace = {
      ...baseWorkspace,
      plan: {
        rationale: "Test",
        tasks: [
          {
            id: "t1",
            description: "Failing task",
            agentRole: "general",
            dependsOn: [],
            status: "failed",
            error: "timeout",
          },
        ],
      },
    }
    render(<TaskPanel workspace={ws} />)
    expect(screen.getByText(/error: timeout/)).toBeInTheDocument()
  })

  it("shows rationale", () => {
    const ws: Workspace = {
      ...baseWorkspace,
      plan: {
        rationale: "Split into 3 parallel tasks",
        tasks: [
          {
            id: "t1",
            description: "Task A",
            agentRole: "general",
            dependsOn: [],
            status: "pending",
          },
        ],
      },
    }
    render(<TaskPanel workspace={ws} />)
    expect(screen.getByText("Split into 3 parallel tasks")).toBeInTheDocument()
  })

  it("shows wave indicator while tasks are running", () => {
    const ws: Workspace = {
      ...baseWorkspace,
      plan: {
        rationale: "test",
        tasks: [
          {
            id: "t1",
            description: "a",
            agentRole: "frontend",
            dependsOn: [],
            status: "running",
            startedAt: "2026-06-25T10:00:00Z",
          },
          {
            id: "t2",
            description: "b",
            agentRole: "backend",
            dependsOn: [],
            status: "running",
            startedAt: "2026-06-25T10:00:00Z",
          },
          { id: "t3", description: "c", agentRole: "review", dependsOn: [], status: "pending" },
        ],
      },
    }
    render(<TaskPanel workspace={ws} />)
    expect(screen.getAllByTestId("wave-tick").length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/parallel active/i)).toBeInTheDocument()
  })

  it("shows task descriptions in plan phase", () => {
    const ws: Workspace = {
      ...baseWorkspace,
      plan: {
        rationale: "test",
        tasks: [
          {
            id: "t1",
            description: "First step",
            agentRole: "frontend",
            dependsOn: [],
            status: "pending",
          },
          {
            id: "t2",
            description: "Second step",
            agentRole: "backend",
            dependsOn: ["t1"],
            status: "pending",
          },
        ],
      },
    }
    render(<TaskPanel workspace={ws} />)
    expect(screen.getByText("First step")).toBeInTheDocument()
    expect(screen.getByText("Second step")).toBeInTheDocument()
  })

  it("renders task durations for completed tasks", () => {
    const ws: Workspace = {
      ...baseWorkspace,
      status: "completed",
      plan: {
        rationale: "test",
        tasks: [
          {
            id: "t1",
            description: "done task",
            agentRole: "frontend",
            dependsOn: [],
            status: "completed",
            startedAt: "2026-06-25T10:00:00Z",
            completedAt: "2026-06-25T10:00:01Z",
          },
        ],
      },
    }
    render(<TaskPanel workspace={ws} />)
    expect(screen.getByText(/1\.0s|m\s*\d+s/)).toBeInTheDocument()
  })
})
