import Papa from 'papaparse'

// ADR-0011: the manual/CSV schema-authoring modes are alternate UIs
// over the SAME underlying representation ADR-0007 already locked
// (OpenAPI 3.x, stored verbatim in Connector.OpenAPISpec) -- not a
// second schema format. Both modes build a ManualOperation[] in memory
// and synthesizeOpenAPISpec turns that into the exact JSON string the
// existing "paste OpenAPI spec" textarea already accepts, so the
// backend (internal/adapters/openapispec, ValidateGraph's secret
// guardrail) needs zero changes -- it's already exercised by real
// tests against exactly this shape.

export interface ManualField {
  name: string
  in: 'path' | 'query' | 'header' | 'body'
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array'
  required: boolean
  secret: boolean
  // alias: a friendlier reference name shown instead of `name` in the
  // binding editors -- display-only, doesn't change wire placement.
  // extractPath: output fields only -- a dot-path into (possibly
  // nested) response JSON, e.g. "data.name"; unset means a flat
  // top-level read at `name` (today's exact existing behavior).
  alias?: string
  extractPath?: string
}

export interface ManualOperation {
  path: string
  method: string
  summary: string
  inputFields: ManualField[]
  outputFields: ManualField[]
}

// x-mill-alias/x-mill-path are OpenAPI's own standard vendor-extension
// mechanism (the x-* prefix, confirmed real and supported directly
// against kin-openapi's Schema/Parameter types, both of which expose a
// real Extensions map populated from exactly this) -- not a hack.
function fieldSchema(f: ManualField) {
  return {
    type: f.type,
    ...(f.secret ? { format: 'password' } : {}),
    ...(f.alias ? { 'x-mill-alias': f.alias } : {}),
    ...(f.extractPath ? { 'x-mill-path': f.extractPath } : {}),
  }
}

// Builds a minimal, valid OpenAPI 3.x document from a set of manually
// (or CSV-) authored operations -- mirrors openapispec.go's own
// Operation() extraction exactly in reverse: path/query/header fields
// become `parameters`, body fields become `requestBody`'s JSON schema
// properties (+ `required`), output fields become the 200 response's
// JSON schema properties. `format: "password"` is the same explicit
// secret marker openapispec.go's isSecretField already checks first,
// so a field marked secret here is guaranteed IsSecret=true downstream
// regardless of its name.
export function synthesizeOpenAPISpec(operations: ManualOperation[]): string {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const op of operations) {
    if (!op.path || !op.method) continue
    const pathItem = paths[op.path] ?? (paths[op.path] = {})

    const parameters = op.inputFields
      .filter((f) => f.in !== 'body')
      .map((f) => ({ name: f.name, in: f.in, required: f.required, schema: fieldSchema(f) }))

    const bodyFields = op.inputFields.filter((f) => f.in === 'body')
    const requestBody = bodyFields.length === 0 ? undefined : {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: Object.fromEntries(bodyFields.map((f) => [f.name, fieldSchema(f)])),
            required: bodyFields.filter((f) => f.required).map((f) => f.name),
          },
        },
      },
    }

    const outputProperties = Object.fromEntries(op.outputFields.map((f) => [f.name, fieldSchema(f)]))

    pathItem[op.method.toLowerCase()] = {
      ...(op.summary ? { summary: op.summary } : {}),
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(requestBody ? { requestBody } : {}),
      responses: {
        '200': {
          description: 'OK',
          ...(op.outputFields.length > 0
            ? { content: { 'application/json': { schema: { type: 'object', properties: outputProperties } } } }
            : {}),
        },
      },
    }
  }
  return JSON.stringify({ openapi: '3.0.3', info: { title: 'Mill connector', version: '1.0.0' }, paths }, null, 2)
}

// CSV columns: path,method,direction,name,in,type,required,secret,
// alias,extractPath -- one row per field (the "table and row" shape),
// direction is "input"|"output" so one CSV can bulk-define fields
// across multiple operations and both directions at once, not one CSV
// per operation. extractPath is named distinctly from the operation's
// own `path` column to avoid a header collision. PapaParse handles RFC
// 4180 quoting/escaping correctly (verified pick, not a hand-rolled
// split(',') -- real edge cases like a comma inside a quoted field
// would silently corrupt that).
export function parseCSVToOperations(csvText: string): { operations: ManualOperation[]; errors: string[] } {
  const result = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true })
  const errors = result.errors.map((e) => `Row ${e.row ?? '?'}: ${e.message}`)

  const byOperation = new Map<string, ManualOperation>()
  for (const row of result.data) {
    const path = row.path?.trim()
    const method = row.method?.trim().toUpperCase()
    const name = row.name?.trim()
    if (!path || !method || !name) continue

    const key = `${path} ${method}`
    let op = byOperation.get(key)
    if (!op) {
      op = { path, method, summary: '', inputFields: [], outputFields: [] }
      byOperation.set(key, op)
    }
    const field: ManualField = {
      name,
      in: (row.in?.trim() as ManualField['in']) || 'body',
      type: (row.type?.trim() as ManualField['type']) || 'string',
      required: row.required?.trim().toLowerCase() === 'true',
      secret: row.secret?.trim().toLowerCase() === 'true',
      alias: row.alias?.trim() || undefined,
      extractPath: row.extractPath?.trim() || undefined,
    }
    if (row.direction?.trim().toLowerCase() === 'output') op.outputFields.push(field)
    else op.inputFields.push(field)
  }
  return { operations: [...byOperation.values()], errors }
}
