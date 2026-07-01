export type Binding = { key: string; command: string; [key: string]: unknown }
export type KeymapConfig = { bindings: Binding[]; [key: string]: unknown }
export function createKeymap(config: unknown) { return config }
export function useKeymap() { return { bindings: [] } }
export function useBindings(_input: unknown): void { /* stub */ }
export function useCommandShortcut(_name: string): () => string { return () => "" }
export function useKeymapSelector<T>(_selector: (keymap: any) => T): T { return (() => []) as unknown as T }
