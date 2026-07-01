import React from "react"
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> { variant?: string }
export function Badge({ variant, className, children, ...props }: BadgeProps) {
  return <span className={className} {...props}>{children}</span>
}
export default Badge
