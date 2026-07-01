import { useMemo, type HTMLAttributes } from "react"
import { cn } from "../lib/utils"

export interface DiffChangesSingle {
  additions: number
  deletions: number
}

export interface DiffChangesProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  changes: DiffChangesSingle | DiffChangesSingle[]
}

export function DiffChanges({ changes, className, ...rest }: DiffChangesProps) {
  const { additions, deletions, total } = useMemo(() => {
    const list = Array.isArray(changes) ? changes : [changes]
    const adds = list.reduce((acc, d) => acc + (d.additions ?? 0), 0)
    const dels = list.reduce((acc, d) => acc + (d.deletions ?? 0), 0)
    return { additions: adds, deletions: dels, total: adds + dels }
  }, [changes])

  if (total <= 0) return null

  return (
    <div data-component="diff-changes" className={cn(className)} {...rest}>
      <span data-slot="diff-changes-additions" className="text-green-600">
        +{additions}
      </span>
      <span data-slot="diff-changes-deletions" className="text-red-600">
        -{deletions}
      </span>
    </div>
  )
}