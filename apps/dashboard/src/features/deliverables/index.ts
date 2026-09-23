// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Deliverables feature domain (deepseek ui-deliverables borrowing):
 * per-task final outputs with role grouping, stats, and a pure-Markdown
 * export. Public surface only — consumers import from here, never from
 * domain internals.
 */

export { DeliverablesPanel } from "./DeliverablesPanel"
export {
  DELIVERABLE_PREVIEW_LINES,
  canUseClipboard,
  copyText,
  deliverableStats,
  groupByRole,
  previewLines,
  reviewSummary,
  toDeliverableViews,
  toDeliverablesMarkdown,
} from "./model"
export type {
  ClipboardLike,
  DeliverableStats,
  DeliverableView,
  PreviewedOutput,
  ReviewSummaryView,
  RoleGroup,
} from "./model"
