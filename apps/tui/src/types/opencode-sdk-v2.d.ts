declare module "@opencode-ai/sdk/v2" {
  export interface Project {
    id?: string
    name?: string
    worktree?: string
    [key: string]: unknown
  }
  export interface Session {
    id: string
    [key: string]: unknown
  }
  export interface Server {
    [key: string]: unknown
  }
  export function createClient(config: unknown): unknown
}
