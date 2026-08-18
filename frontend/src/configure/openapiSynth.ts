import Papa from 'papaparse'

// ADR-0011: the manual/CSV schema-authoring modes are alternate UIs
// over the SAME underlying representation ADR-0007 already locked
// (OpenAPI 3.x, stored verbatim in HTTPRequest.OpenAPISpec) -- not a
// second schema format. Both modes build a ManualOperation[] in memory
// and synthesizeOpenAPISpec turns that into the exact JSON string the
// existing "paste OpenAPI spec" textarea already accepts, so the
// backend (internal/adapters/openapispec, ValidateGraph's secret
// guardrail) needs zero changes -- it's already exercised by real
// tests against exactly this shape.

export interface ManualField {
  name: string
  in: 'path' | 'query' | 'header' | 'body'
  // "map"/"date"/"datetime" (docs/SPEC.md §4.1) aren't real OpenAPI
  // `type` values -- OpenAPI has no dedicated map type (the standard
  // idiom is `type: object` + `additionalProperties`, no fixed
  // `properties`) and date/datetime are `type: string` + a `format`,
  // not a type of their own. fieldSchema() below translates these three
  // into their real OpenAPI shape at synthesis time; ManualField keeps
  // the friendlier flat vocabulary Mill's own Field.Type already uses.
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'map' | 'date' | 'datetime'
  required: boolean
  secret: boolean
  // alias: a friendlier reference name shown instead of `name` in the
  // binding editors -- display-only, doesn't change wire placement.
  // extractPath: output fields only -- a dot-path into (possibly
  // nested) response JSON, e.g. "data.name"; unset means a flat
  // top-level read at `name` (today's exact existing behavior).
  alias?: string
  extractPath?: string
  // default/description/enumValues (docs/SPEC.md §4.1): OpenAPI's own
  // standard `default`/`description`/`enum` keywords, no x-mill-*
  // vendor extension needed (unlike alias/extractPath, which have no
  // OpenAPI-standard equivalent). default is always synthesized as a
  // JSON string -- Mill's own config/binding values are uniformly
  // strings on the wire regardless of declared Type (the same
  // convention Node.Config/runInput.Values already use), not
  // type-coerced into a JSON number/boolean.
  default?: string
  description?: string
  enumValues?: string[]
}

export interface ManualOperation {
  path: string
  method: string
  summary: string
  inputFields: ManualField[]
  outputFields: ManualField[]
  // responseExtractPath (docs/SPEC.md §4.1): a document-level root
  // extraction applied to the whole response before any field's own
  // extractPath -- operation-scoped, not per-field, hence living here
  // rather than on ManualField. Synthesized as the
  // x-mill-response-extract-path vendor extension on the operation
  // object itself.
  responseExtractPath?: string
}

// x-mill-alias/x-mill-path/x-mill-response-extract-path are OpenAPI's
// own standard vendor-extension mechanism (the x-* prefix, confirmed
// real and supported directly against kin-openapi's Schema/Parameter/
// Operation types, all of which expose a real Extensions map populated
// from exactly this) -- not a hack.
function fieldSchema(f: ManualField) {
  const typeShape: Record<string, unknown> = f.type === 'map'
    ? { type: 'object', additionalProperties: true }
    : f.type === 'date'
      ? { type: 'string', format: 'date' }
      : f.type === 'datetime'
        ? { type: 'string', format: 'date-time' }
        : { type: f.type }
  return {
    ...typeShape,
    ...(f.secret ? { format: 'password' } : {}),
    ...(f.default !== undefined && f.default !== '' ? { default: f.default } : {}),
    ...(f.description ? { description: f.description } : {}),
    ...(f.enumValues && f.enumValues.length > 0 ? { enum: f.enumValues } : {}),
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
      ...(op.responseExtractPath ? { 'x-mill-response-extract-path': op.responseExtractPath } : {}),
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
  return JSON.stringify({ openapi: '3.0.3', info: { title: 'Mill request', version: '1.0.0' }, paths }, null, 2)
}

// CSV columns: path,method,direction,name,in,type,required,secret,
// alias,extractPath,default,description -- one row per field (the
// "table and row" shape), direction is "input"|"output" so one CSV can
// bulk-define fields across multiple operations and both directions at
// once, not one CSV per operation. extractPath is named distinctly
// from the operation's own `path` column to avoid a header collision.
// PapaParse handles RFC 4180 quoting/escaping correctly (verified pick,
// not a hand-rolled split(',') -- real edge cases like a comma inside a
// quoted field would silently corrupt that). enumValues and the
// operation-level responseExtractPath are deliberately NOT CSV columns
// -- an enum list has no natural single-cell representation without
// inventing a delimiter convention, and responseExtractPath is
// operation-scoped, not a per-field-row concept CSV's shape fits;
// both stay Manual-editor-only, not silently dropped, just out of
// this accelerator's stated scope.
export function parseCSVToOperations(t: (key: string, opts?: Record<string, unknown>) => string, csvText: string): { operations: ManualOperation[]; errors: string[] } {
  const result = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true })
  const errors = result.errors.map((e) => t('openapiSynth.csvRowError', { row: e.row ?? '?', message: e.message }))

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
      default: row.default?.trim() || undefined,
      description: row.description?.trim() || undefined,
    }
    if (row.direction?.trim().toLowerCase() === 'output') op.outputFields.push(field)
    else op.inputFields.push(field)
  }
  return { operations: [...byOperation.values()], errors }
}

const HTTP_METHOD_KEYS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace', 'connect']

interface JSONSchemaLike {
  type?: string
  format?: string
  properties?: Record<string, JSONSchemaLike>
  required?: string[]
  default?: unknown
  description?: string
  enum?: unknown[]
  additionalProperties?: boolean | JSONSchemaLike
  'x-mill-alias'?: string
  'x-mill-path'?: string
}

// Reverse of fieldSchema()'s type translation: "object with
// additionalProperties and no fixed properties" -> "map",
// "string + format:date/date-time" -> "date"/"datetime", everything
// else passes through as-is.
function manualFieldType(schema: JSONSchemaLike): ManualField['type'] {
  if (schema.type === 'string') {
    if (schema.format === 'date') return 'date'
    if (schema.format === 'date-time') return 'datetime'
    return 'string'
  }
  if (schema.type === 'object' && !schema.properties && schema.additionalProperties) {
    return 'map'
  }
  return (schema.type as ManualField['type']) ?? 'string'
}

function fieldFromSchema(name: string, schema: JSONSchemaLike, placement: ManualField['in'], required: boolean): ManualField {
  return {
    name,
    in: placement,
    type: manualFieldType(schema),
    required,
    secret: schema.format === 'password',
    alias: schema['x-mill-alias'],
    extractPath: schema['x-mill-path'],
    default: schema.default !== undefined ? String(schema.default) : undefined,
    description: schema.description || undefined,
    enumValues: schema.enum && schema.enum.length > 0 ? schema.enum.map(String) : undefined,
  }
}

// Best-effort reverse of synthesizeOpenAPISpec -- lets a pasted (or
// previously saved) OpenAPI document be reviewed/edited in the same
// Manual editor table (docs/adr/0011: "if you started as csv or json
// you will be able to review it using the editor"). Deliberately
// bounded, named in the ADR: round-trips cleanly only what the table
// itself could have produced (flat parameters + a flat JSON object
// body/response) -- oneOf/allOf, deeply nested arrays-of-objects, or
// non-JSON media types are silently skipped rather than guessed at.
// JSON only (no YAML) -- this runs in the browser with no YAML parser
// adopted for it; paste JSON, or keep editing via the raw-text mode.
// eslint-disable-next-line sonarjs/cognitive-complexity -- legacy complexity grandfathered at gate adoption; pay down when touched (goal 0109 burn-down)
export function parseOpenAPIToOperations(t: (key: string, opts?: Record<string, unknown>) => string, specText: string): { operations: ManualOperation[]; errors: string[] } {
  let doc: { paths?: Record<string, Record<string, unknown>> }
  try {
    doc = JSON.parse(specText)
  } catch {
    return { operations: [], errors: [t('openapiSynth.notValidJsonSwitchBack')] }
  }
  const operations: ManualOperation[] = []
  for (const [path, pathItem] of Object.entries(doc.paths ?? {})) {
    for (const method of HTTP_METHOD_KEYS) {
      const op = pathItem[method] as {
        summary?: string
        'x-mill-response-extract-path'?: string
        parameters?: { name: string; in: string; required?: boolean; schema?: JSONSchemaLike }[]
        requestBody?: { content?: { 'application/json'?: { schema?: JSONSchemaLike } } }
        responses?: Record<string, { content?: { 'application/json'?: { schema?: JSONSchemaLike } } }>
      } | undefined
      if (!op) continue

      const inputFields: ManualField[] = (op.parameters ?? []).map((p) =>
        fieldFromSchema(p.name, p.schema ?? {}, p.in as ManualField['in'], p.required ?? false))

      const bodySchema = op.requestBody?.content?.['application/json']?.schema
      if (bodySchema?.properties) {
        const required = new Set(bodySchema.required ?? [])
        for (const [name, propSchema] of Object.entries(bodySchema.properties)) {
          inputFields.push(fieldFromSchema(name, propSchema, 'body', required.has(name)))
        }
      }

      const outputFields: ManualField[] = []
      const respSchema = op.responses?.['200']?.content?.['application/json']?.schema
      if (respSchema?.properties) {
        for (const [name, propSchema] of Object.entries(respSchema.properties)) {
          outputFields.push(fieldFromSchema(name, propSchema, 'body', false))
        }
      }

      operations.push({
        path, method: method.toUpperCase(), summary: op.summary ?? '', inputFields, outputFields,
        responseExtractPath: op['x-mill-response-extract-path'] || undefined,
      })
    }
  }
  return { operations, errors: [] }
}
