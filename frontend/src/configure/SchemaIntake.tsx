import { useCallback, useState } from 'react'
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

function detect(text: string, sampleTarget: 'body' | 'response'): { result?: IntakeResult; error?: string } {
  const trimmed = text.trim()
  if (trimmed === '') return { error: 'Nothing to load -- paste content or drop a file first.' }

  let parsed: unknown
  let isJSON = false
  try {
    parsed = JSON.parse(trimmed)
    isJSON = true
  } catch {
    isJSON = false
  }

  if (isJSON && typeof parsed === 'object' && parsed !== null && ('openapi' in parsed || 'swagger' in parsed)) {
    const { operations, errors } = parseOpenAPIToOperations(trimmed)
    if (errors.length > 0) return { error: errors.join(' ') }
    if (operations.length === 0) return { error: 'The OpenAPI document declares no operations.' }
    return { result: { kind: 'openapi', operations } }
  }

  if (isJSON) {
    const { fields, error } = inferFieldsFromSample(trimmed)
    if (error) return { error }
    return { result: { kind: 'sample', fields, target: sampleTarget } }
  }

  const { operations, errors } = parseCSVToOperations(trimmed)
  if (operations.length > 0) {
    return { result: { kind: 'csv', operations } }
  }
  const detail = errors.length > 0 ? ` (${errors.join('; ')})` : ''
  return {
    error: `Couldn't recognize this as OpenAPI JSON, a JSON sample, or CSV${detail}. ` +
      'CSV needs a header row: path,method,direction,name,in,type,required,secret,alias,extractPath.',
  }
}

export function SchemaIntake({ onLoad }: { onLoad: (result: IntakeResult) => void }) {
  const [text, setText] = useState('')
  const [sampleTarget, setSampleTarget] = useState<'body' | 'response'>('body')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = (raw: string) => {
    const { result, error: err } = detect(raw, sampleTarget)
    if (err || !result) {
      setError(err ?? 'Nothing loaded.')
      setNotice('')
      return
    }
    onLoad(result)
    setError('')
    setText('')
    setNotice(
      result.kind === 'sample'
        ? `Inferred ${result.fields.length} field${result.fields.length === 1 ? '' : 's'} from the JSON sample -- review below.`
        : `Loaded ${result.operations.length} operation${result.operations.length === 1 ? '' : 's'} from ${result.kind === 'openapi' ? 'the OpenAPI document' : 'CSV'} -- review below.`,
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
          placeholder={'Paste an OpenAPI document, a JSON sample payload, or CSV field rows here -- or drop a .json/.csv file.'}
          rows={4}
          block
          data-testid="schema-intake-text"
        />
        <Stack direction="horizontal" gap="condensed" align="center" style={{ marginTop: 'var(--base-size-8)' }}>
          <Button size="small" onClick={() => load(text)} data-testid="schema-intake-load">Load</Button>
          <Button size="small" variant="invisible" onClick={open}>Choose file…</Button>
          <Select size="small" aria-label="Treat JSON sample as" value={sampleTarget} onChange={(e) => setSampleTarget(e.target.value as 'body' | 'response')}>
            <Select.Option value="body">Sample is: input (request payload)</Select.Option>
            <Select.Option value="response">Sample is: output (response)</Select.Option>
          </Select>
        </Stack>
      </div>
      {error && <Text as="p" size="small" className={styles.error} data-testid="schema-intake-error">{error}</Text>}
      {notice && <Text as="p" size="small" className={styles.muted} data-testid="schema-intake-notice">{notice}</Text>}
    </Stack>
  )
}
