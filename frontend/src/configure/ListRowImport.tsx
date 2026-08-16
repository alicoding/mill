import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Dialog, Select, Stack, Text } from '@primer/react'
import { DataTable } from '@primer/react/experimental'
import { UploadIcon } from '@primer/octicons-react'
import type { Field } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import { ConfigureService } from '../shared/bindings'
import { SKIP_TARGET, autoMatchColumns, buildMappedRows, mapRowValues, parseImportFile, type ParsedFile } from './listRowImportParse'
import styles from '../shared/ListCard.module.css'

const PREVIEW_ROWS = 5

// Configure > Lists' "Import rows…" action (docs/goals/0070): file ->
// mapping preview -> confirm bar, the same preview/confirm shape
// AtlasFolderImport.tsx already establishes (a Dialog whose body is a
// live preview, footerButtons are Cancel + a primary confirm naming a
// count, nothing written until Confirm). Parsing/mapping/validation is
// listRowImportParse.ts's own pure logic; this component is UI only.
export function ListRowImport({ listId, columns, onImported }: {
  listId: string
  columns: Field[]
  onImported: () => void
}) {
  const { t } = useTranslation('configure')
  const inputRef = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<ParsedFile | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const openPicker = () => {
    setError('')
    setResult(null)
    inputRef.current?.click()
  }

  const closePreview = () => {
    setParsed(null)
    setMapping({})
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    file.text().then((text) => {
      try {
        const p = parseImportFile(file.name, text)
        setParsed(p)
        setMapping(autoMatchColumns(p.fileColumns, columns))
        setError('')
      } catch (err) {
        setError(String(err))
      }
    }).catch((err) => setError(String(err)))
  }

  const setColumnMapping = (fileColumn: string, targetKey: string) => {
    setMapping((prev) => ({ ...prev, [fileColumn]: targetKey }))
  }

  const { imported, skipped } = parsed ? buildMappedRows(parsed.rows, mapping, columns) : { imported: [], skipped: [] }

  const confirm = async () => {
    if (!parsed) return
    setBusy(true)
    setError('')
    try {
      for (const values of imported) {
        await ConfigureService.AddListRow(listId, values)
      }
      const lines = [t('configureLists.import.resultSummary', { count: imported.length })]
      for (const s of skipped) {
        lines.push(t('configureLists.import.skipReason', { row: s.row, reason: s.reason }))
      }
      setResult(lines.join('\n'))
      closePreview()
      onImported()
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const previewRows: { id: number; values: Record<string, string> }[] = parsed
    ? parsed.rows.slice(0, PREVIEW_ROWS).map((row, i) => ({ id: i, values: mapRowValues(row, mapping) }))
    : []

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.json,text/csv,application/json"
        data-testid="import-list-rows-input"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
      <Button leadingVisual={UploadIcon} size="small" variant="invisible" data-testid="import-list-rows" onClick={openPicker}>
        {t('configureLists.import.button')}
      </Button>
      {error && <Text as="p" size="small" className={styles.error} data-testid="import-list-rows-error">{error}</Text>}
      {result && <div className={styles.result} data-testid="import-list-rows-result">{result}</div>}

      {parsed && (
        // data-component, not data-testid: Dialog only forwards its own
        // special-cased "data-component" prop (AtlasCardOverlay.tsx's
        // own comment has the full reasoning).
        <Dialog
          title={t('configureLists.import.dialogTitle')}
          onClose={closePreview}
          data-component="list-row-import-dialog"
          footerButtons={[
            { content: t('cancel'), onClick: closePreview },
            {
              content: t('configureLists.import.confirmButton', { count: imported.length }),
              buttonType: 'primary',
              onClick: () => void confirm(),
              disabled: busy || imported.length === 0,
            },
          ]}
        >
          <Stack direction="vertical" gap="condensed">
            <Text as="p" size="small" data-testid="import-list-rows-count">
              {skipped.length > 0
                ? t('configureLists.import.countWithSkips', { count: imported.length, skipped: skipped.length })
                : t('configureLists.import.count', { count: imported.length })}
            </Text>

            <Text size="small" weight="semibold">{t('configureLists.import.mappingHeading')}</Text>
            <Stack direction="vertical" gap="condensed" data-testid="import-list-rows-mapping">
              {parsed.fileColumns.map((fc) => (
                <Stack key={fc} direction="horizontal" gap="condensed" align="center">
                  <Text size="small" className={styles.muted} style={{ minWidth: 140 }}>{fc}</Text>
                  <Select
                    aria-label={t('configureLists.import.mapToAriaLabel', { column: fc })}
                    value={mapping[fc] ?? SKIP_TARGET}
                    data-testid="import-list-rows-map-select"
                    onChange={(e) => setColumnMapping(fc, e.target.value)}
                  >
                    <Select.Option value={SKIP_TARGET}>{t('configureLists.import.dontImport')}</Select.Option>
                    {columns.map((c) => (
                      <Select.Option key={c.Key} value={c.Key}>{c.Label || c.Key}</Select.Option>
                    ))}
                  </Select>
                </Stack>
              ))}
            </Stack>

            {previewRows.length > 0 && (
              <>
                <Text size="small" weight="semibold">
                  {t('configureLists.import.previewHeading', { n: previewRows.length })}
                </Text>
                <DataTable
                  data-testid="import-list-rows-preview"
                  data={previewRows}
                  columns={columns
                    .filter((c) => Object.values(mapping).includes(c.Key))
                    .map((c) => ({ header: c.Label || c.Key, id: c.Key, renderCell: (r: { id: number; values: Record<string, string> }) => r.values[c.Key] ?? '' }))}
                />
              </>
            )}

            {skipped.length > 0 && (
              <Stack direction="vertical" gap="condensed" data-testid="import-list-rows-skipped">
                <Text size="small" weight="semibold">{t('configureLists.import.skippedHeading')}</Text>
                {skipped.map((s) => (
                  <Text key={s.row} as="p" size="small" className={styles.error}>
                    {t('configureLists.import.skipReason', { row: s.row, reason: s.reason })}
                  </Text>
                ))}
              </Stack>
            )}
            {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}
          </Stack>
        </Dialog>
      )}
    </>
  )
}
