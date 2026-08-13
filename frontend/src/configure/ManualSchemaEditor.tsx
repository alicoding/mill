import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, Dialog, FormControl, Heading, IconButton, Label, Select, Stack, Text, TextInput } from '@primer/react'
import { PencilIcon, PlusIcon, TrashIcon } from '@primer/octicons-react'
import { type ManualField, type ManualOperation } from './openapiSynth'
import styles from '../shared/ListCard.module.css'

// docs/adr/0011: the manual schema editor. CSV import and JSON-sample
// inference live in SchemaIntake.tsx (one intake block for every
// accelerator); loaded results land in this editor for review.
//
// Each field renders as ONE compact line -- name, type, and badges for
// whatever else is set -- with everything beyond name/type edited in a
// popup Dialog (the pencil): the previous
// two-line rows of eight inline inputs wrapped into visibly broken
// layout and buried what mattered.

const FIELD_TYPES: ManualField['type'][] = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'map', 'date', 'datetime']
const PARAM_INS: ManualField['in'][] = ['path', 'query', 'header']

function emptyParamField(): ManualField {
  return { name: '', in: 'query', type: 'string', required: false, secret: false }
}
function emptyBodyField(): ManualField {
  return { name: '', in: 'body', type: 'string', required: false, secret: false }
}

// requestMethod is the request's own top-level Method (ADR-0016 Phase
// B) -- with exactly one operation (the 1:1 model, decided directly
// with the user: a request IS one call; Duplicate the request for
// another), that operation's method IS the request's method, shown as
// read-only text instead of a second, competing Method control. There
// is deliberately no "Add operation" button: a stored multi-operation
// spec still renders fully (nothing silently dropped) with
// per-operation method and remove controls, so it can be pared down to
// 1:1, never grown.
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

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE']

function OperationEditor({ operation, singleOpMethod, onChange, onRemove }: {
  operation: ManualOperation
  singleOpMethod?: string
  onChange: (patch: Partial<ManualOperation>) => void
  onRemove?: () => void
}) {
  const { t } = useTranslation('configure')
  // Which field's advanced settings are open in the popup editor.
  const [editing, setEditing] = useState<{ list: 'input' | 'output'; index: number } | null>(null)

  const updateInputField = (i: number, patch: Partial<ManualField>) =>
    onChange({ inputFields: operation.inputFields.map((x, idx) => (idx === i ? { ...x, ...patch } : x)) })
  const removeInputField = (i: number) =>
    onChange({ inputFields: operation.inputFields.filter((_, idx) => idx !== i) })
  const updateOutputField = (i: number, patch: Partial<ManualField>) =>
    onChange({ outputFields: operation.outputFields.map((x, idx) => (idx === i ? { ...x, ...patch } : x)) })
  const removeOutputField = (i: number) =>
    onChange({ outputFields: operation.outputFields.filter((_, idx) => idx !== i) })

  const indexed = operation.inputFields.map((f, i) => ({ f, i }))
  const paramFields = indexed.filter(({ f }) => f.in !== 'body')
  const bodyFields = indexed.filter(({ f }) => f.in === 'body')

  const editingField = editing === null
    ? null
    : editing.list === 'input'
      ? operation.inputFields[editing.index]
      : operation.outputFields[editing.index]

  return (
    <div className={styles.card} data-testid="manual-operation">
      <Stack direction="horizontal" justify="space-between" align="center">
        <Stack direction="horizontal" gap="condensed" align="center">
          {singleOpMethod !== undefined ? (
            <Label variant="secondary" title={t('manualSchemaEditor.methodTooltip')}>
              {singleOpMethod}
            </Label>
          ) : (
            <Select aria-label={t('manualSchemaEditor.methodAriaLabel')} value={operation.method} onChange={(e) => onChange({ method: e.target.value })}>
              {HTTP_METHODS.map((m) => <Select.Option key={m} value={m}>{m}</Select.Option>)}
            </Select>
          )}
          {/* One-URL model: the endpoint lives entirely in the URL
              field above, so the normal single-operation case shows no
              path input at all ("base URL here + endpoint path there
              was disorienting" -- direct user feedback). A legacy
              single-op spec that carries a real path keeps an editable
              input until it's cleared; multi-op specs keep theirs
              (genuinely distinct endpoints). */}
          {(singleOpMethod === undefined || (operation.path !== '' && operation.path !== '/')) && (
            <TextInput aria-label={t('manualSchemaEditor.pathAriaLabel')} placeholder={t('manualSchemaEditor.pathPlaceholder')} value={operation.path} onChange={(e) => onChange({ path: e.target.value })} />
          )}
        </Stack>
        {onRemove && <IconButton icon={TrashIcon} aria-label={t('manualSchemaEditor.removeOperationAriaLabel')} size="small" variant="invisible" onClick={onRemove} />}
      </Stack>

      <TextInput
        aria-label={t('manualSchemaEditor.responseExtractAriaLabel')}
        placeholder={t('manualSchemaEditor.responseExtractPlaceholder')}
        value={operation.responseExtractPath ?? ''}
        onChange={(e) => onChange({ responseExtractPath: e.target.value || undefined })}
        block
      />

      <Heading as="h4" variant="small" className={styles.sectionHeading}>{t('manualSchemaEditor.inputHeading')}</Heading>
      <Text as="p" size="small" className={styles.muted}>
        {t('manualSchemaEditor.inputDescription')}
      </Text>
      <Text size="small" weight="semibold">{t('manualSchemaEditor.parameters')}</Text>
      {paramFields.map(({ f, i }) => (
        <FieldLine key={i} field={f} showIn
          onChange={(patch) => updateInputField(i, patch)}
          onEdit={() => setEditing({ list: 'input', index: i })}
          onRemove={() => removeInputField(i)}
        />
      ))}
      <Button size="small" variant="invisible" leadingVisual={PlusIcon} onClick={() => onChange({ inputFields: [...operation.inputFields, emptyParamField()] })}>
        {t('manualSchemaEditor.addParameter')}
      </Button>

      <Text size="small" weight="semibold">{t('manualSchemaEditor.requestBody')}</Text>
      {bodyFields.map(({ f, i }) => (
        <FieldLine key={i} field={f}
          onChange={(patch) => updateInputField(i, patch)}
          onEdit={() => setEditing({ list: 'input', index: i })}
          onRemove={() => removeInputField(i)}
        />
      ))}
      <Button size="small" variant="invisible" leadingVisual={PlusIcon} onClick={() => onChange({ inputFields: [...operation.inputFields, emptyBodyField()] })}>
        {t('manualSchemaEditor.addBodyField')}
      </Button>

      <Heading as="h4" variant="small" className={styles.sectionHeading}>{t('manualSchemaEditor.outputHeading')}</Heading>
      <Text as="p" size="small" className={styles.muted}>
        {t('manualSchemaEditor.outputDescription')}
      </Text>
      {operation.outputFields.map((f, i) => (
        <FieldLine key={i} field={f} isOutput
          onChange={(patch) => updateOutputField(i, patch)}
          onEdit={() => setEditing({ list: 'output', index: i })}
          onRemove={() => removeOutputField(i)}
        />
      ))}
      <Button size="small" variant="invisible" leadingVisual={PlusIcon} onClick={() => onChange({ outputFields: [...operation.outputFields, emptyBodyField()] })}>
        {t('manualSchemaEditor.addOutputField')}
      </Button>

      {editing !== null && editingField && (
        <FieldEditDialog
          field={editingField}
          isOutput={editing.list === 'output'}
          onChange={(patch) => (editing.list === 'input' ? updateInputField(editing.index, patch) : updateOutputField(editing.index, patch))}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

// One compact line per field: name + type inline (the two things
// always needed), badges for whatever else is set, and the pencil for
// the rest -- the popup editor below.
function FieldLine({ field, showIn, isOutput, onChange, onEdit, onRemove }: {
  field: ManualField
  showIn?: boolean
  isOutput?: boolean
  onChange: (patch: Partial<ManualField>) => void
  onEdit: () => void
  onRemove: () => void
}) {
  const { t } = useTranslation('configure')
  return (
    <Stack direction="horizontal" gap="condensed" align="center" data-testid="manual-field-row">
      <TextInput aria-label={t('manualSchemaEditor.fieldNameAriaLabel')} placeholder={t('manualSchemaEditor.namePlaceholder')} value={field.name} onChange={(e) => onChange({ name: e.target.value })} />
      {showIn && (
        <Select aria-label={t('manualSchemaEditor.fieldPlacementAriaLabel')} value={field.in} onChange={(e) => onChange({ in: e.target.value as ManualField['in'] })}>
          {PARAM_INS.map((v) => <Select.Option key={v} value={v}>{v}</Select.Option>)}
        </Select>
      )}
      <Select aria-label={t('manualSchemaEditor.fieldTypeAriaLabel')} value={field.type} onChange={(e) => onChange({ type: e.target.value as ManualField['type'] })}>
        {FIELD_TYPES.map((v) => <Select.Option key={v} value={v}>{v}</Select.Option>)}
      </Select>
      {field.required && <Label size="small" variant="accent">{t('required')}</Label>}
      {field.secret && <Label size="small" variant="attention">{t('secret')}</Label>}
      {field.alias && <Label size="small" variant="secondary">{t('manualSchemaEditor.aliasLabel', { alias: field.alias })}</Label>}
      {isOutput && field.extractPath && <Label size="small" variant="secondary">{t('manualSchemaEditor.pathLabel', { path: field.extractPath })}</Label>}
      {/* Not "Edit field <name>" -- getByLabel matches substrings, and
          that phrasing collides with the adjacent "Field name" input's
          own aria-label in tests and screen-reader listings alike. */}
      <IconButton icon={PencilIcon} aria-label={t('manualSchemaEditor.editFieldSettingsAriaLabel', { name: field.name || t('manualSchemaEditor.unnamed') })} size="small" variant="invisible" onClick={onEdit} data-testid="field-edit-open" />
      <IconButton icon={TrashIcon} aria-label={t('manualSchemaEditor.removeFieldAriaLabel')} size="small" variant="invisible" onClick={onRemove} />
    </Stack>
  )
}

// The popup editor for a field's full settings -- required/secret,
// alias, extract path (outputs), default, description, enum values.
// Edits apply directly to the shared operations state (the same
// onChange the inline name/type inputs use), so Close is just close --
// no separate save/cancel state to desync.
function FieldEditDialog({ field, isOutput, onChange, onClose }: {
  field: ManualField
  isOutput: boolean
  onChange: (patch: Partial<ManualField>) => void
  onClose: () => void
}) {
  const { t } = useTranslation('configure')
  return (
    <Dialog title={t('manualSchemaEditor.fieldDialogTitle', { name: field.name || t('manualSchemaEditor.unnamedParens') })} onClose={onClose} width="large" data-testid="field-edit-dialog">
      <Stack direction="vertical" gap="condensed">
        {!isOutput && (
          <FormControl>
            <Checkbox checked={field.required} onChange={(e) => onChange({ required: e.target.checked })} />
            <FormControl.Label>{t('manualSchemaEditor.required')}</FormControl.Label>
          </FormControl>
        )}
        <FormControl>
          <Checkbox checked={field.secret} onChange={(e) => onChange({ secret: e.target.checked })} />
          <FormControl.Label>{t('manualSchemaEditor.secret')}</FormControl.Label>
          <FormControl.Caption>
            {t('manualSchemaEditor.secretCaption')}
          </FormControl.Caption>
        </FormControl>
        <FormControl>
          <FormControl.Label>{t('manualSchemaEditor.alias')}</FormControl.Label>
          <FormControl.Caption>{t('manualSchemaEditor.aliasCaption')}</FormControl.Caption>
          <TextInput value={field.alias ?? ''} onChange={(e) => onChange({ alias: e.target.value || undefined })} block />
        </FormControl>
        {isOutput && (
          <FormControl>
            <FormControl.Label>{t('manualSchemaEditor.extractPath')}</FormControl.Label>
            <FormControl.Caption>{t('manualSchemaEditor.extractPathCaption')}</FormControl.Caption>
            <TextInput value={field.extractPath ?? ''} onChange={(e) => onChange({ extractPath: e.target.value || undefined })} block />
          </FormControl>
        )}
        <FormControl>
          <FormControl.Label>{t('manualSchemaEditor.defaultValue')}</FormControl.Label>
          <TextInput value={field.default ?? ''} onChange={(e) => onChange({ default: e.target.value || undefined })} block />
        </FormControl>
        <FormControl>
          <FormControl.Label>{t('manualSchemaEditor.description')}</FormControl.Label>
          <TextInput value={field.description ?? ''} onChange={(e) => onChange({ description: e.target.value || undefined })} block />
        </FormControl>
        {field.type === 'string' && (
          <FormControl>
            <FormControl.Label>{t('manualSchemaEditor.allowedValues')}</FormControl.Label>
            <FormControl.Caption>
              {t('manualSchemaEditor.allowedValuesCaption')}
            </FormControl.Caption>
            <TextInput
              value={field.enumValues?.join(', ') ?? ''}
              onChange={(e) => {
                const values = e.target.value.split(',').map((v) => v.trim()).filter((v) => v !== '')
                onChange({ enumValues: values.length > 0 ? values : undefined })
              }}
              block
            />
          </FormControl>
        )}
        <Stack direction="horizontal" gap="condensed">
          <Button variant="primary" size="small" onClick={onClose} data-testid="field-edit-done">{t('manualSchemaEditor.done')}</Button>
        </Stack>
      </Stack>
    </Dialog>
  )
}
