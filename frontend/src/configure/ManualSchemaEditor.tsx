import { Button, Checkbox, Heading, IconButton, Label, Select, Stack, Text, TextInput } from '@primer/react'
import { PlusIcon, TrashIcon } from '@primer/octicons-react'
import { type ManualField, type ManualOperation } from './openapiSynth'
import styles from '../shared/ListCard.module.css'

// docs/adr/0011: the manual schema editor -- a repeatable list of
// operations, each with a Parameters table, a Request body table, and
// an Output-fields table. CSV import and JSON-sample inference moved
// out of this component into SchemaIntake.tsx (one intake block for
// every accelerator, docs/SPEC.md §4's Update) -- loaded results still
// land in this same editor state for review, exactly as before; only
// where the paste/drop UI lives changed.
//
// Parameters vs. Request body is a real, separately-asked-for split
// (not a cosmetic grouping of the old single "Input fields" table):
// Parameters (path/query/header) are protocol-level -- how this
// operation is *called* over HTTP -- while the request body is the
// payload's actual shape. Conflating them into one flat table with a
// per-row placement dropdown made a param field and a body field look
// like the same kind of thing when they answer different questions.
// Output fields don't need the same split -- openapispec.Operation only
// ever populates them from a JSON response body (bodyFields() in
// openapispec.go), so every output field is payload, never protocol.

// The full set kin-openapi's PathItem struct actually recognizes
// (openapi3/path_item.go: Get/Put/Post/Delete/Options/Head/Patch/
// Trace, verified directly against its source, not assumed) --
// deliberately does NOT include RFC 10008's QUERY (published June
// 2026): OpenAPI 3.x has no spec-defined field for it yet, so an
// operation declared here has to stay representable as a real OpenAPI
// document. integration-http's own literal Method field (ADR-0016,
// composition/integration.go) is unconstrained by this and does
// support QUERY -- this list is specific to the schema-authoring path.
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE']
const FIELD_TYPES: ManualField['type'][] = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'map', 'date', 'datetime']
const FIELD_INS: ManualField['in'][] = ['path', 'query', 'header', 'body']
const PARAM_INS: ManualField['in'][] = ['path', 'query', 'header']

function emptyParamField(): ManualField {
  return { name: '', in: 'query', type: 'string', required: false, secret: false }
}
function emptyBodyField(): ManualField {
  return { name: '', in: 'body', type: 'string', required: false, secret: false }
}
function emptyOutputField(): ManualField {
  return { name: '', in: 'body', type: 'string', required: false, secret: false }
}

// requestMethod is the request's own top-level Method (ADR-0016 Phase
// B) -- with exactly one operation (the 1:1 model, decided directly
// with the user: a request IS one call; Duplicate the request for
// another), that operation's method IS the request's method, shown as
// read-only text instead of a second, competing Method control ("the
// schema should not mix those together"). There is deliberately no
// "Add operation" button anymore: a stored multi-operation spec (a
// previously pasted multi-endpoint OpenAPI document) still renders
// fully -- nothing is silently dropped -- with per-operation method and
// remove controls, so it can be pared down to 1:1, never grown.
export function ManualSchemaEditor({ operations, onChange, requestMethod }: {
  operations: ManualOperation[]
  onChange: (ops: ManualOperation[]) => void
  requestMethod?: string
}) {
  const updateOp = (i: number, patch: Partial<ManualOperation>) => {
    onChange(operations.map((op, idx) => (idx === i ? { ...op, ...patch } : op)))
  }
  const removeOp = (i: number) => onChange(operations.filter((_, idx) => idx !== i))

  return (
    <Stack direction="vertical" gap="normal" data-testid="manual-schema-editor">
      {operations.map((op, i) => (
        <OperationEditor
          key={i}
          operation={op}
          singleOpMethod={operations.length === 1 ? (requestMethod || 'GET') : undefined}
          onChange={(patch) => updateOp(i, patch)}
          onRemove={operations.length > 1 ? () => removeOp(i) : undefined}
        />
      ))}
    </Stack>
  )
}

function OperationEditor({ operation, singleOpMethod, onChange, onRemove }: {
  operation: ManualOperation
  // Set when this is the request's only operation -- its method is the
  // request's own Method, shown read-only.
  singleOpMethod?: string
  onChange: (patch: Partial<ManualOperation>) => void
  // Absent for the only operation (the 1:1 model) -- a request always
  // has exactly one; only legacy multi-operation sets can be pared down.
  onRemove?: () => void
}) {
  const updateInputField = (i: number, patch: Partial<ManualField>) =>
    onChange({ inputFields: operation.inputFields.map((x, idx) => (idx === i ? { ...x, ...patch } : x)) })
  const removeInputField = (i: number) =>
    onChange({ inputFields: operation.inputFields.filter((_, idx) => idx !== i) })

  const indexed = operation.inputFields.map((f, i) => ({ f, i }))
  const paramFields = indexed.filter(({ f }) => f.in !== 'body')
  const bodyFields = indexed.filter(({ f }) => f.in === 'body')

  return (
    <div className={styles.card} data-testid="manual-operation">
      <Stack direction="horizontal" justify="space-between" align="center">
        <Stack direction="horizontal" gap="condensed" align="center">
          {singleOpMethod !== undefined ? (
            <Label variant="secondary" title="The request's own Method (set at the top of this form) -- the schema only describes the payload, never the transport.">
              {singleOpMethod}
            </Label>
          ) : (
            <Select aria-label="Method" value={operation.method} onChange={(e) => onChange({ method: e.target.value })}>
              {HTTP_METHODS.map((m) => <Select.Option key={m} value={m}>{m}</Select.Option>)}
            </Select>
          )}
          <TextInput aria-label="Path" placeholder={singleOpMethod !== undefined ? '/ (optional endpoint path)' : '/widgets/{id}'} value={operation.path} onChange={(e) => onChange({ path: e.target.value })} />
        </Stack>
        {onRemove && <IconButton icon={TrashIcon} aria-label="Remove operation" size="small" variant="invisible" onClick={onRemove} />}
      </Stack>

      <TextInput
        aria-label="Response extract expression"
        placeholder="Response extract expression (optional, e.g. envelope.payload)"
        value={operation.responseExtractPath ?? ''}
        onChange={(e) => onChange({ responseExtractPath: e.target.value || undefined })}
        block
      />

      <Heading as="h4" variant="small" className={styles.sectionHeading}>Parameters (path / query / header)</Heading>
      <Text as="p" size="small" className={styles.muted}>
        How this operation is called over HTTP -- path segments, query string, and header values. Not part of the payload.
      </Text>
      {paramFields.map(({ f, i }) => (
        <FieldRow
          key={i}
          field={f}
          showIn
          inOptions={PARAM_INS}
          showRequired
          onChange={(patch) => updateInputField(i, patch)}
          onRemove={() => removeInputField(i)}
        />
      ))}
      <Button size="small" variant="invisible" leadingVisual={PlusIcon} onClick={() => onChange({ inputFields: [...operation.inputFields, emptyParamField()] })}>
        Add parameter
      </Button>

      <Heading as="h4" variant="small" className={styles.sectionHeading}>Request body</Heading>
      <Text as="p" size="small" className={styles.muted}>
        The JSON payload sent with this call.
      </Text>
      {bodyFields.map(({ f, i }) => (
        <FieldRow
          key={i}
          field={f}
          showRequired
          onChange={(patch) => updateInputField(i, patch)}
          onRemove={() => removeInputField(i)}
        />
      ))}
      <Button size="small" variant="invisible" leadingVisual={PlusIcon} onClick={() => onChange({ inputFields: [...operation.inputFields, emptyBodyField()] })}>
        Add body field
      </Button>

      <Heading as="h4" variant="small" className={styles.sectionHeading}>Output fields</Heading>
      {operation.outputFields.map((f, i) => (
        <FieldRow
          key={i}
          field={f}
          showPath
          onChange={(patch) => onChange({ outputFields: operation.outputFields.map((x, idx) => (idx === i ? { ...x, ...patch } : x)) })}
          onRemove={() => onChange({ outputFields: operation.outputFields.filter((_, idx) => idx !== i) })}
        />
      ))}
      <Button size="small" variant="invisible" leadingVisual={PlusIcon} onClick={() => onChange({ outputFields: [...operation.outputFields, emptyOutputField()] })}>
        Add output field
      </Button>
    </div>
  )
}

// enumValues round-trips through a plain comma-separated TextInput,
// not Primer's TextInputWithTokens -- checked directly against the
// installed package before use (per .claude/rules/frontend.md's "check
// the kit before hand-rolling" rule) and found marked @deprecated in
// this Primer version; introducing new usage of a component the
// framework itself is retiring isn't the right call for a small,
// self-contained field like this one. A comma-separated string is a
// simpler, dependency-free fit for "a short list of allowed values."
function parseEnumInput(raw: string): string[] | undefined {
  const values = raw.split(',').map((v) => v.trim()).filter((v) => v !== '')
  return values.length > 0 ? values : undefined
}

function FieldRow({ field, showIn, inOptions = FIELD_INS, showRequired, showPath, onChange, onRemove }: {
  field: ManualField
  showIn?: boolean
  inOptions?: ManualField['in'][]
  showRequired?: boolean
  showPath?: boolean
  onChange: (patch: Partial<ManualField>) => void
  onRemove: () => void
}) {
  return (
    <Stack direction="vertical" gap="condensed" data-testid="manual-field-row">
      <Stack direction="horizontal" gap="condensed" align="center">
        <TextInput aria-label="Field name" placeholder="name" value={field.name} onChange={(e) => onChange({ name: e.target.value })} />
        {showIn && (
          <Select aria-label="Field placement" value={field.in} onChange={(e) => onChange({ in: e.target.value as ManualField['in'] })}>
            {inOptions.map((v) => <Select.Option key={v} value={v}>{v}</Select.Option>)}
          </Select>
        )}
        <Select aria-label="Field type" value={field.type} onChange={(e) => onChange({ type: e.target.value as ManualField['type'] })}>
          {FIELD_TYPES.map((v) => <Select.Option key={v} value={v}>{v}</Select.Option>)}
        </Select>
        {showRequired && (
          <label>
            <Checkbox checked={field.required} onChange={(e) => onChange({ required: e.target.checked })} /> required
          </label>
        )}
        <label>
          <Checkbox checked={field.secret} onChange={(e) => onChange({ secret: e.target.checked })} /> secret
        </label>
        <TextInput aria-label="Alias" placeholder="alias (optional)" value={field.alias ?? ''} onChange={(e) => onChange({ alias: e.target.value || undefined })} />
        {showPath && (
          <TextInput aria-label="Extract path" placeholder="data.name (optional)" value={field.extractPath ?? ''} onChange={(e) => onChange({ extractPath: e.target.value || undefined })} />
        )}
        <IconButton icon={TrashIcon} aria-label="Remove field" size="small" variant="invisible" onClick={onRemove} />
      </Stack>
      <Stack direction="horizontal" gap="condensed" align="center">
        <TextInput aria-label="Default value" placeholder="default (optional)" value={field.default ?? ''} onChange={(e) => onChange({ default: e.target.value || undefined })} />
        <TextInput aria-label="Description" placeholder="description (optional)" value={field.description ?? ''} onChange={(e) => onChange({ description: e.target.value || undefined })} />
        {field.type === 'string' && (
          <TextInput
            aria-label="Enum values"
            placeholder="allowed values, comma-separated (optional)"
            value={field.enumValues?.join(', ') ?? ''}
            onChange={(e) => onChange({ enumValues: parseEnumInput(e.target.value) })}
            block
          />
        )}
      </Stack>
    </Stack>
  )
}
