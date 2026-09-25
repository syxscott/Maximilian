// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

export { SessionSearchPanel } from "./SessionSearchPanel"
export {
  splitHighlight,
  groupSearchResults,
  toSearchExport,
  searchExportJson,
  searchExportFileName,
  SNIPPET_CONTEXT_CHARS,
  MAX_GROUPS,
  MAX_HITS_PER_GROUP,
} from "./model"
export type {
  SessionSearchHit,
  HighlightSegments,
  SessionHitView,
  SessionSearchGroup,
  SessionSearchView,
  SearchExportDocument,
} from "./model"
export { useSessionSearch } from "./useSessionSearch"
export type { SessionSearchResponse } from "./useSessionSearch"
