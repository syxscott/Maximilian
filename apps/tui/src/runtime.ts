export type RuntimeConfig = { [key: string]: unknown }
export function createRuntime(config: unknown) { return config }
export function useRuntime() { return {} }
export function abbreviateHome(path: string, home: string): string {
  if (!home || !path.startsWith(home)) return path
  // Require a path boundary: next char must be "/" or end-of-string.
  if (path.length !== home.length && path[home.length] !== "/") return path
  return "~" + path.slice(home.length)
}
