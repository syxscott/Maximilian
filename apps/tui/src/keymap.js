export function createKeymap(config) { return config; }
export function useKeymap() { return { bindings: [] }; }
export function useBindings(_input) { }
export function useCommandShortcut(_name) { return () => ""; }
export function useKeymapSelector(_selector) { return (() => []); }
