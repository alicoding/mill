import { useState } from 'react'
import { Button, Checkbox, FormControl, Heading, IconButton, Select, Stack, Text, Textarea, TextInput } from '@primer/react'
import { PlusIcon, TrashIcon } from '@primer/octicons-react'
import { parseCSVToOperations, type ManualField, type ManualOperation } from './openapiSynth'
import styles from '../shared/ListCard.module.css'

// docs/adr/0011: the manual schema editor -- a repeatable list of
// operations, each with an input-fields table and an output-fields
// table. CSV import is an accelerator that bulk-fills this same state
// (via parseCSVToOperations), not a separate mode -- imported rows land
// here for review/editing, same as a hand-typed row would.

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const FIELD_TYPES: ManualField['type'][] = ['string', 'number', 'integer', 'boolean', 'object', 'array']
const FIELD_INS: ManualField['in'][] = ['path', 'query', 'header', 'body']

function emptyInputField(): ManualField {
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

      <Heading as="h4" variant="small" className={styles.sectionHeading}>Input fields</Heading>
      {operation.inputFields.map((f, i) => (
        <FieldRow
          key={i}
          field={f}
          showIn
          showRequired
          onChange={(patch) => onChange({ inputFields: operation.inputFields.map((x, idx) => (idx === i ? { ...x, ...patch } : x)) })}
          onRemove={() => onChange({ inputFields: operation.inputFields.filter((_, idx) => idx !== i) })}
        />
      ))}
      <Button size="small" variant="invisible" leadingVisual={PlusIcon} onClick={() => onChange({ inputFields: [...operation.inputFields, emptyInputField()] })}>
        Add input field
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

function FieldRow({ field, showIn, showRequired, showPath, onChange, onRemove }: {
  field: ManualField
  showIn?: boolean
  showRequired?: boolean
  showPath?: boolean
  onChange: (patch: Partial<ManualField>) => void
  onRemove: () => void
}) {
  return (
    <Stack direction="horizontal" gap="condensed" align="center" data-testid="manual-field-row">
      <TextInput aria-label="Field name" placeholder="name" value={field.name} onChange={(e) => onChange({ name: e.target.value })} />
      {showIn && (
        <Select aria-label="Field placement" value={field.in} onChange={(e) => onChange({ in: e.target.value as ManualField['in'] })}>
          {FIELD_INS.map((v) => <Select.Option key={v} value={v}>{v}</Select.Option>)}
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
  )
}
