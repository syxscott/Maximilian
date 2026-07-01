import React from "react"
export interface IconProps { name?: string; size?: number; className?: string; [key: string]: unknown }
export function Icon({ name, size = 16, className }: IconProps) {
  return <span className={className} style={{ fontSize: size }}>{name}</span>
}
export default Icon
