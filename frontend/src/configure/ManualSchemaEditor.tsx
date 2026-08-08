import { useState } from 'react'
import { Button, Checkbox, FormControl, Heading, IconButton, Select, Stack, Text, Textarea, TextInput } from '@primer/react'
import { PlusIcon, TrashIcon } from '@primer/octicons-react'
import { parseCSVToOperations, type ManualField, type ManualOperation } from './openapiSynth'
import { inferFieldsFromSample } from './pasteSample'
import styles from '../shared/ListCard.module.css'

// docs/adr/0011: the manual schema editor -- a repeatable list of
// operations, each with a Parameters table, a Request body table, and
// an Output-fields table. CSV import is an accelerator that bulk-fills
// this same state (via parseCSVToOperations), not a separate mode --
// imported rows land here for review/editing, same as a hand-typed row
// would.
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

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
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
function emptyOperation(): ManualOperation {
  return { path: '', method: 'GET', summary: '', inputFields: [], outputFields: [] }
}

export function ManualSchemaEditor({ operations, onChange }: { operations: ManualOperation[]; onChange: (ops: ManualOperation[]) => void }) {
  const [csvText, setCsvText] = useState('')
  const [csvErrors, setCsvErrors] = useState<string[]>([])

  const updateOp = (i: number, patch: Partial<ManualOperation>) => {
    onChange(operations.map((op, idx) => (idx === i ? { ...op, ...patch } : op)))
  }
  const removeOp = (i: number) => onChange(operations.filter((_, idx) => idx !== i))
  const addOp = () => onChange([...operations, emptyOperation()])

  const importCSV = () => {
    const { operations: imported, errors } = parseCSVToOperations(csvText)
    setCsvErrors(errors)
    if (imported.length > 0) onChange(imported)
  }

  return (
    <Stack direction="vertical" gap="normal" data-testid="manual-schema-editor">
      <FormControl>
        <FormControl.Label>Import from CSV</FormControl.Label>
        <FormControl.Caption>
          Columns: path,method,direction,name,in,type,required,secret,alias,extractPath (direction is
          &quot;input&quot; or &quot;output&quot;). Replaces the operations below with what the CSV
          declares -- review and adjust here after importing.
        </FormControl.Caption>
        <Textarea value={csvText} onChange={(e) => setCsvText(e.target.value)} rows={3} block data-testid="csv-import-text" />
        <Button size="small" variant="invisible" onClick={importCSV} data-testid="import-csv">Import CSV</Button>
        {csvErrors.map((e) => (
          <Text as="p" key={e} size="small" className={styles.error}>{e}</Text>
        ))}
      </FormControl>

      {operations.map((op, i) => (
        <OperationEditor key={i} operation={op} onChange={(patch) => updateOp(i, patch)} onRemove={() => removeOp(i)} />
      ))}
      <Button size="small" variant="invisible" leadingVisual={PlusIcon} onClick={addOp} data-testid="add-operation">
        Add operation
      </Button>
    </Stack>
  )
}

function OperationEditor({ operation, onChange, onRemove }: {
  operation: ManualOperation
  onChange: (patch: Partial<ManualOperation>) => void
  onRemove: () => void
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
        <Stack direction="horizontal" gap="condensed">
          <Select aria-label="Method" value={operation.method} onChange={(e) => onChange({ method: e.target.value })}>
            {HTTP_METHODS.map((m) => <Select.Option key={m} value={m}>{m}</Select.Option>)}
          </Select>
          <TextInput aria-label="Path" placeholder="/widgets/{id}" value={operation.path} onChange={(e) => onChange({ path: e.target.value })} />
        </Stack>
        <IconButton icon={TrashIcon} aria-label="Remove operation" size="small" variant="invisible" onClick={onRemove} />
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
      <Stack direction="horizontal" gap="condensed">
        <Button size="small" variant="invisible" leadingVisual={PlusIcon} onClick={() => onChange({ inputFields: [...operation.inputFields, emptyBodyField()] })}>
          Add body field
        </Button>
        <PasteSampleControl onFields={(fields) => onChange({ inputFields: [...operation.inputFields, ...fields] })} />
      </Stack>

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
      <Stack direction="horizontal" gap="condensed">
        <Button size="small" variant="invisible" leadingVisual={PlusIcon} onClick={() => onChange({ outputFields: [...operation.outputFields, emptyOutputField()] })}>
          Add output field
        </Button>
        <PasteSampleControl onFields={(fields) => onChange({ outputFields: [...operation.outputFields, ...fields] })} />
      </Stack>
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

// docs/SPEC.md §4.1: "Paste sample" -- a fourth ManualSchemaEditor
// accelerator (Paste-OpenAPI/Manual/CSV already exist, ADR-0011) that
// infers body fields from a real example JSON value instead of typing
// each field by hand. Appends to whatever fields already exist rather
// than replacing them (unlike CSV import, which replaces the whole
// operations list) -- this is scoped to one section of one operation,
// where destructively wiping existing rows would be more surprising
// than helpful.
function PasteSampleControl({ onFields }: { onFields: (fields: ManualField[]) => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState('')

  const infer = () => {
    const { fields, error: err } = inferFieldsFromSample(text)
    if (err) {
      setError(err)
      return
    }
    onFields(fields)
    setText('')
    setError('')
    setOpen(false)
  }

  if (!open) {
    return (
      <Button size="small" variant="invisible" onClick={() => setOpen(true)} data-testid="paste-sample-toggle">
        Paste sample
      </Button>
    )
  }
  return (
    <Stack direction="vertical" gap="condensed">
      <Textarea
        aria-label="Sample JSON value"
        placeholder={'{"name": "Ada", "age": 36}'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        data-testid="paste-sample-text"
      />
      {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}
      <Stack direction="horizontal" gap="condensed">
        <Button size="small" onClick={infer} data-testid="paste-sample-infer">Infer fields</Button>
        <Button size="small" variant="invisible" onClick={() => { setOpen(false); setText(''); setError('') }}>Cancel</Button>
      </Stack>
    </Stack>
  )
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
