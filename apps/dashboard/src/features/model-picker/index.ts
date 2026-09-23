// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Model-picker feature domain (deepseek ui-settings-models borrowing):
 * preset catalog grid, per-provider default-model selection, and a
 * one-round connectivity probe. Public surface only — consumers import
 * from here, never from domain internals.
 */

export { PresetGrid } from "./PresetGrid"
export { ProviderModelSelect } from "./ProviderModelSelect"
export { ModelTestPanel } from "./ModelTestPanel"
export {
  CATEGORY_FILTER_ALL,
  PRESET_CATEGORY_ORDER,
  PRESET_GRID_MAX,
  baseUrlHost,
  configurableProviders,
  durationTone,
  filterPresetCards,
  presetCategories,
  sameDomainPresets,
  toPresetCardViews,
  toProviderOptions,
  toSetModelResult,
  toTestChatCardView,
  windowCards,
} from "./model"
export type {
  DurationTone,
  PresetCardView,
  ProviderOptionView,
  SetModelResultView,
  TestChatCardView,
  Windowed,
} from "./model"
