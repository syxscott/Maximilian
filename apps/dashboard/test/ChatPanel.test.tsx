import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatPanel } from "../src/components/ChatPanel";
import type { Workspace } from "../src/api";

const baseWorkspace: Workspace = {
  id: "ws-1",
  userRequest: "Build a todo app",
  status: "running",
  plan: null,
  results: [],
  review: null,
  error: null,
  createdAt: "2026-06-25T10:00:00Z",
};

describe("ChatPanel", () => {
  it("renders textarea, presets, and disabled Send button", () => {
    render(<ChatPanel onSubmit={() => {}} submitting={false} workspace={null} />);
    expect(screen.getByPlaceholderText(/enter your request/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
    expect(screen.getAllByRole("button")).toHaveLength(4); // 3 presets + send
  });

  it("enables Send when text is entered", async () => {
    const user = userEvent.setup();
    render(<ChatPanel onSubmit={() => {}} submitting={false} workspace={null} />);
    const textarea = screen.getByPlaceholderText(/enter your request/i);
    await user.type(textarea, "hello");
    expect(screen.getByRole("button", { name: /send/i })).not.toBeDisabled();
  });

  it("calls onSubmit with trimmed text and clears textarea", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ChatPanel onSubmit={onSubmit} submitting={false} workspace={null} />);
    const textarea = screen.getByPlaceholderText(/enter your request/i);
    await user.type(textarea, "  build something  ");
    await user.click(screen.getByRole("button", { name: /send/i }));
    expect(onSubmit).toHaveBeenCalledWith("build something");
    expect(textarea).toHaveValue("");
  });

  it("calls onSubmit when a preset is clicked", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ChatPanel onSubmit={onSubmit} submitting={false} workspace={null} />);
    const preset = screen.getByRole("button", { name: /todo web app/i });
    await user.click(preset);
    expect(onSubmit).toHaveBeenCalledWith(expect.stringContaining("Todo"));
  });

  it("disables Send while submitting", () => {
    render(<ChatPanel onSubmit={() => {}} submitting={true} workspace={null} />);
    expect(screen.getByRole("button", { name: /sending/i })).toBeDisabled();
  });

  it("Cmd+Enter on textarea submits", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ChatPanel onSubmit={onSubmit} submitting={false} workspace={null} />);
    const textarea = screen.getByPlaceholderText(/enter your request/i);
    await user.type(textarea, "submit me");
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(onSubmit).toHaveBeenCalledWith("submit me");
  });

  it("shows user request and completion message when workspace completed", () => {
    const ws: Workspace = {
      ...baseWorkspace,
      status: "completed",
      review: { score: 9, summary: "Looks good", issues: [], suggestions: [], reviewedAt: "2026-06-25T11:00:00Z" },
    };
    render(<ChatPanel onSubmit={() => {}} submitting={false} workspace={ws} />);
    expect(screen.getByText(/Build a todo app/)).toBeInTheDocument();
    expect(screen.getByText(/Execution complete/i)).toBeInTheDocument();
    expect(screen.getByText(/9\/10/)).toBeInTheDocument();
  });

  it("shows error message when workspace failed", () => {
    const ws: Workspace = { ...baseWorkspace, status: "failed", error: "agent timeout" };
    render(<ChatPanel onSubmit={() => {}} submitting={false} workspace={ws} />);
    expect(screen.getByText(/agent timeout/)).toBeInTheDocument();
  });
});
