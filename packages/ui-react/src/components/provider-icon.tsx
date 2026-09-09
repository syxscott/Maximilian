import { useEffect, useState, type SVGProps } from "react"
import { cn } from "../lib/utils.js"

export type ProviderIconName =
  | "anthropic"
  | "openai"
  | "google"
  | "mistral"
  | "cohere"
  | "meta"
  | "amazon"
  | "azure"
  | "groq"
  | "deepseek"
  | "perplexity"
  | "xai"
  | "openrouter"
  | "synthetic"

const SPRITE_ID = "maximilian-provider-icon-sprite"
const SYMBOL_PREFIX = "maximilian-provider-icon-"

let spriteInserted = false

const SPRITE_DATA: Record<string, { viewBox: string; body: string }> = {
  anthropic: {
    viewBox: "0 0 24 24",
    body: `<path d="M12 2L2 22h4l2-5h6.5l2 5h4L12 2zm-2 11l3-7.5L16 13h-6z" fill="currentColor"/>`,
  },
  openai: {
    viewBox: "0 0 24 24",
    body: `<path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.052 6.052 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-3.999 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.28zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.787a4.5 4.5 0 0 1-.676 8.105V12.43a.79.79 0 0 0-.407-.685zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0l-5.843 3.369V7.012a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" fill="currentColor"/>`,
  },
  google: {
    viewBox: "0 0 24 24",
    body: `<path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" fill="currentColor"/>`,
  },
  mistral: {
    viewBox: "0 0 24 24",
    body: `<path d="M3 4h18v2H3V4zm0 5h18v2H3V9zm0 5h18v2H3v-2zm0 5h18v2H3v-2z" fill="currentColor"/>`,
  },
  synthetic: {
    viewBox: "0 0 24 24",
    body: `<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 2v20M2 12h20M5 5l14 14M19 5L5 19" stroke="currentColor" stroke-width="1"/>`,
  },
}

function ensureSprite() {
  if (spriteInserted) return
  if (typeof document === "undefined") return
  if (document.getElementById(SPRITE_ID)) {
    spriteInserted = true
    return
  }

  const body = document.body
  if (!body) return

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.id = SPRITE_ID
  svg.setAttribute("aria-hidden", "true")
  svg.setAttribute("width", "0")
  svg.setAttribute("height", "0")
  svg.style.position = "absolute"
  svg.style.overflow = "hidden"
  svg.innerHTML = Object.entries(SPRITE_DATA)
    .map(
      ([name, icon]) =>
        `<symbol id="${SYMBOL_PREFIX}${name}" viewBox="${icon.viewBox}">${icon.body}</symbol>`,
    )
    .join("")
  body.insertBefore(svg, body.firstChild)
  spriteInserted = true
}

export interface ProviderIconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  id: string
}

export function ProviderIcon({ id, className, ...rest }: ProviderIconProps) {
  const [inserted, setInserted] = useState(spriteInserted)

  useEffect(() => {
    if (!inserted) {
      ensureSprite()
      setInserted(true)
    }
  }, [inserted])

  const resolved = SPRITE_DATA[id] ? id : "synthetic"
  const viewBox = SPRITE_DATA[resolved]?.viewBox ?? "0 0 24 24"

  return (
    <svg
      data-component="provider-icon"
      viewBox={viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn(className)}
      {...rest}
    >
      <use href={`#${SYMBOL_PREFIX}${resolved}`} />
    </svg>
  )
}