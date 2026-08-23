import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Dialog, FormControl, Select, Stack, Text, TextInput } from '@primer/react'
import { FileIcon } from '@primer/octicons-react'
import type { Field } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import { Type as FieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import type { List } from '../../bindings/github.com/alicoding/mill/internal/domain/list/models'
import { ConfigureService } from '../shared/bindings'
import { nextColumnKey } from '../shared/projectionColumns'
import { inferListSchema, parseUploadedFile, type InferredField, type ParsedFile } from './listRowImportParse'
import styles from '../shared/ListCard.module.css'

// Configure > Lists' "New from file…" (docs/goals/0131, the schema
// half of import): a CSV/JSON sample proposes a typed schema
// (listRowImportParse.ts's inferListSchema), the user edits the
// proposal (labels, types) in place, and one confirm creates the list
// and imports every row through the same AddListRow path the row
// importer already uses -- one core, two surfaces.
export function NewListFromFile({ onCreated }: { onCreated: (l: List) => void }) {
  const { t } = useTranslation('configure')
  const inputRef = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<ParsedFile | null>(null)
  const [fields, setFields] = useState<InferredField[]>([])
  const [label, setLabel] = useState('')
  const [error, setError] = useState('')
  const [dialogError, setDialogError] = useState('')
  const [busy, setBusy] = useState(false)

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    parseUploadedFile(file).then((p) => {
      setParsed(p)
      setFields(inferListSchema(p, nextColumnKey))
      setLabel(file.name.replace(/\.[^.]+$/, ''))
      setError('')
      setDialogError('')
    }).catch((err) => setError(String(err)))
  }

  const close = () => {
    setParsed(null)
    setFields([])
  }

  const setField = (i: number, patch: Partial<InferredField>) => {
    setFields((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))
  }

  const confirm = async () => {
    if (!parsed) return
    setBusy(true)
    setDialogError('')
    try {
      const columns: Field[] = fields.map((f) => ({
        Key: f.key, Label: f.label.trim() || f.key, Type: f.type,
        Options: f.type === FieldType.TypeOptions ? f.options : null,
        Required: false, Default: '', Description: '',
        Suggestions: null, Secret: false, RefKind: '', Multiline: false, SystemManaged: false,
      }))
      const created = await ConfigureService.CreateList(label.trim() || t('configureLists.fromFile.defaultLabel'), '', columns)
      for (const row of parsed.rows) {
        const values: Record<string, string> = {}
        fields.forEach((f, i) => {
          values[f.key] = row[parsed.fileColumns[i]] ?? ''
        })
        await ConfigureService.AddListRow(created.ID, values)
      }
      const final = await ConfigureService.GetList(created.ID)
      close()
      onCreated(final)
    } catch (err) {
      setDialogError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const typeLabel: Record<string, string> = {
    [FieldType.TypeText]: t('configureLists.fromFile.typeText'),
    [FieldType.TypeNumber]: t('configureLists.fromFile.typeNumber'),
    [FieldType.TypeBoolean]: t('configureLists.fromFile.typeBoolean'),
    [FieldType.TypeOptions]: t('configureLists.fromFile.typeOptions'),
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.json,.xlsx,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        data-testid="new-list-from-file-input"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
      <Button leadingVisual={FileIcon} size="small" data-testid="new-list-from-file" onClick={() => { setError(''); inputRef.current?.click() }}>
        {t('configureLists.fromFile.button')}
      </Button>
      {error && <Text as="p" size="small" className={styles.error} data-testid="new-list-from-file-error">{error}</Text>}

      {parsed && (
        // data-component, not data-testid: Dialog only forwards its own
        // special-cased "data-component" prop (AtlasCardOverlay.tsx's
        // own comment has the full reasoning).
        <Dialog
          title={t('configureLists.fromFile.dialogTitle')}
          onClose={close}
          data-component="new-list-from-file-dialog"
          footerButtons={[
            { content: t('cancel'), onClick: close },
            {
              content: t('configureLists.fromFile.confirmButton', { count: parsed.rows.length }),
              buttonType: 'primary',
              onClick: () => void confirm(),
              disabled: busy || fields.length === 0,
            },
          ]}
        >
          <Stack direction="vertical" gap="condensed">
            <FormControl>
              <FormControl.Label>{t('configureLists.label')}</FormControl.Label>
              <TextInput value={label} onChange={(e) => setLabel(e.target.value)} block data-testid="new-list-from-file-label" />
            </FormControl>

            <Text size="small" weight="semibold">{t('configureLists.fromFile.schemaHeading')}</Text>
            <Stack direction="vertical" gap="condensed" data-testid="new-list-from-file-fields">
              {fields.map((f, i) => (
                <Stack key={f.key} direction="horizontal" gap="condensed" align="center">
                  <TextInput
                    aria-label={t('configureLists.fromFile.fieldLabelAriaLabel', { column: f.key })}
                    value={f.label}
                    size="small"
                    onChange={(e) => setField(i, { label: e.target.value })}
                  />
                  <Select
                    aria-label={t('configureLists.fromFile.fieldTypeAriaLabel', { column: f.key })}
                    value={f.type}
                    data-testid="new-list-from-file-type"
                    onChange={(e) => setField(i, { type: e.target.value as InferredField['type'] })}
                  >
                    {Object.entries(typeLabel).map(([value, name]) => (
                      <Select.Option key={value} value={value}>{name}</Select.Option>
                    ))}
                  </Select>
                  {f.type === FieldType.TypeOptions && f.options && (
                    <Text size="small" className={styles.muted}>{f.options.join(', ')}</Text>
                  )}
                </Stack>
              ))}
            </Stack>

            <Text as="p" size="small" data-testid="new-list-from-file-count">
              {t('configureLists.fromFile.rowCount', { count: parsed.rows.length })}
            </Text>
            {dialogError && <Text as="p" size="small" className={styles.error}>{dialogError}</Text>}
          </Stack>
        </Dialog>
      )}
    </>
  )
}
