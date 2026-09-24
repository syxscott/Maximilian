// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Computer-use bodies: cua-action, get-app-state, list-apps, screenshot —
 * the individual CUA calls (previously only the cua-group's fallback child
 * name). Action shows the verb · target · typed-text section, app-state
 * the explicit observation (app · window · state id · element count),
 * list-apps the numbered roster block, and screenshot draws the actual
 * <img> when the payload carries a renderable source (data URI / URL) —
 * otherwise it lists the referenced path. All fall back to the generic
 * JSON preview when the payload is opaque.
 */

import { useLocale, t } from "@max/i18n"
import type { ToolCallProps } from "../registry"
import { BodyShell, FieldRows, JsonFallback } from "./common"
import {
  extractCuaAction,
  extractGetAppState,
  extractListApps,
  extractScreenshot,
  screenshotIsRenderable,
} from "./cua.model"

export const CUA_ACTION_GLYPH = "⌖"
export const GET_APP_STATE_GLYPH = "⌗"
export const LIST_APPS_GLYPH = "⊞"
export const SCREENSHOT_GLYPH = "◳"

export function CuaActionBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.cua-action.title"
      vm={extractCuaAction(props.input)}
      input={props.input}
    />
  )
}

export function GetAppStateBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.get-app-state.title"
      vm={extractGetAppState(props.input)}
      input={props.input}
    />
  )
}

export function ListAppsBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.list-apps.title"
      vm={extractListApps(props.input)}
      input={props.input}
    />
  )
}

export function ScreenshotBody({ input }: ToolCallProps) {
  useLocale()
  const vm = extractScreenshot(input)
  if (vm.isEmpty) return <JsonFallback input={input} />
  if (!screenshotIsRenderable(vm)) {
    return <BodyShell titleKey="toolRenderers.screenshot.title" vm={vm} input={input} />
  }
  return (
    <div className="mt-1" data-testid="tool-body">
      <p
        className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground"
        data-testid="tool-title"
      >
        {t("toolRenderers.screenshot.title")}
      </p>
      <img
        src={vm.src}
        alt={t("toolRenderers.screenshot.title")}
        className="max-h-48 rounded border border-border/60"
        data-testid="screenshot-image"
      />
      <div className="mt-1">
        <FieldRows rows={vm.rows} />
      </div>
    </div>
  )
}
