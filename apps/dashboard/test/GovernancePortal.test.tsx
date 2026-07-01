import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GovernancePortal } from "../src/components/GovernancePortal";
import type { PendingProposal } from "../src/api";

vi.mock("../src/api", async () => {
  const actual = await vi.importActual<typeof import("../src/api")>("../src/api");
  return {
    ...actual,
    govApi: {
      listPending: vi.fn(),
      resolveProposal: vi.fn(),
    },
  };
});

import { govApi } from "../src/api";

const mockProposal: PendingProposal = {
  proposalId: "prop-1",
  proposal: {
    id: "prop-1",
    action: "promote",
    subject: "backend/agent-x",
    rationale: "Consistently high quality scores",
    createdAt: "2026-06-25T10:00:00Z",
  },
  simulation: {
    costDelta: 0.05,
    latencyDeltaMs: 100,
    qualityDelta: 0.2,
    riskDelta: 0.0,
  },
  score: {
    qualityGain: 0.2,
    latencyPenalty: 0.1,
    costPenalty: 0.05,
    riskPenalty: 0.0,
    utility: 0.15,
  },
};

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe("GovernancePortal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders empty state when no proposals", async () => {
    (govApi.listPending as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0, proposals: [] });
    renderWithQuery(<GovernancePortal />);
    expect(await screen.findByText(/No proposals awaiting human review/i)).toBeInTheDocument();
  });

  it("renders a proposal card with all deltas", async () => {
    (govApi.listPending as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1, proposals: [mockProposal] });
    renderWithQuery(<GovernancePortal />);
    expect(await screen.findByText(/backend\/agent-x/)).toBeInTheDocument();
    expect(screen.getByText("promote")).toBeInTheDocument();
    expect(screen.getByText(/Consistently high quality scores/)).toBeInTheDocument();
    expect(screen.getByText(/Cost.*\+0\.05/)).toBeInTheDocument();
    expect(screen.getByText(/Latency.*\+100ms/)).toBeInTheDocument();
  });

  it("shows list error when API fails", async () => {
    (govApi.listPending as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));
    renderWithQuery(<GovernancePortal />);
    expect(await screen.findByText(/Failed to load pending proposals/i)).toBeInTheDocument();
  });

  it("opens approve modal and submits with reason + user", async () => {
    (govApi.listPending as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1, proposals: [mockProposal] });
    (govApi.resolveProposal as ReturnType<typeof vi.fn>).mockResolvedValue({
      proposalId: "prop-1",
      status: "approved",
      resolvedBy: "admin",
    });
    const user = userEvent.setup();
    renderWithQuery(<GovernancePortal />);
    await screen.findByText(/backend\/agent-x/);

    await user.click(screen.getByRole("button", { name: /Approve Mutation/i }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Approve Proposal/)).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/Why are you approving/i), "Looks good");
    const submitBtn = screen.getByRole("button", { name: /^Approve$/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(govApi.resolveProposal).toHaveBeenCalledWith("prop-1", "approve", "Looks good", "admin");
    });
  });

  it("Escape closes the modal without submitting", async () => {
    (govApi.listPending as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1, proposals: [mockProposal] });
    const user = userEvent.setup();
    renderWithQuery(<GovernancePortal />);
    await screen.findByText(/backend\/agent-x/);
    await user.click(screen.getByRole("button", { name: /Deny Mutation/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(govApi.resolveProposal).not.toHaveBeenCalled();
  });

  it("rejects with reject action when Deny clicked", async () => {
    (govApi.listPending as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1, proposals: [mockProposal] });
    (govApi.resolveProposal as ReturnType<typeof vi.fn>).mockResolvedValue({
      proposalId: "prop-1",
      status: "rejected",
      resolvedBy: "admin",
    });
    const user = userEvent.setup();
    renderWithQuery(<GovernancePortal />);
    await screen.findByText(/backend\/agent-x/);

    await user.click(screen.getByRole("button", { name: /Deny Mutation/i }));
    await user.type(screen.getByPlaceholderText(/Why are you approving/i), "Not now");
    await user.click(screen.getByRole("button", { name: /^Reject$/i }));

    await waitFor(() => {
      expect(govApi.resolveProposal).toHaveBeenCalledWith("prop-1", "reject", "Not now", "admin");
    });
  });
});
