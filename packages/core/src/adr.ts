/**
 * ADR (Architecture Decision Record) — MADR-format markdown generator.
 *
 * Borrowed from wshobson/agents documentation-generation/architecture-decision-records
 * skill (template structure). ADRs are numbered (ADR-NNNN) and live in a
 * docs/adr/ directory with an index README.
 *
 * Status lifecycle: Proposed → Accepted → Deprecated | Superseded | Rejected.
 *
 * This module provides:
 *   - `createADR()`: generate a single ADR markdown file
 *   - `createAdrIndex()`: generate the docs/adr/README.md index
 *   - `parseAdr()`: parse an existing ADR markdown back into structured data
 */

export type AdrStatus = "proposed" | "accepted" | "deprecated" | "superseded" | "rejected"

export interface AdrOption {
  name: string
  description: string
  pros: string[]
  cons: string[]
}

export interface AdrInput {
  /** Sequential number, e.g. 1 → ADR-0001. */
  number: number
  title: string
  status: AdrStatus
  /** The context — what forced the decision. */
  context: string
  /** Bullet list of decision drivers (free-form). */
  drivers?: string[]
  /** Options considered, with pros/cons. */
  options?: AdrOption[]
  /** The chosen option's name (must match one of the options). */
  decision: string
  /** Why this option won. */
  rationale: string
  /** Positive / Negative / Risks lists. */
  consequences?: {
    positive?: string[]
    negative?: string[]
    risks?: string[]
  }
  /** IDs of related ADRs. */
  related?: string[]
  /** External references / links. */
  references?: string[]
}

const STATUS_BADGE: Record<AdrStatus, string> = {
  proposed: "🟡 Proposed",
  accepted: "✅ Accepted",
  deprecated: "⚪ Deprecated",
  superseded: "🟣 Superseded",
  rejected: "🔴 Rejected",
}

/**
 * Render an ADR as MADR-format markdown (借鉴 wshobson/agents).
 */
export function createADR(input: AdrInput): string {
  const lines: string[] = []
  const id = `ADR-${String(input.number).padStart(4, "0")}`

  lines.push(`# ${id}: ${input.title}`, "")

  // Status block (with date if accepted)
  lines.push("## Status", "")
  lines.push(STATUS_BADGE[input.status], "")

  lines.push("## Context", "")
  lines.push(input.context, "")

  if (input.drivers && input.drivers.length > 0) {
    lines.push("## Decision Drivers", "")
    for (const d of input.drivers) lines.push(`- ${d}`)
    lines.push("")
  }

  if (input.options && input.options.length > 0) {
    lines.push("## Considered Options", "")
    for (let i = 0; i < input.options.length; i++) {
      const opt = input.options[i]!
      lines.push(`### Option ${i + 1}: ${opt.name}`, "")
      lines.push(opt.description, "")
      if (opt.pros.length > 0) {
        lines.push(`**Pros**: ${opt.pros.join("; ")}`, "")
      }
      if (opt.cons.length > 0) {
        lines.push(`**Cons**: ${opt.cons.join("; ")}`, "")
      }
    }
  }

  lines.push("## Decision", "")
  lines.push(input.decision, "")

  lines.push("## Rationale", "")
  lines.push(input.rationale, "")

  if (input.consequences) {
    lines.push("## Consequences", "")
    if (input.consequences.positive && input.consequences.positive.length > 0) {
      lines.push("### Positive", "")
      for (const c of input.consequences.positive) lines.push(`- ${c}`)
      lines.push("")
    }
    if (input.consequences.negative && input.consequences.negative.length > 0) {
      lines.push("### Negative", "")
      for (const c of input.consequences.negative) lines.push(`- ${c}`)
      lines.push("")
    }
    if (input.consequences.risks && input.consequences.risks.length > 0) {
      lines.push("### Risks", "")
      for (const c of input.consequences.risks) lines.push(`- ${c}`)
      lines.push("")
    }
  }

  if (input.related && input.related.length > 0) {
    lines.push("## Related Decisions", "")
    for (const r of input.related) lines.push(`- ADR ${r}`)
    lines.push("")
  }

  if (input.references && input.references.length > 0) {
    lines.push("## References", "")
    for (const ref of input.references) lines.push(`- ${ref}`)
    lines.push("")
  }

  return lines.join("\n")
}

/**
 * Generate the docs/adr/README.md index entry for an ADR.
 */
export function createAdrIndexEntry(input: AdrInput): string {
  const id = `ADR-${String(input.number).padStart(4, "0")}`
  return `| ${id} | [${input.title}](./${id}-${slugify(input.title)}.md) | ${STATUS_BADGE[input.status]} |`
}

/**
 * Generate the docs/adr/README.md header + the index entries.
 */
export function createAdrIndex(adrs: AdrInput[]): string {
  const lines: string[] = []
  lines.push("# Architecture Decision Records", "")
  lines.push("This directory contains the architectural decisions made on this project,", "")
  lines.push("in MADR format. See [template](./0000-template.md) for the canonical shape.", "")
  lines.push("")
  lines.push("## Index", "")
  lines.push("")
  lines.push("| ID | Title | Status |")
  lines.push("| --- | --- | --- |")
  for (const a of [...adrs].sort((x, y) => x.number - y.number)) {
    lines.push(createAdrIndexEntry(a))
  }
  return lines.join("\n") + "\n"
}

/**
 * Parse an ADR markdown file back into structured data (best-effort).
 * Recognizes the MADR-format headings emitted by `createADR`.
 */
export function parseAdr(markdown: string): Partial<AdrInput> {
  const out: Partial<AdrInput> = {}

  const idMatch = markdown.match(/^# ADR-(\d+):\s*(.+)$/m)
  if (idMatch) {
    out.number = Number(idMatch[1])
    out.title = idMatch[2] ?? ""
  }

  const statusMatch = markdown.match(/## Status\n+(.+)/m)
  if (statusMatch) {
    const raw = statusMatch[1]?.toLowerCase() ?? ""
    if (raw.includes("proposed")) out.status = "proposed"
    else if (raw.includes("accepted")) out.status = "accepted"
    else if (raw.includes("deprecated")) out.status = "deprecated"
    else if (raw.includes("superseded")) out.status = "superseded"
    else if (raw.includes("rejected")) out.status = "rejected"
  }

  const context = extractSection(markdown, "## Context")
  if (context) out.context = context

  const decision = extractSection(markdown, "## Decision")
  if (decision) out.decision = decision

  const rationale = extractSection(markdown, "## Rationale")
  if (rationale) out.rationale = rationale

  return out
}

function extractSection(md: string, heading: string): string | undefined {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(`^${escaped}\\n+([\\s\\S]*?)(?=\\n## |$)`, "m")
  const m = md.match(re)
  return m ? m[1]!.trim() : undefined
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
}