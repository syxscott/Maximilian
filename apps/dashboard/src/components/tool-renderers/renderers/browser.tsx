// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Browser-automation bodies: browser-navigate, browser-action — the
 * control-browser surface (a session-scoped browser, distinct from the
 * OS-level computer-use family). Navigation leads with the ai-elements
 * LinkPreviewCard (same mount as webfetch), actions read as a
 * method · selector · text section; JSON fallback when opaque.
 */

import { LinkPreviewCard } from "@/components/ai-elements"
import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractBrowserAction, extractBrowserNavigate } from "./browser.model"
import { FIELDS } from "./shared.model"

export const BROWSER_NAVIGATE_GLYPH = "⇢"
export const BROWSER_ACTION_GLYPH = "⟫"

export function BrowserNavigateBody(props: ToolCallProps) {
  const vm = extractBrowserNavigate(props.input)
  if (vm.isEmpty) {
    return <BodyShell titleKey="toolRenderers.browser-navigate.title" vm={vm} input={props.input} />
  }
  const rowValue = (labelKey: string) => vm.rows.find((r) => r.labelKey === labelKey)?.value
  return (
    <BodyShell
      titleKey="toolRenderers.browser-navigate.title"
      vm={vm}
      input={props.input}
      extra={
        <LinkPreviewCard
          link={{
            url: rowValue(FIELDS.url),
            title: rowValue(FIELDS.title) ?? rowValue(FIELDS.host) ?? rowValue(FIELDS.url),
            description: rowValue(FIELDS.session),
          }}
          className="mb-1"
        />
      }
    />
  )
}

export function BrowserActionBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.browser-action.title"
      vm={extractBrowserAction(props.input)}
      input={props.input}
    />
  )
}
