import { createSchema } from 'genson-js'
import type { ManualField } from './openapiSynth'

// docs/SPEC.md §4.1: "Paste sample" -- infer a field list from a real
// example JSON value, a fourth ManualSchemaEditor accelerator alongside
// Paste-OpenAPI/Manual/CSV. Scoped to body fields only (in: 'body') --
// a flat JSON sample has no way to say "this key is actually a path
// segment or a query parameter," so guessing HTTP placement from it
// would be exactly the kind of guess this codebase's own discipline
// avoids; a user pastes a *payload* sample, gets payload fields, and
// still authors path/query/header parameters by hand (they're rare
// and few compared to a body's field count anyway).
const TYPE_MAP: Record<string, ManualField['type']> = {
  boolean: 'boolean',
  integer: 'integer',
  number: 'number',
  string: 'string',
  object: 'object',
  array: 'array',
}

export function inferFieldsFromSample(jsonText: string): { fields: ManualField[]; error: string } {
  let value: unknown
  try {
    value = JSON.parse(jsonText)
  } catch {
    return { fields: [], error: 'Not valid JSON.' }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { fields: [], error: 'Paste a JSON object (e.g. {"name": "..."}), not an array or a bare value.' }
  }

  const schema = createSchema(value)
  if (!schema.properties) {
    return { fields: [], error: 'No fields found in the pasted sample.' }
  }
  const required = new Set(schema.required ?? [])
  const fields: ManualField[] = Object.entries(schema.properties).map(([name, propSchema]) => {
    const t = Array.isArray(propSchema.type) ? propSchema.type[0] : propSchema.type
    return {
      name,
      in: 'body',
      type: TYPE_MAP[t ?? 'string'] ?? 'string',
      required: required.has(name),
      secret: false,
    }
  })
  return { fields, error: '' }
}
