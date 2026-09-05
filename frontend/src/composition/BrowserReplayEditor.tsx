import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton, Select, Stack, Text, TextInput } from '@primer/react'
import { PlusIcon, TrashIcon, UploadIcon } from '@primer/octicons-react'
import type { AttributeDef } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { BridgeService } from '../shared/bindings'
import type { BrowserRecordingStep, BrowserRecordingSummary } from '../shared/bindings'
import { messageFor } from '../shared/userError'
import styles from '../shared/ListCard.module.css'

// The browser-replay step's own authoring surface: the recording it
// carries, the values overlaid onto it each run, and the text read back
// out of the page.
//
// The recording is described by the bridge rather than parsed here, so
// what the pickers offer to bind is exactly what a run would accept:
// one parser decides both.

// The parameter source that takes the value written beside it. Every
// other source names an Attribute, as "attribute:<key>".
const SOURCE_LITERAL = 'literal'
const SOURCE_ATTRIBUTE_PREFIX = 'attribute:'

// The step type whose element text an extraction reads. The runner
// reports text for every element step, but a wait is the step an author
// puts there deliberately to read something.
const WAIT_STEP = 'waitForElement'

interface ParameterRow {
  name: string
  stepIndex: number
  field: string
  source: string
  literal?: string
}

interface ExtractionRow {
  name: string
  stepIndex: number
}

// parseRows reads one of the step's two persisted tables, treating
// anything unreadable as empty: the editor never renders a broken
// document, and re-saving repairs it.
function parseRows<T>(raw: string): T[] {
  if (!raw.trim()) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

export interface BrowserReplayEditorProps {
  recordingRaw: string
  parametersRaw: string
  extractRaw: string
  attrs: AttributeDef[]
  onChangeRecording: (raw: string) => void
  onChangeParameters: (raw: string) => void
  onChangeExtract: (raw: string) => void
}

export function BrowserReplayEditor(props: BrowserReplayEditorProps) {
  const { t } = useTranslation('composition')
  const [summary, setSummary] = useState<BrowserRecordingSummary | null>(null)
  const [error, setError] = useState('')

  const { recordingRaw } = props
  useEffect(() => {
    let live = true
    if (!recordingRaw.trim()) {
      setSummary(null)
      setError('')
      return
    }
    BridgeService.ReadRecording(recordingRaw)
      .then((read) => { if (live) { setSummary(read); setError('') } })
      .catch((err: unknown) => { if (live) { setSummary(null); setError(messageFor(err, t)) } })
    return () => { live = false }
  }, [recordingRaw, t])

  const steps = summary?.steps ?? []
  return (
    <Stack direction="vertical" gap="normal" data-testid="browser-replay-editor">
      <RecordingSection
        summary={summary}
        hasRecording={recordingRaw.trim() !== ''}
        error={error}
        onImported={(raw) => props.onChangeRecording(raw)}
        onImportFailed={(message) => setError(message)}
      />
      {summary && (
        <>
          <ParametersSection
            rows={parseRows<ParameterRow>(props.parametersRaw)}
            steps={steps}
            attrs={props.attrs}
            onChange={(rows) => props.onChangeParameters(JSON.stringify(rows))}
          />
          <ExtractSection
            rows={parseRows<ExtractionRow>(props.extractRaw)}
            steps={steps}
            onChange={(rows) => props.onChangeExtract(JSON.stringify(rows))}
          />
        </>
      )}
    </Stack>
  )
}

// RecordingSection is the import door and what the imported recording
// turned out to be.
function RecordingSection({ summary, hasRecording, error, onImported, onImportFailed }: {
  summary: BrowserRecordingSummary | null
  // A step that CARRIES a recording, whether or not the bridge has
  // described it yet: the import prompt must not flash over a step that
  // already has one while that read is in flight.
  hasRecording: boolean
  error: string
  onImported: (raw: string) => void
  onImportFailed: (message: string) => void
}) {
  const { t } = useTranslation('composition')
  const [inputEl, setInputEl] = useState<HTMLInputElement | null>(null)
  const count = summary?.steps?.length ?? 0

  const readFile = (file: File | undefined) => {
    if (!file) return
    file.text()
      .then((text) => onImported(text))
      .catch((err: unknown) => onImportFailed(messageFor(err, t)))
  }

  return (
    <Stack direction="vertical" gap="condensed">
      <Text size="small" weight="semibold">{t('browserReplayEditor.recording')}</Text>
      <input
        ref={setInputEl}
        type="file"
        accept=".json,application/json"
        data-testid="browser-replay-import-input"
        style={{ display: 'none' }}
        onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = '' }}
      />
      {summary ? (
        // The summary and its action stack rather than sit side by
        // side: a recorded address is long enough to push a button off
        // the edge of this panel.
        <Stack direction="vertical" gap="condensed">
          <Text size="small" data-testid="browser-replay-recording-summary" style={{ overflowWrap: 'anywhere' }}>
            {summary.startUrl
              ? t('browserReplayEditor.summary', { count, url: summary.startUrl })
              : t('browserReplayEditor.summaryNoUrl', { count })}
          </Text>
          <Stack direction="horizontal" gap="condensed">
            <Button size="small" leadingVisual={UploadIcon} data-testid="browser-replay-replace" onClick={() => inputEl?.click()}>
              {t('browserReplayEditor.replace')}
            </Button>
          </Stack>
        </Stack>
      ) : (!hasRecording || error) && (
        <Stack direction="vertical" gap="condensed" data-testid="browser-replay-empty">
          <Text as="p" size="small" className={styles.muted}>{t('browserReplayEditor.emptyDescription')}</Text>
          <Button size="small" leadingVisual={UploadIcon} data-testid="browser-replay-import" onClick={() => inputEl?.click()}>
            {t('browserReplayEditor.import')}
          </Button>
        </Stack>
      )}
      {error && (
        <Text as="p" size="small" className={styles.error} data-testid="browser-replay-recording-error">{error}</Text>
      )}
    </Stack>
  )
}

// stepOptionLabel names a step the way an author recognises it in their
// own recording: its number, what it does, and what it acts on.
function stepOptionLabel(step: BrowserRecordingStep, t: (key: string, options: Record<string, unknown>) => string): string {
  return t('browserReplayEditor.stepOption', { number: step.index + 1, type: step.type, selector: step.selector }).trim()
}

// ParametersSection is the table of values overlaid onto the recording
// each run.
function ParametersSection({ rows, steps, attrs, onChange }: {
  rows: ParameterRow[]
  steps: BrowserRecordingStep[]
  attrs: AttributeDef[]
  onChange: (rows: ParameterRow[]) => void
}) {
  const { t } = useTranslation('composition')
  const bindable = steps.filter((s) => (s.bindable ?? []).length > 0)
  const update = (i: number, patch: Partial<ParameterRow>) =>
    onChange(rows.map((row, j) => (j === i ? { ...row, ...patch } : row)))

  return (
    <Stack direction="vertical" gap="condensed" data-testid="browser-replay-parameters">
      <Text size="small" weight="semibold">{t('browserReplayEditor.parameters')}</Text>
      <Text as="p" size="small" className={styles.muted}>{t('browserReplayEditor.parametersDescription')}</Text>
      {bindable.length === 0 ? (
        <Text as="p" size="small" className={styles.muted}>{t('browserReplayEditor.noBindableSteps')}</Text>
      ) : (
        <>
          {rows.map((row, i) => (
            // One control per line rather than a four-across row: the
            // sidebar inspector is 260px, where a row of selects
            // truncates every step label to a few characters.
            <Stack key={i} direction="vertical" gap="condensed" className={styles.card}>
              <Stack direction="horizontal" gap="condensed" align="center">
                <TextInput
                  size="small" block value={row.name} aria-label={t('browserReplayEditor.nameLabel')}
                  placeholder={t('browserReplayEditor.nameLabel')} data-testid="browser-replay-parameter-name"
                  onChange={(e) => update(i, { name: e.target.value })}
                />
                <IconButton
                  icon={TrashIcon} size="small" variant="invisible"
                  aria-label={t('browserReplayEditor.removeParameterAriaLabel')}
                  data-testid="browser-replay-parameter-remove"
                  onClick={() => onChange(rows.filter((_, j) => j !== i))}
                />
              </Stack>
              <Select
                size="small" block value={String(row.stepIndex)} aria-label={t('browserReplayEditor.stepLabel')}
                data-testid="browser-replay-parameter-step"
                onChange={(e) => update(i, { stepIndex: Number(e.target.value), field: fieldForStep(steps, Number(e.target.value), row.field) })}
              >
                {bindable.map((s) => (
                  <Select.Option key={s.index} value={String(s.index)}>{stepOptionLabel(s, t)}</Select.Option>
                ))}
              </Select>
              <Stack direction="horizontal" gap="condensed" align="center">
                {/* The field names are short but the select's own
                    intrinsic width is shorter still in this panel --
                    a floor, so "value" never renders as "val". */}
                <div style={{ minWidth: '6rem' }}>
                  <Select
                    size="small" block value={row.field} aria-label={t('browserReplayEditor.fieldLabel')}
                    data-testid="browser-replay-parameter-field"
                    onChange={(e) => update(i, { field: e.target.value })}
                  >
                    {fieldsForStep(steps, row.stepIndex).map((f) => (
                      <Select.Option key={f} value={f}>{f}</Select.Option>
                    ))}
                  </Select>
                </div>
                <Select
                  size="small" block value={row.source} aria-label={t('browserReplayEditor.sourceLabel')}
                  data-testid="browser-replay-parameter-source"
                  onChange={(e) => update(i, { source: e.target.value })}
                >
                  <Select.Option value={SOURCE_LITERAL}>{t('browserReplayEditor.sourceLiteral')}</Select.Option>
                  {attrs.map((a) => (
                    <Select.Option key={a.Key} value={SOURCE_ATTRIBUTE_PREFIX + a.Key}>{a.Label || a.Key}</Select.Option>
                  ))}
                </Select>
              </Stack>
              {row.source === SOURCE_LITERAL && (
                <TextInput
                  size="small" block value={row.literal ?? ''} aria-label={t('browserReplayEditor.literalLabel')}
                  placeholder={t('browserReplayEditor.literalLabel')} data-testid="browser-replay-parameter-literal"
                  onChange={(e) => update(i, { literal: e.target.value })}
                />
              )}
            </Stack>
          ))}
          <Button
            size="small" leadingVisual={PlusIcon} data-testid="browser-replay-add-parameter"
            onClick={() => onChange([...rows, newParameter(bindable[0])])}
          >
            {t('browserReplayEditor.addParameter')}
          </Button>
        </>
      )}
    </Stack>
  )
}

// newParameter starts a row already pointing at a real step and one of
// its own fields, so an author never has to fix an invalid default.
function newParameter(step: BrowserRecordingStep): ParameterRow {
  return { name: '', stepIndex: step.index, field: (step.bindable ?? [])[0] ?? '', source: SOURCE_LITERAL, literal: '' }
}

// fieldsForStep is what the recording says this step can carry.
function fieldsForStep(steps: BrowserRecordingStep[], index: number): string[] {
  return steps.find((s) => s.index === index)?.bindable ?? []
}

// fieldForStep keeps a row's field valid when its step changes: the
// current one if the new step carries it, else that step's first.
function fieldForStep(steps: BrowserRecordingStep[], index: number, current: string): string {
  const fields = fieldsForStep(steps, index)
  return fields.includes(current) ? current : (fields[0] ?? '')
}

// ExtractSection is the table of text read back out of the page.
function ExtractSection({ rows, steps, onChange }: {
  rows: ExtractionRow[]
  steps: BrowserRecordingStep[]
  onChange: (rows: ExtractionRow[]) => void
}) {
  const { t } = useTranslation('composition')
  const waits = steps.filter((s) => s.type === WAIT_STEP)

  return (
    <Stack direction="vertical" gap="condensed" data-testid="browser-replay-extract">
      <Text size="small" weight="semibold">{t('browserReplayEditor.extract')}</Text>
      <Text as="p" size="small" className={styles.muted}>{t('browserReplayEditor.extractDescription')}</Text>
      {waits.length === 0 ? (
        <Text as="p" size="small" className={styles.muted}>{t('browserReplayEditor.noWaitSteps')}</Text>
      ) : (
        <>
          {rows.map((row, i) => (
            <Stack key={i} direction="vertical" gap="condensed" className={styles.card}>
              <Stack direction="horizontal" gap="condensed" align="center">
                <TextInput
                  size="small" block value={row.name} aria-label={t('browserReplayEditor.nameLabel')}
                  placeholder={t('browserReplayEditor.nameLabel')} data-testid="browser-replay-extract-name"
                  onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                />
                <IconButton
                  icon={TrashIcon} size="small" variant="invisible"
                  aria-label={t('browserReplayEditor.removeExtractionAriaLabel')}
                  data-testid="browser-replay-extract-remove"
                  onClick={() => onChange(rows.filter((_, j) => j !== i))}
                />
              </Stack>
              <Select
                size="small" block value={String(row.stepIndex)} aria-label={t('browserReplayEditor.stepLabel')}
                data-testid="browser-replay-extract-step"
                onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, stepIndex: Number(e.target.value) } : x)))}
              >
                {waits.map((s) => (
                  <Select.Option key={s.index} value={String(s.index)}>{stepOptionLabel(s, t)}</Select.Option>
                ))}
              </Select>
            </Stack>
          ))}
          <Button
            size="small" leadingVisual={PlusIcon} data-testid="browser-replay-add-extraction"
            onClick={() => onChange([...rows, { name: '', stepIndex: waits[0].index }])}
          >
            {t('browserReplayEditor.addExtraction')}
          </Button>
        </>
      )}
    </Stack>
  )
}
