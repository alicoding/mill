import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Select, Stack, Text, Textarea } from '@primer/react'
import { useDropzone } from 'react-dropzone'
import { parseCSVToOperations, parseOpenAPIToOperations, type ManualField, type ManualOperation } from './openapiSynth'
import { inferFieldsFromSample } from './pasteSample'
import styles from '../shared/ListCard.module.css'

// One schema intake for every accelerator (docs/SPEC.md §4's Update):
// paste or drop an OpenAPI document, a JSON sample payload, or a CSV
// field list, and the result lands in the always-visible manual editor
// below for review -- replacing the previous three separate entry
// points (a Paste-OpenAPI mode switch, a CSV block inside the manual
// editor, a per-section "Paste sample" toggle) the user found genuinely
// confusing in the live app. Detection is by content, not a mode
// picker: JSON with an openapi/swagger key is a spec, any other JSON is
// a sample payload (the "Treat sample as" select says which side it
// describes), anything else is tried as CSV. react-dropzone (MIT,
// pure-JS deps) provides the drop-zone behavior -- adopted rather than
// hand-rolling HTML5 drag events, per .claude/rules/architecture.md.

export type IntakeResult =
  | { kind: 'openapi'; operations: ManualOperation[] }
  | { kind: 'csv'; operations: ManualOperation[] }
  | { kind: 'sample'; fields: ManualField[]; target: 'body' | 'response' }

function detect(t: (key: string, opts?: Record<string, unknown>) => string, text: string, sampleTarget: 'body' | 'response'): { result?: IntakeResult; error?: string } {
  const trimmed = text.trim()
  if (trimmed === '') return { error: t('schemaIntake.nothingToLoad') }

  let parsed: unknown
  let isJSON: boolean
  try {
    parsed = JSON.parse(trimmed)
    isJSON = true
  } catch {
    isJSON = false
  }

  if (isJSON && typeof parsed === 'object' && parsed !== null && ('openapi' in parsed || 'swagger' in parsed)) {
    const { operations, errors } = parseOpenAPIToOperations(t, trimmed)
    if (errors.length > 0) return { error: errors.join(' ') }
    if (operations.length === 0) return { error: t('schemaIntake.noOperationsDeclared') }
    return { result: { kind: 'openapi', operations } }
  }

  if (isJSON) {
    const { fields, error } = inferFieldsFromSample(t, trimmed)
    if (error) return { error }
    return { result: { kind: 'sample', fields, target: sampleTarget } }
  }

  const { operations, errors } = parseCSVToOperations(t, trimmed)
  if (operations.length > 0) {
    return { result: { kind: 'csv', operations } }
  }
  const detail = errors.length > 0 ? ` (${errors.join('; ')})` : ''
  return {
    error: t('schemaIntake.unrecognizedFormat', { detail }),
  }
}

export function SchemaIntake({ onLoad }: { onLoad: (result: IntakeResult) => void }) {
  const { t } = useTranslation('configure')
  const [text, setText] = useState('')
  const [sampleTarget, setSampleTarget] = useState<'body' | 'response'>('body')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = (raw: string) => {
    const { result, error: err } = detect(t, raw, sampleTarget)
    if (err || !result) {
      setError(err ?? t('schemaIntake.nothingLoaded'))
      setNotice('')
      return
    }
    onLoad(result)
    setError('')
    setText('')
    setNotice(
      result.kind === 'sample'
        ? t('schemaIntake.inferredFieldsNotice', { count: result.fields.length, plural: result.fields.length === 1 ? '' : 's' })
        : t('schemaIntake.loadedOperationsNotice', { count: result.operations.length, plural: result.operations.length === 1 ? '' : 's', source: result.kind === 'openapi' ? t('schemaIntake.theOpenApiDocument') : t('schemaIntake.csv') }),
    )
  }

  const onDrop = useCallback((accepted: File[]) => {
    const file = accepted[0]
    if (!file) return
    file.text().then(load).catch((err) => setError(String(err)))
    // load's identity changes with sampleTarget; the latest is what a
    // drop should use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sampleTarget])

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    multiple: false,
    noClick: true,
    accept: { 'application/json': ['.json'], 'text/csv': ['.csv'], 'text/plain': ['.txt'] },
  })

  return (
    <Stack direction="vertical" gap="condensed" data-testid="schema-intake">
      <div
        {...getRootProps()}
        style={{
          border: `1px dashed var(--borderColor-${isDragActive ? 'accent-emphasis' : 'default'})`,
          borderRadius: 'var(--borderRadius-medium)',
          padding: 'var(--base-size-8)',
        }}
      >
        <input {...getInputProps()} data-testid="schema-intake-file" />
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('schemaIntake.textareaPlaceholder')}
          rows={4}
          block
          data-testid="schema-intake-text"
        />
        <Stack direction="horizontal" gap="condensed" align="center" style={{ marginTop: 'var(--base-size-8)' }}>
          <Button size="small" onClick={() => load(text)} data-testid="schema-intake-load">{t('schemaIntake.load')}</Button>
          <Button size="small" variant="invisible" onClick={open}>{t('schemaIntake.chooseFile')}</Button>
          <Select size="small" aria-label={t('schemaIntake.treatSampleAsAriaLabel')} value={sampleTarget} onChange={(e) => setSampleTarget(e.target.value as 'body' | 'response')}>
            <Select.Option value="body">{t('schemaIntake.sampleIsInput')}</Select.Option>
            <Select.Option value="response">{t('schemaIntake.sampleIsOutput')}</Select.Option>
          </Select>
        </Stack>
      </div>
      {error && <Text as="p" size="small" className={styles.error} data-testid="schema-intake-error">{error}</Text>}
      {notice && <Text as="p" size="small" className={styles.muted} data-testid="schema-intake-notice">{notice}</Text>}
    </Stack>
  )
}
