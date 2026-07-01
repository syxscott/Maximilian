/**
 * Stub for the home session destination provider.
 *
 * The OpenCode original implemented a small reactive store that remembers a
 * "destination" workspace/directory the user selected before any session
 * existed, so that newly-created sessions land there. We only need the
 * provider shape so consumers can compile; the real state plumbing is left
 * for a follow-up task.
 */

import { createContext, createElement, useContext, useState, type ReactNode } from "react"

export type HomeSessionDestination =
  | { type: "directory"; directory: string; subdirectory: boolean }
  | { type: "new"; name?: string }
  | undefined

type Ctx = {
  destination: () => HomeSessionDestination
  setDestination: (value: HomeSessionDestination) => void
  clear: () => void
}

const SessionDestinationContext = createContext<Ctx | undefined>(undefined)

export function HomeSessionDestinationProvider(props: { children: ReactNode }) {
  const [destination, setDestinationState] = useState<HomeSessionDestination>(undefined)
  const value: Ctx = {
    destination: () => destination,
    setDestination: (next) => setDestinationState(next),
    clear: () => setDestinationState(undefined),
  }
  return createElement(SessionDestinationContext.Provider, { value }, props.children)
}

export function useHomeSessionDestination(): Ctx | undefined {
  return useContext(SessionDestinationContext)
}