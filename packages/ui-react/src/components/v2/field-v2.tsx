import * as React from "react"
import { cn } from "../../lib/utils.js"
import { TooltipV2 } from "./tooltip-v2.js"

type FieldContextValue = {
  controlId: string
  labelId: string
  prefixId: string
  suffixId: string
  invalid: boolean
  registerPrefix: () => void
  unregisterPrefix: () => void
  registerSuffix: () => void
  unregisterSuffix: () => void
  getDescribedBy: () => string | undefined
}

const FieldContext = React.createContext<FieldContextValue | null>(null)

function useField() {
  const ctx = React.useContext(FieldContext)
  if (!ctx) {
    throw new Error("Field subcomponents must be used within <Field>")
  }
  return ctx
}

const CONTROL_SELECTOR = [
  "[data-slot='text-input-v2-input']",
  "[data-slot='textarea-v2-textarea']",
  "[data-slot='inline-input-v2-input']",
].join(", ")

let _fieldUid = 0
const _nextId = () => `field-v2-${++_fieldUid}`

export interface FieldV2Props extends React.HTMLAttributes<HTMLDivElement> {
  invalid?: boolean
}

export const FieldV2Root = React.forwardRef<HTMLDivElement, FieldV2Props>(
  ({ className, invalid, children, ...rest }, ref) => {
    const controlId = React.useMemo(() => `${_nextId()}-control`, [])
    const labelId = React.useMemo(() => `${_nextId()}-label`, [])
    const prefixId = React.useMemo(() => `${_nextId()}-prefix`, [])
    const suffixId = React.useMemo(() => `${_nextId()}-suffix`, [])

    const [prefixCount, setPrefixCount] = React.useState(0)
    const [suffixCount, setSuffixCount] = React.useState(0)
    const rootRef = React.useRef<HTMLDivElement | null>(null)

    const setRefs = React.useCallback(
      (node: HTMLDivElement | null) => {
        rootRef.current = node
        if (typeof ref === "function") ref(node)
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node
      },
      [ref],
    )

    const ctxRef = React.useRef<FieldContextValue>({
      controlId,
      labelId,
      prefixId,
      suffixId,
      invalid: false,
      registerPrefix: () => undefined,
      unregisterPrefix: () => undefined,
      registerSuffix: () => undefined,
      unregisterSuffix: () => undefined,
      getDescribedBy: () => undefined,
    })

    const getDescribedBy = React.useCallback(() => {
      const ids: string[] = []
      if (prefixCount > 0) ids.push(prefixId)
      if (suffixCount > 0) ids.push(suffixId)
      return ids.length > 0 ? ids.join(" ") : undefined
    }, [prefixCount, suffixCount, prefixId, suffixId])

    ctxRef.current = {
      controlId,
      labelId,
      prefixId,
      suffixId,
      invalid: !!invalid,
      registerPrefix: () => setPrefixCount((n) => n + 1),
      unregisterPrefix: () => setPrefixCount((n) => Math.max(0, n - 1)),
      registerSuffix: () => setSuffixCount((n) => n + 1),
      unregisterSuffix: () => setSuffixCount((n) => Math.max(0, n - 1)),
      getDescribedBy,
    }

    const syncControlA11y = React.useCallback(() => {
      const root = rootRef.current
      if (!root) return
      const control = root.querySelector(CONTROL_SELECTOR) as
        | HTMLInputElement
        | HTMLTextAreaElement
        | null
      if (!control) return
      const shell = control.closest(
        "[data-component='text-input-v2'], [data-component='textarea-v2'], [data-component='inline-input-v2']",
      ) as HTMLElement | null

      control.id = controlId
      control.setAttribute("aria-labelledby", labelId)

      const describedBy = getDescribedBy()
      if (describedBy) {
        control.setAttribute("aria-describedby", describedBy)
      } else {
        control.removeAttribute("aria-describedby")
      }

      if (invalid) {
        control.setAttribute("aria-invalid", "true")
        shell?.setAttribute("data-invalid", "")
      } else {
        control.removeAttribute("aria-invalid")
        shell?.removeAttribute("data-invalid")
      }
    }, [controlId, labelId, getDescribedBy, invalid])

    React.useEffect(() => {
      syncControlA11y()
    }, [syncControlA11y, prefixCount, suffixCount, invalid])

    return (
      <FieldContext.Provider value={ctxRef.current}>
        <div
          ref={setRefs}
          data-component="field-v2"
          data-invalid={invalid ? "" : undefined}
          className={cn(className)}
          {...rest}
        >
          {children}
        </div>
      </FieldContext.Provider>
    )
  },
)
FieldV2Root.displayName = "FieldV2Root"

const FieldLabelInfoIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M13 13H3V3H13V13ZM6.46777 6.81641V7.81641H7.5791V11.3721H8.5791V6.81641H6.46777ZM7.30078 4.62891V5.62891H8.85645V4.62891H7.30078Z"
      fill="currentColor"
    />
  </svg>
)

export interface FieldLabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  tooltip?: string
}

export const FieldLabel = React.forwardRef<HTMLLabelElement, FieldLabelProps>(
  ({ className, children, tooltip, ...rest }, ref) => {
    const field = useField()
    return (
      <label
        ref={ref}
        id={field.labelId}
        htmlFor={field.controlId}
        data-slot="field-v2-label"
        className={cn(className)}
        {...rest}
      >
        <span data-slot="field-v2-label-text">{children}</span>
        {tooltip ? (
          <TooltipV2 value={tooltip}>
            <button
              type="button"
              data-slot="field-v2-label-info"
              aria-label={tooltip}
              onClick={(e) => e.stopPropagation()}
            >
              <FieldLabelInfoIcon />
            </button>
          </TooltipV2>
        ) : null}
      </label>
    )
  },
)
FieldLabel.displayName = "FieldLabel"

export const FieldPrefix: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  children,
  ...rest
}) => {
  const field = useField()
  React.useEffect(() => {
    field.registerPrefix()
    return () => field.unregisterPrefix()
  }, [field])

  return (
    <div
      id={field.prefixId}
      data-slot="field-v2-prefix"
      className={cn(className)}
      {...rest}
    >
      {children}
    </div>
  )
}
FieldPrefix.displayName = "FieldPrefix"

export const FieldSuffix: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  children,
  ...rest
}) => {
  const field = useField()
  React.useEffect(() => {
    field.registerSuffix()
    return () => field.unregisterSuffix()
  }, [field])

  return (
    <div
      id={field.suffixId}
      data-slot="field-v2-suffix"
      className={cn(className)}
      {...rest}
    >
      {children}
    </div>
  )
}
FieldSuffix.displayName = "FieldSuffix"

export const FieldControl: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  children,
  ...rest
}) => (
  <div data-slot="field-v2-control" className={cn(className)} {...rest}>
    {children}
  </div>
)
FieldControl.displayName = "FieldControl"

export const FieldV2 = Object.assign(FieldV2Root, {
  Label: FieldLabel,
  Prefix: FieldPrefix,
  Suffix: FieldSuffix,
  Control: FieldControl,
})

export const Field = FieldV2
