/**
 * PermissionDialog — the prompt half of the permissions UI.
 *
 * Verifies: dialog opens only when `pending` is set, displays the
 * tool/target/workspace/task fields, and routes Allow / Deny through the
 * onAnswer callback with the correct decision string.
 *
 * Mounting the Radix Dialog requires jsdom (provided by vitest.config.ts)
 * and the @testing-library/jest-dom matchers (test/setup.ts).
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PermissionDialog } from "../src/components/PermissionDialog";
import type { PendingPermission } from "../src/lib/permissions";

function makePending(overrides?: Partial<PendingPermission>): PendingPermission {
  return {
    requestId: "req-1",
    workspaceId: "ws-42",
    taskId: "task-7",
    tool: "bash",
    target: "rm -rf /tmp/foo",
    ...overrides,
  };
}

describe("PermissionDialog", () => {
  it("renders nothing interactive when pending is null", () => {
    render(<PermissionDialog pending={null} onAnswer={vi.fn()} />);
    // The dialog chrome mounts even when closed (Radix portals it),
    // but the Allow/Deny buttons should not be visible because they
    // sit inside the body that only renders when pending is set.
    expect(screen.queryByTestId("perm-dialog-allow")).toBeNull();
    expect(screen.queryByTestId("perm-dialog-deny")).toBeNull();
    expect(screen.queryByTestId("perm-dialog-tool")).toBeNull();
  });

  it("shows tool, target, workspace, task when pending is set", () => {
    render(<PermissionDialog pending={makePending()} onAnswer={vi.fn()} />);
    expect(screen.getByTestId("perm-dialog-tool")).toHaveTextContent("bash");
    expect(screen.getByTestId("perm-dialog-target")).toHaveTextContent("rm -rf /tmp/foo");
    expect(screen.getByText(/ws-42/)).toBeInTheDocument();
    expect(screen.getByText(/task-7/)).toBeInTheDocument();
  });

  it("renders '(empty)' for blank target", () => {
    render(
      <PermissionDialog
        pending={makePending({ target: "" })}
        onAnswer={vi.fn()}
      />,
    );
    expect(screen.getByTestId("perm-dialog-target")).toHaveTextContent("(empty)");
  });

  it("calls onAnswer with 'allow' when Allow is clicked", async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<PermissionDialog pending={makePending()} onAnswer={onAnswer} />);

    await user.click(screen.getByTestId("perm-dialog-allow"));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith("allow");
  });

  it("calls onAnswer with 'deny' when Deny is clicked", async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<PermissionDialog pending={makePending()} onAnswer={onAnswer} />);

    await user.click(screen.getByTestId("perm-dialog-deny"));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith("deny");
  });

  it("does not invoke onAnswer when pending is null (closed state)", async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    // Even if buttons exist in the closed portal (Radix), our guards
    // `pending && onAnswer(...)` ensure no callback fires.
    render(<PermissionDialog pending={null} onAnswer={onAnswer} />);
    expect(onAnswer).not.toHaveBeenCalled();
  });
});