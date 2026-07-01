declare module "@opencode-ai/plugin/tui" {
  export type TuiAttentionSoundName = string
  export interface TuiPlugin {
    name: string
    [key: string]: unknown
  }
  export interface TuiPluginApi {
    [key: string]: unknown
  }
  export interface TuiPluginModule {
    default: TuiPlugin
    [key: string]: unknown
  }
  export type TuiPluginStatus = "active" | "inactive" | "error"
  export interface TuiRouteCurrent {
    [key: string]: unknown
  }
  export interface TuiRouteDefinition {
    path: string
    [key: string]: unknown
  }
}
