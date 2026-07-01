import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import * as LabelPrimitive from "@radix-ui/react-label"
import { cn } from "../../lib/utils"

export interface CheckboxV2Props
  extends React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> {
  label: React.ReactNode
  description?: React.ReactNode
  hideLabel?: boolean
}

export const CheckboxV2 = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  CheckboxV2Props
>(({ className, label, description, hideLabel, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    data-slot="checkbox-v2"
    className={cn(className)}
    {...props}
  >
    <div data-slot="checkbox-v2-row">
      <input
        type="checkbox"
        data-slot="checkbox-v2-input"
        checked={props.checked === true}
        defaultChecked={props.defaultChecked === true}
        onChange={() => undefined}
        aria-hidden
        tabIndex={-1}
        style={{ position: "absolute", pointerEvents: "none", opacity: 0, width: 0, height: 0 }}
      />
      <div data-slot="checkbox-v2-control-stack">
        <span data-slot="checkbox-v2-control">
          <CheckboxPrimitive.Indicator data-slot="checkbox-v2-indicator">
            <svg
              className="checkbox-v2-icon checkbox-v2-icon--check"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path
                d="M3.53564 8.17857L6.39279 11.75L12.4642 4.25"
                stroke="#FAFAFA"
                strokeWidth="1"
              />
            </svg>
            <svg
              className="checkbox-v2-icon checkbox-v2-icon--minus"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path d="M12.75 8H3.25" stroke="#FAFAFA" strokeLinejoin="round" strokeWidth="1" />
            </svg>
          </CheckboxPrimitive.Indicator>
        </span>
      </div>
      <LabelPrimitive.Root
        data-slot="checkbox-v2-label"
        className={cn(hideLabel && "sr-only")}
      >
        <div data-slot="checkbox-v2-text">
          <span data-slot="checkbox-v2-label-text">{label}</span>
          {description ? (
            <span data-slot="checkbox-v2-description">{description}</span>
          ) : null}
        </div>
      </LabelPrimitive.Root>
    </div>
  </CheckboxPrimitive.Root>
))
CheckboxV2.displayName = "CheckboxV2"
