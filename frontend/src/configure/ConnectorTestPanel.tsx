import { useRef, useState } from 'react'
import { Button, FormControl, Label, Select, Stack, Text, TextInput } from '@primer/react'
import { PlayIcon, SyncIcon } from '@primer/octicons-react'
import { ConfigureService } from '../../bindings/github.com/alicoding/mill'
import type { AuthType } from '../../bindings/github.com/alicoding/mill/internal/domain/connector/models'
import type { TestConnectorResult } from '../../bindings/github.com/alicoding/mill/models'
import type { ManualOperation } from './openapiSynth'
import { generateOperationSample } from './testPayload'
import styles from '../shared/ListCard.module.css'

// Session-local test-attempt log, capped the same way Activity's own
// session-only feed is (docs/SPEC.md §2.2's ring buffer) -- a test call
// has no value once the editing session ends (docs/adr/0013 §6), so a
// small cap here is about keeping one editing session's log scannable,
// not data retention.
const LOG_CAP = 20

interface LogEntry extends TestConnectorResult {
  id: number
  method: string
  path: string
  at: string
}

// docs/adr/0013: tests the connector draft currently on screen -- no
// save required. `effectiveSpec`/`operations` are computed by
// ConnectorForm from whichever schema-authoring mode is actually
// current (Manual editor vs. pasted OpenAPI text), the same
// "compute once, pass down, never re-derive from possibly-stale state"
// discipline handleSave already uses for the identical stale-state risk
// (see ConnectorForm.tsx's own comment on that bug).
export function ConnectorTestPanel({
  operations, effectiveSpec, baseURL, authType, headers, secret, connectorID,
}: {
  operations: ManualOperation[]
  effectiveSpec: string
  baseURL: string
  authType: AuthType
  headers: Record<string, string> | null
  secret: string
  connectorID: string | null
}) {
  const [selectedKey, setSelectedKey] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [log, setLog] = useState<LogEntry[]>([])
  const [running, setRunning] = useState(false)
  const nextID = useRef(0)

  const selected = operations.find((op) => `${op.method} ${op.path}` === selectedKey) ?? null

  const selectOperation = (key: string) => {
    setSelectedKey(key)
    setValues({})
  }

  const generateSample = () => {
    if (!selected) return
    setValues(generateOperationSample(selected.inputFields))
  }

  const runTest = async () => {
    if (!selected || effectiveSpec.trim() === '') return
    setRunning(true)
    try {
      const result = await ConfigureService.TestConnectorOperation({
        ConnectorID: connectorID ?? '',
        BaseURL: baseURL,
        AuthType: authType,
        Headers: headers,
        Secret: secret,
        OpenAPISpec: effectiveSpec,
        Path: selected.path,
        Method: selected.method,
        Values: values,
      })
      nextID.current += 1
      setLog((prev) => [
        { ...result, id: nextID.current, method: selected.method, path: selected.path, at: new Date().toLocaleTimeString() },
        ...prev,
      ].slice(0, LOG_CAP))
    } catch (err) {
      nextID.current += 1
      setLog((prev) => [
        { StatusCode: 0, Body: '', Headers: null, Error: String(err), DurationMs: 0, id: nextID.current, method: selected.method, path: selected.path, at: new Date().toLocaleTimeString() },
        ...prev,
      ].slice(0, LOG_CAP))
    } finally {
      setRunning(false)
    }
  }

  if (effectiveSpec.trim() === '') {
    return <Text as="p" size="small" className={styles.muted}>Declare a Schema first (Schema tab) -- testing needs at least one operation.</Text>
  }
  if (operations.length === 0) {
    return <Text as="p" size="small" className={styles.muted}>The Schema tab doesn&apos;t declare any operations yet.</Text>
  }

  return (
    <Stack direction="vertical" gap="normal" data-testid="connector-test-panel">
      <FormControl>
        <FormControl.Label>Operation</FormControl.Label>
        <Select value={selectedKey} onChange={(e) => selectOperation(e.target.value)} data-testid="test-operation-select">
          <Select.Option value="">Select an operation…</Select.Option>
          {operations.map((op) => {
            const key = `${op.method} ${op.path}`
            return <Select.Option key={key} value={key}>{key}</Select.Option>
          })}
        </Select>
      </FormControl>

      {selected && (
        <>
          {selected.inputFields.length > 0 && (
            <Stack direction="vertical" gap="condensed">
              <Stack direction="horizontal" justify="space-between" align="center">
                <Text size="small" weight="semibold">Example values</Text>
                <Button size="small" variant="invisible" leadingVisual={SyncIcon} onClick={generateSample} data-testid="generate-sample-payload">
                  Generate example values
                </Button>
              </Stack>
              {selected.inputFields.map((f) => (
                <Stack key={f.name} direction="horizontal" gap="condensed" align="center">
                  <Label variant="secondary" size="small">{f.in}</Label>
                  <TextInput
                    aria-label={f.name}
                    placeholder={f.name}
                    value={values[f.name] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                    data-testid="test-field-value"
                  />
                </Stack>
              ))}
            </Stack>
          )}

          <Button variant="primary" size="small" leadingVisual={PlayIcon} onClick={runTest} disabled={running} data-testid="run-connector-test">
            {running ? 'Running…' : 'Run test'}
          </Button>
        </>
      )}

      {log.length > 0 && (
        <Stack direction="vertical" gap="condensed" data-testid="connector-test-log">
          <Text size="small" weight="semibold">Request log (this session only)</Text>
          {log.map((entry) => (
            <div key={entry.id} className={styles.card} data-testid="connector-test-log-entry">
              <Stack direction="horizontal" gap="condensed" align="center">
                <Text size="small" className={styles.muted}>{entry.at}</Text>
                <Label variant="secondary" size="small">{entry.method} {entry.path}</Label>
                {entry.Error ? (
                  <Label variant="danger" size="small">error</Label>
                ) : (
                  <Label variant={entry.StatusCode >= 400 ? 'danger' : 'success'} size="small">{entry.StatusCode}</Label>
                )}
                <Text size="small" className={styles.muted}>{entry.DurationMs}ms</Text>
              </Stack>
              {entry.Error ? (
                <Text as="p" size="small" className={styles.error}>{entry.Error}</Text>
              ) : (
                <Text as="p" size="small" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{entry.Body}</Text>
              )}
            </div>
          ))}
        </Stack>
      )}
    </Stack>
  )
}
