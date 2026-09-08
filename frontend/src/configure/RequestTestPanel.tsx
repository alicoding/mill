import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, FormControl, IconButton, Label, Select, SegmentedControl, Stack, Text, TextInput, Textarea } from '@primer/react'
import { StatusStamp } from '../shared/StatusStamp'
import { CopyIcon, PlayIcon, SyncIcon } from '@primer/octicons-react'
import { ConfigureService } from '../shared/bindings'
import { writeClipboardText } from '../shared/clipboardWrite'
import { composeDiagnosis } from '../shared/diagnosis'
import { OutputViewer } from '../shared/OutputViewer'
import { contentTypeOf } from '../shared/payloadShape'
import type { AuthConfig, AuthType, JOSEConfig } from '../../bindings/github.com/alicoding/mill/internal/domain/httprequest/models'
import type { TestHTTPRequestResult } from '../shared/bindings'
import { synthesizeOpenAPISpec, type ManualOperation } from './openapiSynth'
import { generateOperationSample } from './testPayload'
import styles from '../shared/ListCard.module.css'
import monoStyles from '../shared/monoText.module.css'

// Session-local test-attempt log, capped the same way Activity's own
// session-only feed is (docs/SPEC.md §2.2's ring buffer) -- a test call
// has no value once the editing session ends (docs/adr/0013 §6), so a
// small cap here is about keeping one editing session's log scannable,
// not data retention.
const LOG_CAP = 20

interface LogEntry extends TestHTTPRequestResult {
  id: number
  method: string
  path: string
  at: string
}

// Exposed so the author form's primary Test button (goal 0370,
// configure/RequestForm.tsx via useRequestFormTestDispatch.ts) triggers
// exactly the same runTest a click on this panel's own Run-test button
// would, without lifting selected/values state out of this component --
// same shape as composition/LiveRunControls.tsx's RunButtonHandle.
export interface RequestTestPanelHandle {
  trigger: () => void
}

// docs/adr/0013: tests the request draft currently on screen -- no
// save required. `effectiveSpec`/`operations` are computed by
// RequestForm from whichever schema-authoring mode is actually
// current (Manual editor vs. pasted OpenAPI text), the same
// "compute once, pass down, never re-derive from possibly-stale state"
// discipline handleSave already uses for the identical stale-state risk
// (see RequestForm.tsx's own comment on that bug).
export const RequestTestPanel = forwardRef<RequestTestPanelHandle, {
  operations: ManualOperation[]
  effectiveSpec: string
  label: string
  baseURL: string
  // The draft's own HTTP method (goal 0370 S2) -- read only when
  // operations is empty, to build the implicit method+URL-only call a
  // schema-less draft still needs to run.
  method: string
  authType: AuthType
  // ADR-0015's non-secret Auth config (OAuth2/HMAC/OAuth1) -- passed
  // through to TestHTTPRequestOperation unchanged, same "test the draft
  // exactly as it would run" principle ADR-0013 already established for
  // BaseURL/Headers and the secret references.
  auth: AuthConfig | null
  // Phase 3 (JOSE) -- same "test the draft exactly as it would run"
  // principle, extended to the encryption layer.
  jose: JOSEConfig | null
  headers: Record<string, string> | null
  // The draft's own secret reference (goal 0306): a test resolves the
  // same reference a real run would, so what a test proves is what
  // will happen. OAuth 1.0a's two references and JOSE's keys travel on
  // auth/jose, exactly as they do on a saved request.
  secretRef: string
  requestID: string | null
  // The author form (goal 0370) drives Run exclusively through its own
  // outer primary Test button -- never two buttons doing the same
  // thing on one screen (.claude/rules/frontend.md's one-primary-per-
  // region convention). The saved record's own Testing tab omits this,
  // keeping its existing in-panel Run test button unchanged.
  hideRunButton?: boolean
  onRunningChange?: (running: boolean) => void
}>(function RequestTestPanel({
  operations, effectiveSpec, label, baseURL, method, authType, auth, jose, headers, secretRef, requestID, hideRunButton, onRunningChange,
}, ref) {
  const { t } = useTranslation('configure')
  const [selectedKey, setSelectedKey] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [log, setLog] = useState<LogEntry[]>([])
  const [running, setRunning] = useState(false)
  const nextID = useRef(0)
  // docs/SPEC.md §4.1: a raw-JSON payload input mode, additive
  // alongside the existing per-field table -- `values` (a flat
  // map[string]string) stays the single source of truth either way;
  // `jsonText`/`jsonError` are this mode's own local editing state,
  // only ever written back into `values` on a successful parse, so an
  // in-progress invalid edit never corrupts what Run test would send.
  const [payloadMode, setPayloadMode] = useState<'fields' | 'json'>('fields')
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState('')

  // No declared operation is a real, supported state (goal 0370 S2),
  // not an error: the converged API-client contract runs a bare
  // method+URL call and a schema only adds typed extraction on top.
  // path stays the "/" placeholder JoinRequestURL already treats as a
  // no-op when BaseURL is the complete URL (composition.go's own
  // one-URL model, also used at Save time by RequestForm's
  // toSchemaOps) -- never rendered, only sent.
  const noSchema = operations.length === 0
  const implicitOperation: ManualOperation = {
    path: '/', method: (method || 'GET').toUpperCase(), summary: '', inputFields: [], outputFields: [],
  }

  // A dropdown with only one real choice is friction, not a control
  // (docs/SPEC.md §3.5's "no UI for a decision that doesn't exist"
  // discipline) -- auto-selected directly, no state or effect needed
  // for this case at all. Prompted directly after the seeded example
  // requests (each declaring exactly one operation) made this
  // concretely visible in the live app.
  const selected = operations.length === 1
    ? operations[0]
    : (operations.find((op) => `${op.method} ${op.path}` === selectedKey) ?? (noSchema ? implicitOperation : null))

  const selectOperation = (key: string) => {
    setSelectedKey(key)
    setValues({})
    setJsonText('')
    setJsonError('')
  }

  const applyValues = (next: Record<string, string>) => {
    setValues(next)
    setJsonText(JSON.stringify(next, null, 2))
    setJsonError('')
  }

  const generateSample = () => {
    if (!selected) return
    applyValues(generateOperationSample(selected.inputFields))
  }

  const switchPayloadMode = (mode: 'fields' | 'json') => {
    if (mode === 'json') setJsonText(JSON.stringify(values, null, 2))
    setPayloadMode(mode)
  }

  const editJsonText = (text: string) => {
    setJsonText(text)
    try {
      const parsed: unknown = JSON.parse(text || '{}')
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setJsonError(t('requestTestPanel.mustBeJsonObject'))
        return
      }
      const next: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed)) next[k] = String(v)
      setValues(next)
      setJsonError('')
    } catch {
      setJsonError(t('requestTestPanel.notValidJson'))
    }
  }

  // useCallback (not a plain closure): useImperativeHandle below needs
  // a stable-enough identity to hand the author form's Test button
  // (goal 0370) the SAME function a click on this panel's own Run-test
  // button already calls, never a second, divergent code path.
  const runTest = useCallback(async () => {
    // The only reason an enabled Test click can't run: no URL. Every
    // other precondition (an operation to call) is satisfied here --
    // selected falls back to the implicit method+URL operation when
    // the draft declares no schema.
    if (!selected || baseURL.trim() === '') return
    setRunning(true)
    try {
      // TestHTTPRequestOperation always parses an OpenAPI document
      // (its one door for both the declared-schema and no-schema
      // cases) -- a schema-less draft's implicit operation is
      // synthesized into a minimal one-op spec here, in-memory only,
      // never persisted and never written back into the draft's own
      // OpenAPISpec.
      const openAPISpec = effectiveSpec.trim() !== '' ? effectiveSpec : synthesizeOpenAPISpec([selected])
      const result = await ConfigureService.TestHTTPRequestOperation({
        RequestID: requestID ?? '',
        Label: label,
        BaseURL: baseURL,
        AuthType: authType,
        Auth: auth,
        JOSE: jose,
        Headers: headers,
        SecretRef: secretRef,
        OpenAPISpec: openAPISpec,
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
  }, [selected, effectiveSpec, requestID, label, baseURL, authType, auth, jose, headers, secretRef, values])

  useImperativeHandle(ref, () => ({ trigger: () => { void runTest() } }), [runTest])
  useEffect(() => { onRunningChange?.(running) }, [running, onRunningChange])

  // baseURL empty means truly nothing to test -- the button reachable
  // from here (this panel's own, when hideRunButton is false) carries
  // the same reason via its own disabled+title/aria-description below;
  // the outer form's Test button does too (RequestForm.tsx).
  const runDisabledReason = baseURL.trim() === '' ? t('requestTestPanel.urlRequiredToTest') : undefined

  return (
    <Stack direction="vertical" gap="normal" data-testid="request-test-panel">
      {operations.length > 1 && (
        <FormControl>
          <FormControl.Label>{t('requestTestPanel.operation')}</FormControl.Label>
          <Select value={selectedKey} onChange={(e) => selectOperation(e.target.value)} data-testid="test-operation-select">
            <Select.Option value="">{t('requestTestPanel.selectOperation')}</Select.Option>
            {operations.map((op) => {
              const key = `${op.method} ${op.path}`
              return <Select.Option key={key} value={key}>{key}</Select.Option>
            })}
          </Select>
        </FormControl>
      )}
      {operations.length === 1 && (
        <Stack direction="horizontal" gap="condensed" align="center">
          <Text size="small" weight="semibold">{t('requestTestPanel.operation')}</Text>
          <Label variant="secondary" size="small" data-testid="test-operation-single">{`${operations[0].method} ${operations[0].path}`}</Label>
        </Stack>
      )}
      {noSchema && baseURL.trim() !== '' && (
        <Stack direction="horizontal" gap="condensed" align="center">
          <Text size="small" weight="semibold">{t('requestTestPanel.operation')}</Text>
          <Label variant="secondary" size="small" data-testid="test-operation-implicit">{`${implicitOperation.method} ${baseURL}`}</Label>
        </Stack>
      )}

      {selected && (
        <>
          {selected.inputFields.length > 0 && (
            <Stack direction="vertical" gap="condensed">
              <Stack direction="horizontal" justify="space-between" align="center">
                <Text size="small" weight="semibold">{t('requestTestPanel.exampleValues')}</Text>
                <Stack direction="horizontal" gap="condensed" align="center">
                  <SegmentedControl aria-label={t('requestTestPanel.payloadInputModeAriaLabel')} size="small" onChange={(i) => switchPayloadMode(i === 0 ? 'fields' : 'json')}>
                    <SegmentedControl.Button selected={payloadMode === 'fields'}>{t('requestTestPanel.perField')}</SegmentedControl.Button>
                    <SegmentedControl.Button selected={payloadMode === 'json'}>{t('requestTestPanel.rawJson')}</SegmentedControl.Button>
                  </SegmentedControl>
                  <Button size="small" variant="invisible" leadingVisual={SyncIcon} onClick={generateSample} data-testid="generate-sample-payload">
                    {t('requestTestPanel.generateExampleValues')}
                  </Button>
                </Stack>
              </Stack>
              {payloadMode === 'fields' ? (
                selected.inputFields.map((f) => (
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
                ))
              ) : (
                <>
                  <Textarea
                    aria-label={t('requestTestPanel.payloadJsonAriaLabel')}
                    value={jsonText}
                    onChange={(e) => editJsonText(e.target.value)}
                    rows={6}
                    block
                    data-testid="test-payload-json"
                  />
                  {jsonError && <Text as="p" size="small" className={styles.error}>{jsonError}</Text>}
                </>
              )}
            </Stack>
          )}

          {!hideRunButton && (
            <Button
              variant="primary"
              size="small"
              leadingVisual={PlayIcon}
              onClick={() => { void runTest() }}
              disabled={running || Boolean(runDisabledReason)}
              title={runDisabledReason}
              aria-description={runDisabledReason}
              data-testid="run-request-test"
            >
              {running ? t('requestTestPanel.running') : t('requestTestPanel.runTest')}
            </Button>
          )}
        </>
      )}

      {log.length > 0 && (
        <Stack direction="vertical" gap="condensed" data-testid="request-test-log">
          <Text size="small" weight="semibold">{t('requestTestPanel.requestLog')}</Text>
          {log.map((entry) => (
            <div key={entry.id} className={styles.card} data-testid="request-test-log-entry">
              <Stack direction="horizontal" gap="condensed" align="center">
                <Text size="small" className={`${styles.muted} ${monoStyles.mono}`}>{entry.at}</Text>
                <Label variant="secondary" size="small">{entry.method} {entry.path}</Label>
                {entry.Error ? (
                  <StatusStamp variant="danger">{t('requestTestPanel.error')}</StatusStamp>
                ) : (
                  <StatusStamp variant={entry.StatusCode >= 400 ? 'danger' : 'success'}>{entry.StatusCode}</StatusStamp>
                )}
                <Text size="small" className={styles.muted}>{t('requestTestPanel.durationMs', { ms: entry.DurationMs })}</Text>
                <IconButton
                  icon={CopyIcon}
                  aria-label={t('requestTestPanel.copyAriaLabel')}
                  size="small"
                  variant="invisible"
                  onClick={() => {
                    if (entry.Error) {
                      void composeDiagnosis({
                        error: entry.Error,
                        context: { Method: entry.method, Path: entry.path, Status: entry.StatusCode, 'Duration (ms)': entry.DurationMs },
                      }).then(writeClipboardText)
                    } else {
                      void writeClipboardText(entry.Body)
                    }
                  }}
                  data-testid="copy-log-entry"
                />
              </Stack>
              {entry.Error ? (
                <OutputViewer
                  value={entry.Error}
                  shape="error"
                  site="request-test-error"
                  testId="request-test-error"
                  context={{ Method: entry.method, Path: entry.path, Status: entry.StatusCode, 'Duration (ms)': entry.DurationMs }}
                />
              ) : (
                // The response says what it is: Content-Type picks the
                // view, exactly as an API client does.
                <OutputViewer
                  value={entry.Body}
                  mime={contentTypeOf(entry.Headers)}
                  title={`${entry.method} ${entry.path}`}
                  site="request-test-response"
                  testId="request-test-response"
                />
              )}
            </div>
          ))}
        </Stack>
      )}

      {noSchema && (
        <Text as="p" size="small" className={styles.muted} data-testid="declare-schema-hint">
          {t('requestTestPanel.declareSchemaHint')}
        </Text>
      )}
    </Stack>
  )
})
