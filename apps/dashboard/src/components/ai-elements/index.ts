// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ai-elements — reusable assistant message-part widgets (ZCode
 * ai-elements borrowing). Barrel export: one widget per file, each backed
 * by the pure coercion functions in ./model and the aiElements i18n
 * domain (src/locales/ai-elements.*.json).
 */
export { CodeBlock } from "./CodeBlock"
export type { CodeBlockProps } from "./CodeBlock"
export { ReasoningBlock } from "./ReasoningBlock"
export type { ReasoningBlockProps } from "./ReasoningBlock"
export { AttachmentCard } from "./AttachmentCard"
export type { AttachmentCardProps } from "./AttachmentCard"
export { CitationBlock } from "./CitationBlock"
export type { CitationBlockProps } from "./CitationBlock"
export { KeyValueCard } from "./KeyValueCard"
export type { KeyValueCardProps } from "./KeyValueCard"
export { ImagePreviewBlock } from "./ImagePreviewBlock"
export type { ImagePreviewBlockProps } from "./ImagePreviewBlock"
export { ErrorBlock } from "./ErrorBlock"
export type { ErrorBlockProps } from "./ErrorBlock"
export { TokenUsageBadge } from "./TokenUsageBadge"
export type { TokenUsageBadgeProps } from "./TokenUsageBadge"
export { LatencyMeter } from "./LatencyMeter"
export type { LatencyMeterProps } from "./LatencyMeter"
export { StatusPill } from "./StatusPill"
export type { StatusPillProps } from "./StatusPill"
export { StreamingCursor } from "./StreamingCursor"
export type { StreamingCursorProps } from "./StreamingCursor"
export { DocumentPreviewBlock } from "./DocumentPreviewBlock"
export type { DocumentPreviewBlockProps } from "./DocumentPreviewBlock"
export { MarkdownProseBlock } from "./MarkdownProseBlock"
export type { MarkdownProseBlockProps } from "./MarkdownProseBlock"

// Model layer — re-exported so consumers never import deep paths.
export * from "./model"
