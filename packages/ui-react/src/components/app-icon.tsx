import { useEffect, useState, type ImgHTMLAttributes } from "react"
import { cn } from "../lib/utils"

export type AppIconName =
  | "vscode"
  | "cursor"
  | "zed"
  | "file-explorer"
  | "finder"
  | "terminal"
  | "iterm2"
  | "ghostty"
  | "warp"
  | "xcode"
  | "android-studio"
  | "antigravity"
  | "textmate"
  | "powershell"
  | "sublime-text"

const ICONS: Record<AppIconName, string> = {
  vscode: "/icons/app/vscode.svg",
  cursor: "/icons/app/cursor.svg",
  zed: "/icons/app/zed.svg",
  "file-explorer": "/icons/app/file-explorer.svg",
  finder: "/icons/app/finder.png",
  terminal: "/icons/app/terminal.png",
  iterm2: "/icons/app/iterm2.svg",
  ghostty: "/icons/app/ghostty.svg",
  warp: "/icons/app/warp.png",
  xcode: "/icons/app/xcode.png",
  "android-studio": "/icons/app/android-studio.svg",
  antigravity: "/icons/app/antigravity.svg",
  textmate: "/icons/app/textmate.png",
  powershell: "/icons/app/powershell.svg",
  "sublime-text": "/icons/app/sublimetext.svg",
}

const THEMED: Partial<Record<AppIconName, { light: string; dark: string }>> = {
  zed: {
    light: "/icons/app/zed.svg",
    dark: "/icons/app/zed-dark.svg",
  },
}

function getScheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light"
  if (document.documentElement.dataset.colorScheme === "dark") return "dark"
  return "light"
}

export interface AppIconProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  id: AppIconName
}

export function AppIcon({ id, alt = "", className, draggable = false, ...rest }: AppIconProps) {
  const [mode, setMode] = useState<"light" | "dark">(getScheme)

  useEffect(() => {
    if (typeof document === "undefined") return
    const sync = () => setMode(getScheme())
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-color-scheme"],
    })
    sync()
    return () => observer.disconnect()
  }, [])

  const themed = THEMED[id]
  const src = themed ? themed[mode] : ICONS[id]

  return (
    <img
      data-component="app-icon"
      src={src}
      alt={alt}
      draggable={draggable}
      className={cn(className)}
      {...rest}
    />
  )
}