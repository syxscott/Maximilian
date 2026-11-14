// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Lightweight JSON-Schema subset validator (borrowing MiniMax-Provider-
 * Verifier `validator/tool_calls.py`, which uses the `jsonschema` package).
 *
 * Selection rationale: zero-dependency on purpose. The only schemas this
 * module must handle are the tool parameter schemas declared in THIS
 * repository — flat structural objects using `type` / `properties` /
 * `required` / `items` / `enum` / `additionalProperties`. Pulling `ajv` or
 * `jsonschema` into the pnpm workspace for that surface would add a
 * dependency (and an install step) for a tripwire check that is not a
 * security boundary; the ~80 lines below cover exactly the declared
 * keyword set and fail closed (unknown keywords are ignored, structural
 * mismatches reject). If tool schemas ever grow `$ref`/`allOf`/pattern
 * keywords, swap this module for a real schema library.
 */

import type { JsonSchemaObject } from "./types.js"

export interface SchemaIssue {
  /** Dotted path inside the validated instance ("" = root). */
  path: string
  message: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function typeOf(value: unknown): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  if (typeof value === "number") return "number"
  if (typeof value === "string") return "string"
  if (typeof value === "boolean") return "boolean"
  return "object"
}

/** Python `isinstance(x, bool)` is `int` — mirror JSON-Schema: boolean is not number. */
function matchesType(value: unknown, type: string): boolean {
  const actual = typeOf(value)
  if (type === "number" && actual === "integer") return true
  return actual === type
}

/**
 * Validate `instance` against `schema`. Returns all issues found (empty =
 * valid). Unknown schema keywords are ignored; a schema that is not an
 * object (or declares an unknown `type`) rejects the instance — fail
 * closed so a malformed tool definition surfaces instead of silently
 * passing.
 */
export function validateAgainstSchema(
  instance: unknown,
  schema: JsonSchemaObject | undefined,
): SchemaIssue[] {
  if (!isRecord(schema)) {
    return [{ path: "", message: "tool schema is missing or not an object" }]
  }
  const declaredType = schema["type"]
  if (typeof declaredType !== "string") {
    // Schema without a type keyword: only structural keywords can apply.
    return collectIssues(instance, schema, "")
  }
  if (!SCHEMA_TYPES.has(declaredType)) {
    return [{ path: "", message: `unsupported schema type "${declaredType}"` }]
  }
  if (!matchesType(instance, declaredType)) {
    return [{ path: "", message: `expected type ${declaredType}, got ${typeOf(instance)}` }]
  }
  return collectIssues(instance, schema, "")
}

const SCHEMA_TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"])

function collectIssues(instance: unknown, schema: JsonSchemaObject, path: string): SchemaIssue[] {
  const issues: SchemaIssue[] = []

  // enum applies to any instance type.
  if (Array.isArray(schema["enum"]) && !schema["enum"].some((v) => v === instance)) {
    issues.push({ path, message: `value not in enum [${schema["enum"].join(", ")}]` })
  }

  const declaredType = typeof schema["type"] === "string" ? schema["type"] : undefined

  if (declaredType === "object" || (declaredType === undefined && isRecord(instance))) {
    issues.push(...objectIssues(instance, schema, path))
  }
  if (declaredType === "array" || (declaredType === undefined && Array.isArray(instance))) {
    issues.push(...arrayIssues(instance, schema, path))
  }
  return issues
}

function objectIssues(instance: unknown, schema: JsonSchemaObject, path: string): SchemaIssue[] {
  const issues: SchemaIssue[] = []
  if (!isRecord(instance)) return issues

  const properties = isRecord(schema["properties"])
    ? (schema["properties"] as Record<string, JsonSchemaObject>)
    : undefined
  const required = Array.isArray(schema["required"]) ? (schema["required"] as string[]) : []

  for (const key of required) {
    if (!(key in instance)) {
      issues.push({ path, message: `missing required property "${key}"` })
    }
  }

  if (properties) {
    for (const [key, value] of Object.entries(instance)) {
      const propertySchema = properties[key]
      if (!propertySchema) {
        if (schema["additionalProperties"] === false) {
          issues.push({ path, message: `unexpected property "${key}"` })
        }
        continue
      }
      issues.push(...validateAgainstSchema(value, propertySchema).map(qualify(path, key)))
    }
  }
  return issues
}

function arrayIssues(instance: unknown, schema: JsonSchemaObject, path: string): SchemaIssue[] {
  const issues: SchemaIssue[] = []
  if (!Array.isArray(instance)) return issues

  const items = isRecord(schema["items"]) ? (schema["items"] as JsonSchemaObject) : undefined
  if (!items) return issues
  instance.forEach((item, idx) => {
    issues.push(
      ...validateAgainstSchema(item, items).map((i) => ({
        path: `${path}[${idx}]`,
        message: i.message,
      })),
    )
  })
  return issues
}

function qualify(parent: string, key: string) {
  return (issue: SchemaIssue) => ({
    path: parent === "" ? key : `${parent}.${key}`,
    message: issue.message,
  })
}

/** One-line rendering for validator fields. */
export function summarizeSchemaIssues(issues: SchemaIssue[]): string {
  return issues.map((i) => (i.path === "" ? i.message : `${i.path}: ${i.message}`)).join("; ")
}
