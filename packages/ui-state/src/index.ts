/**
 * @max/ui-state
 *
 * React 19 + Zustand port of the OpenCode state-management contexts.
 *
 * - SolidJS createStore -> Zustand create() with persist middleware
 * - SolidJS createContext -> React createContext
 * - SolidJS createMemo / createEffect -> React useMemo / useEffect
 * - SolidJS createSignal -> React useState
 */

export * from "./settings"
export * from "./language"
export * from "./server"
export * from "./notification"
export * from "./models"
export * from "./command"
export * from "./global"
export * from "./permission"
export * from "./comments"
export * from "./highlights"

// New: API client + sync store + SolidJS-style helpers
export * from "./api"
export * from "./sync"
export * from "./utils"
// Stub exports for compatibility
export function useDialog() { return { show: () => {}, active: false } }
export function useSDK() { return { event: { on: () => () => {} } } }
export function useI18n() { return { t: (k: string) => k, locale: "en" } }
export function useToast() { return { show: (msg: string) => {} } }
export function usePlatform() { return { os: "linux" } }
