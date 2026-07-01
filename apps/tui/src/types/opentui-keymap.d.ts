declare module "@opentui/keymap" {
  export interface Binding {
    key: string
    [key: string]: unknown
  }
  export interface ActiveKey {
    [key: string]: unknown
  }
}

declare module "@opentui/keymap/extras" {
  import type { Binding } from "@opentui/keymap"
  export interface BindingCommandMap {
    [key: string]: unknown
  }
  export interface BindingConfig {
    [key: string]: unknown
  }
  export interface BindingDefaults {
    [key: string]: unknown
  }
  export function createBindingLookup(config: unknown): unknown
}
