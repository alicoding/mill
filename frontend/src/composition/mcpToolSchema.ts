// Turns an MCP tool's raw JSON-Schema inputSchema (mcpclient.Tool's
// InputSchema, docs/SPEC.md §3.6) into the small typed shape
// MCPToolArgsEditor.tsx renders one control per field from -- pure,
// tolerant of junk (a tool declaring no schema, or a malformed one,
// should degrade to "no typed fields" rather than throw and take the
// Inspector down with it, same defensive posture as configSchema.ts's
// own generateSamplePayload).

export type ToolSchemaFieldType = 'string' | 'number' | 'boolean' | 'enum' | 'json'

export interface ToolSchemaField {
  name: string
  type: ToolSchemaFieldType
  required: boolean
  description?: string
  enumValues?: string[]
}

interface JSONSchemaProperty {
  type?: string
  description?: string
  enum?: unknown[]
}

function fieldTypeFor(prop: JSONSchemaProperty): ToolSchemaFieldType {
  if (Array.isArray(prop.enum) && prop.enum.length > 0) return 'enum'
  switch (prop.type) {
    case 'string':
      return 'string'
    case 'number':
    case 'integer':
      return 'number'
    case 'boolean':
      return 'boolean'
    default:
      // object/array/missing-type/anything else -- no per-field control
      // makes sense for these, they fall to the raw-JSON fallback.
      return 'json'
  }
}

export function parseToolInputSchema(schema: unknown): ToolSchemaField[] {
  if (typeof schema !== 'object' || schema === null) return []
  const properties = (schema as { properties?: unknown }).properties
  if (typeof properties !== 'object' || properties === null) return []

  const requiredRaw = (schema as { required?: unknown }).required
  const required = new Set(Array.isArray(requiredRaw) ? requiredRaw.filter((r): r is string => typeof r === 'string') : [])

  return Object.entries(properties as Record<string, unknown>).map(([name, raw]) => {
    const prop = (typeof raw === 'object' && raw !== null ? raw : {}) as JSONSchemaProperty
    const field: ToolSchemaField = {
      name,
      type: fieldTypeFor(prop),
      required: required.has(name),
    }
    if (typeof prop.description === 'string') field.description = prop.description
    if (field.type === 'enum') {
      field.enumValues = (prop.enum ?? []).filter((v): v is string => typeof v === 'string')
    }
    return field
  })
}
