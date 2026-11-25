// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * WorkspaceDockSidebar add-panel menu focus tests. The menu is a plain
 * absolutely-positioned popover with no Radix primitive behind it, so it
 * borrows the shared useModalFocus contract: opening moves focus into the
 * first item, Tab cycles inside, and Escape closes it and returns focus to
 * the toggle.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { getDictionary, setLocale } from "@max/i18n"

import { applyDashboardDictionaries } from "../src/locales/index"
import {
  WORKSPACE_DOCK_STORAGE_KEY,
  WorkspaceDockSidebar,
  createWorkspaceDockModel,
  useWorkspaceDockStore,
} from "../src/components/layout/WorkspaceDockSidebar"

applyDashboardDictionaries(getDictionary("zh-CN") ?? {}, getDictionary("en-US") ?? {})
setLocale("en-US")

function renderSidebar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <WorkspaceDockSidebar workspace={null} events={[]} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  try {
    localStorage.removeItem(WORKSPACE_DOCK_STORAGE_KEY)
  } catch {
    /* ignore */
  }
  useWorkspaceDockStore.setState({
    model: createWorkspaceDockModel(),
    maximizedId: null,
  })
})

afterEach(() => {
  cleanup()
  setLocale("en-US")
})

describe("WorkspaceDockSidebar add-panel menu focus", () => {
  it("moves focus into the first item, cycles Tab inside, and restores the toggle on Escape", async () => {
    const user = userEvent.setup()
    // Two closed panels give the menu two items to cycle between.
    act(() => {
      useWorkspaceDockStore.getState().removePanel("files")
      useWorkspaceDockStore.getState().removePanel("tasks")
    })
    renderSidebar()

    const toggle = screen.getByTestId("workspace-dock-add-toggle")
    await user.click(toggle)

    const items = screen.getAllByRole("menuitem")
    expect(items).toHaveLength(2)
    const first = items[0]
    const second = items[1]
    expect(first).toHaveFocus()

    await user.tab()
    expect(second).toHaveFocus()

    // Wrapping past the last item comes back to the first instead of
    // escaping into the dock.
    await user.tab()
    expect(first).toHaveFocus()

    await user.keyboard("{Escape}")

    expect(screen.queryByTestId("workspace-dock-add-menu")).not.toBeInTheDocument()
    expect(toggle).toHaveFocus()
  })
})
