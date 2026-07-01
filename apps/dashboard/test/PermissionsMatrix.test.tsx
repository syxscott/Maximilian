import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { permissionsApi } from "../src/lib/permissions";
import { PermissionsMatrix } from "../src/components/PermissionsMatrix";

const baseConfig = {
  defaults: {
    bash: "ask" as const,
    write: "ask" as const,
    edit: "ask" as const,
    read: "allow" as const,
    glob: "allow" as const,
    grep: "allow" as const,
  },
  patterns: {},
};

describe("PermissionsMatrix", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(permissionsApi, "get").mockResolvedValue(baseConfig);
    vi.spyOn(permissionsApi, "put").mockImplementation(
      async (cfg: typeof baseConfig) => cfg,
    );
    vi.spyOn(permissionsApi, "reset").mockResolvedValue(baseConfig);
    vi.spyOn(permissionsApi, "test").mockResolvedValue({ matches: true });
    vi.spyOn(permissionsApi, "answer").mockResolvedValue({
      requestId: "x",
      decision: "allow" as const,
    });
  });

  it("renders the default config after load", async () => {
    render(<PermissionsMatrix />);
    for (const tool of ["bash", "read", "write", "edit", "glob", "grep"]) {
      expect(await screen.findByTestId(`perms-tool-${tool}`)).toBeInTheDocument();
    }
  });

  it("clicking a default button enables Save", async () => {
    const user = userEvent.setup();
    render(<PermissionsMatrix />);

    const denyBtn = await screen.findByTestId("perms-default-bash-deny");
    await user.click(denyBtn);

    await waitFor(() => {
      expect(screen.getByTestId("perms-save")).not.toBeDisabled();
    });
  });

  it("adding a pattern row exposes input + action select", async () => {
    const user = userEvent.setup();
    render(<PermissionsMatrix />);

    await user.click(await screen.findByTestId("perms-add-write"));
    expect(screen.getAllByTestId(/^perms-pattern-write-input$/).length).toBeGreaterThan(0);
  });

  it("PUT is called with the new config on save", async () => {
    const user = userEvent.setup();
    render(<PermissionsMatrix />);

    await user.click(await screen.findByTestId("perms-default-read-deny"));
    await user.click(screen.getByTestId("perms-save"));

    await waitFor(() => {
      expect(permissionsApi.put).toHaveBeenCalledTimes(1);
    });
    const lastCall = (permissionsApi.put as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(lastCall.defaults.read).toBe("deny");
  });

  it("Reset button restores defaults via the API", async () => {
    const user = userEvent.setup();
    render(<PermissionsMatrix />);

    await user.click(await screen.findByTestId("perms-reset"));

    await waitFor(() => {
      expect(permissionsApi.reset).toHaveBeenCalledTimes(1);
    });
  });
});
