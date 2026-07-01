import * as React from "react"
import * as RDialog from "@radix-ui/react-dialog"

type DialogElement = () => React.ReactNode

interface Active {
  id: string
  node: React.ReactNode
  dispose: () => void
  onClose?: () => void
}

interface DialogContextValue {
  stack: Active[]
  close: (id?: string) => void
  show: (element: DialogElement, onClose?: () => void) => void
  push: (element: DialogElement, onClose?: () => void) => void
}

const DialogContext = React.createContext<DialogContextValue | undefined>(undefined)

export interface DialogProviderProps {
  children?: React.ReactNode
}

export function DialogProvider(props: DialogProviderProps) {
  const stackRef = React.useRef<Active[]>([])
  const [stack, setStack] = React.useState<Active[]>([])
  const lockRef = React.useRef(false)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const syncStack = React.useCallback((next: Active[]) => {
    stackRef.current = next
    setStack(next)
  }, [])

  const close = React.useCallback(
    (id?: string) => {
      const items = stackRef.current
      const current = id ? items.find((item) => item.id === id) : items[items.length - 1]
      if (!current || lockRef.current) return
      lockRef.current = true
      current.onClose?.()

      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current)
        timerRef.current = undefined
      }

      timerRef.current = setTimeout(() => {
        timerRef.current = undefined
        current.dispose()
        syncStack(stackRef.current.filter((item) => item.id !== current.id))
        lockRef.current = false
      }, 100)
    },
    [syncStack],
  )

  React.useEffect(() => {
    if (stack.length === 0) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      close()
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true })
    }
  }, [stack.length, close])

  React.useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current)
        timerRef.current = undefined
      }
      stackRef.current.forEach((item) => item.dispose())
      stackRef.current = []
    }
  }, [])

  const mount = React.useCallback(
    (element: DialogElement, onClose: (() => void) | undefined, layer: number) => {
      const id = Math.random().toString(36).slice(2)
      const zIndex = 50 + layer * 10

      const Component = () => {
        const [open, setOpen] = React.useState(true)
        return (
          <RDialog.Root
            open={open}
            onOpenChange={(next: boolean) => {
              if (next) return
              setOpen(false)
              close(id)
            }}
          >
            <RDialog.Portal>
              <RDialog.Overlay
                data-component="dialog-overlay"
                style={{ zIndex: String(zIndex) }}
                onClick={() => close(id)}
              />
              <div
                data-dialog-layer={layer}
                style={{
                  position: "fixed",
                  inset: 0,
                  zIndex: String(zIndex),
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  pointerEvents: "none",
                }}
              >
                {element()}
              </div>
            </RDialog.Portal>
          </RDialog.Root>
        )
      }

      const node = <Component key={id} />
      const dispose = () => {
        // Radix unmounts via the portal when the dialog closes; nothing extra needed.
      }

      const active: Active = { id, node, dispose, onClose }
      syncStack([...stackRef.current, active])
    },
    [close, syncStack],
  )

  const push = React.useCallback(
    (element: DialogElement, onClose?: () => void) => {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current)
        timerRef.current = undefined
      }
      lockRef.current = false
      mount(element, onClose, stackRef.current.length)
    },
    [mount],
  )

  const show = React.useCallback(
    (element: DialogElement, onClose?: () => void) => {
      stackRef.current.forEach((item) => item.dispose())
      syncStack([])
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current)
        timerRef.current = undefined
      }
      lockRef.current = false
      mount(element, onClose, 0)
    },
    [mount, syncStack],
  )

  const value = React.useMemo<DialogContextValue>(
    () => ({ stack, close, show, push }),
    [stack, close, show, push],
  )

  return (
    <DialogContext.Provider value={value}>
      {props.children}
      <div data-component="dialog-stack">
        {stack.map((item) => (
          <React.Fragment key={item.id}>{item.node}</React.Fragment>
        ))}
      </div>
    </DialogContext.Provider>
  )
}

export function useDialog() {
  const ctx = React.useContext(DialogContext)
  if (!ctx) {
    throw new Error("useDialog must be used within a DialogProvider")
  }
  return {
    get active() {
      return ctx.stack[ctx.stack.length - 1]
    },
    show(element: DialogElement, onClose?: () => void) {
      ctx.show(element, onClose)
    },
    push(element: DialogElement, onClose?: () => void) {
      ctx.push(element, onClose)
    },
    close() {
      ctx.close()
    },
  }
}