import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from "react"
import { cn } from "../lib/utils.js"

export interface TextShimmerV2Props {
  text: string
  className?: string
  as?: ElementType
  active?: boolean
  offset?: number
  children?: ReactNode
}

const SWAP_MS = 220

export function TextShimmerV2({
  text,
  className,
  as: Tag = "span",
  active = true,
  offset = 0,
}: TextShimmerV2Props) {
  const [run, setRun] = useState(active)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
    if (active) {
      setRun(true)
      return
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined
      setRun(false)
    }, SWAP_MS)
  }, [active])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const style: CSSProperties = {
    // CSS custom properties for shimmer animation
    ["--_swap" as never]: `${SWAP_MS}ms`,
    ["--_index" as never]: `${offset}`,
  }

  return (
    <Tag
      data-component="text-shimmer-v2"
      data-active={active ? "true" : "false"}
      className={cn(className)}
      aria-label={text}
      style={style}
    >
      <span data-slot="text-shimmer-v2-char" className="relative inline-block">
        <span data-slot="text-shimmer-v2-base" aria-hidden="true" className="text-shimmer-v2-base">
          {text}
        </span>
        <span
          data-slot="text-shimmer-v2-shimmer"
          data-run={run ? "true" : "false"}
          aria-hidden="true"
          className="text-shimmer-v2-shimmer"
        >
          {text}
        </span>
      </span>
    </Tag>
  )
}