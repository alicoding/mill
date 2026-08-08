import { useState } from 'react'
import { Button, FormControl, IconButton, SegmentedControl, Select, Stack, Text, TextInput, Textarea } from '@primer/react'
import { PlusIcon, TrashIcon } from '@primer/octicons-react'
import { Tabs } from '@primer/react/experimental'
import { TabItem, TabList, TabPanel } from '../shared/Tabs'
import { AuthType } from '../../bindings/github.com/alicoding/mill/internal/domain/connector/models'
import { ManualSchemaEditor } from './ManualSchemaEditor'
import { ConnectorTestPanel } from './ConnectorTestPanel'
import { rowsToHeaders } from './connectorHeaders'
import { parseOpenAPIToOperations, synthesizeOpenAPISpec, type ManualOperation } from './openapiSynth'
import styles from '../shared/ListCard.module.css'

const AUTH_LABEL: Record<string, string> = {
  [AuthType.AuthNone]: 'None',
  [AuthType.AuthAPIKey]: 'API key',
  [AuthType.AuthBearer]: 'Bearer token',
}

export interface HeaderRow {
  key: string
  value: string
}

export interface ConnectorDraft {
  label: string
  baseURL: string
  authType: AuthType
  secret: string
  openAPISpec: string
}

// docs/adr/0011: the connector create/edit form, sectioned into tabs
// (General/Auth/Headers/Schema) matching real precedent (Postman's
// Params/Headers/Authorization/Body tabs; n8n's HTTP Request node's own
// section split) rather than one long scrolling form. Extracted out of
// ConfigureIntegration.tsx once the Schema tab's Manual/CSV editor made
// that file too large for one component -- same "split along a real
// seam" discipline as every other extraction in this codebase.
export function ConnectorForm({
  draft, onDraftChange, headerRows, onHeaderRowsChange, isEditing, connectorID, onSave, onCancel, error,
}: {
  draft: ConnectorDraft
  onDraftChange: (draft: ConnectorDraft) => void
  headerRows: HeaderRow[]
  onHeaderRowsChange: (rows: HeaderRow[]) => void
  isEditing: boolean
  // Only meaningful when isEditing -- ConnectorTestPanel's secret
  // fallback (docs/adr/0013 §4) needs the connector's real ID to read
  // its stored keychain secret when the Secret field is left blank.
  connectorID: string | null
  onSave: (draft: ConnectorDraft) => void
  onCancel: () => void
  error: string
}) {
  const [schemaMode, setSchemaMode] = useState<'openapi' | 'manual'>('openapi')
  const [manualOperations, setManualOperations] = useState<ManualOperation[]>([])
  const [schemaError, setSchemaError] = useState('')

  const updateHeaderRow = (i: number, field: 'key' | 'value', value: string) => {
    onHeaderRowsChange(headerRows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))
  }

  const switchToManual = () => {
    setSchemaError('')
    if (draft.openAPISpec.trim() === '') {
      setManualOperations([])
    } else {
      const { operations, errors } = parseOpenAPIToOperations(draft.openAPISpec)
      setManualOperations(operations)
      if (errors.length > 0) setSchemaError(errors.join(' '))
    }
    setSchemaMode('manual')
  }

  const switchToOpenAPI = () => {
    if (manualOperations.length > 0) {
      onDraftChange({ ...draft, openAPISpec: synthesizeOpenAPISpec(manualOperations) })
    }
    setSchemaMode('openapi')
  }

  const handleSave = () => {
    // Manual mode is the source of truth at Save time if it has any
    // operations -- keeps the two representations from silently
    // diverging (editing the table after switching away from OpenAPI
    // mode without switching back would otherwise be lost). Passed
    // directly to onSave rather than via onDraftChange first: setState
    // doesn't apply synchronously, so an onDraftChange-then-onSave
    // sequence would have onSave's caller read the *previous* render's
    // still-stale draft.openAPISpec -- a real bug this shipped with
    // initially, caught by the e2e test actually exercising Save
    // through to a real persisted connector, not just unit-testing
    // synthesizeOpenAPISpec in isolation.
    const finalDraft = schemaMode === 'manual' && manualOperations.length > 0
      ? { ...draft, openAPISpec: synthesizeOpenAPISpec(manualOperations) }
      : draft
    onSave(finalDraft)
  }

  // Same "manual mode is the source of truth if it has operations"
  // resolution handleSave already uses -- ConnectorTestPanel must never
  // test against a stale draft.openAPISpec while the user is actively
  // editing in Manual mode (the exact bug handleSave's own comment
  // documents, one level down).
  const effectiveSpec = schemaMode === 'manual' && manualOperations.length > 0
    ? synthesizeOpenAPISpec(manualOperations)
    : draft.openAPISpec
  const effectiveOperations = schemaMode === 'manual'
    ? manualOperations
    : parseOpenAPIToOperations(draft.openAPISpec).operations

  return (
    <div className={styles.card}>
      <Tabs defaultValue="general">
        <TabList aria-label="Connector configuration">
          <TabItem value="general">General</TabItem>
          <TabItem value="auth">Auth</TabItem>
          <TabItem value="headers">Headers</TabItem>
          <TabItem value="schema">Schema</TabItem>
          <TabItem value="test">Test</TabItem>
        </TabList>

        <TabPanel value="general">
          <Stack direction="vertical" gap="condensed">
            <FormControl>
              <FormControl.Label>Label</FormControl.Label>
              <TextInput value={draft.label} onChange={(e) => onDraftChange({ ...draft, label: e.target.value })} block />
            </FormControl>
            <FormControl>
              <FormControl.Label>Base URL</FormControl.Label>
              <TextInput value={draft.baseURL} onChange={(e) => onDraftChange({ ...draft, baseURL: e.target.value })} placeholder="https://api.example.com" block />
            </FormControl>
          </Stack>
        </TabPanel>

        <TabPanel value="auth">
          <Stack direction="vertical" gap="condensed">
            <FormControl>
              <FormControl.Label>Auth type</FormControl.Label>
              <Select value={draft.authType} onChange={(e) => onDraftChange({ ...draft, authType: e.target.value as AuthType })}>
                {Object.values(AuthType).filter((v) => v !== '').map((v) => (
                  <Select.Option key={v} value={v}>{AUTH_LABEL[v] ?? v}</Select.Option>
                ))}
              </Select>
            </FormControl>
            {draft.authType !== AuthType.AuthNone && (
              <FormControl>
                <FormControl.Label>Secret</FormControl.Label>
                <FormControl.Caption>
                  Write-only -- stored in the OS keychain, never readable back through Mill.
                  {isEditing && ' Leave blank to keep the existing secret.'}
                </FormControl.Caption>
                <TextInput type="password" value={draft.secret} onChange={(e) => onDraftChange({ ...draft, secret: e.target.value })} block />
              </FormControl>
            )}
          </Stack>
        </TabPanel>

        <TabPanel value="headers">
          <Stack direction="vertical" gap="condensed">
            <Text as="p" size="small" className={styles.muted}>
              Static headers (e.g. a required API version) sent with every call, in addition to
              whatever the Auth type adds.
            </Text>
            {headerRows.map((row, i) => (
              <Stack key={i} direction="horizontal" gap="condensed" align="center">
                <TextInput placeholder="header name" value={row.key} onChange={(e) => updateHeaderRow(i, 'key', e.target.value)} data-testid="connector-header-key" />
                <TextInput placeholder="value" value={row.value} onChange={(e) => updateHeaderRow(i, 'value', e.target.value)} data-testid="connector-header-value" />
                <IconButton icon={TrashIcon} aria-label="Remove header" size="small" variant="invisible" onClick={() => onHeaderRowsChange(headerRows.filter((_, idx) => idx !== i))} />
              </Stack>
            ))}
            <Button size="small" variant="invisible" leadingVisual={PlusIcon} onClick={() => onHeaderRowsChange([...headerRows, { key: '', value: '' }])} data-testid="add-connector-header">
              Add header
            </Button>
          </Stack>
        </TabPanel>

        <TabPanel value="schema">
          <Stack direction="vertical" gap="normal">
            <Text as="p" size="small" className={styles.muted}>
              Declares the typed input/output fields a workflow node can bind Attributes to
              (ADR-0007). Leave empty to keep using a literal request body.
            </Text>
            <SegmentedControl aria-label="Schema authoring mode" onChange={(i) => (i === 0 ? switchToOpenAPI() : switchToManual())}>
              <SegmentedControl.Button selected={schemaMode === 'openapi'}>Paste OpenAPI</SegmentedControl.Button>
              <SegmentedControl.Button selected={schemaMode === 'manual'}>Manual editor</SegmentedControl.Button>
            </SegmentedControl>
            {schemaError && <Text as="p" size="small" className={styles.error}>{schemaError}</Text>}

            {schemaMode === 'openapi' ? (
              <Textarea
                value={draft.openAPISpec}
                onChange={(e) => onDraftChange({ ...draft, openAPISpec: e.target.value })}
                rows={6}
                block
                data-testid="connector-openapi-spec"
              />
            ) : (
              <ManualSchemaEditor operations={manualOperations} onChange={setManualOperations} />
            )}
          </Stack>
        </TabPanel>

        <TabPanel value="test">
          <ConnectorTestPanel
            operations={effectiveOperations}
            effectiveSpec={effectiveSpec}
            baseURL={draft.baseURL}
            authType={draft.authType}
            headers={rowsToHeaders(headerRows)}
            secret={draft.secret}
            connectorID={isEditing ? connectorID : null}
          />
        </TabPanel>
      </Tabs>

      {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}
      <Stack direction="horizontal" gap="condensed" style={{ marginTop: 'var(--base-size-12)' }}>
        <Button variant="primary" size="small" onClick={handleSave}>Save connector</Button>
        <Button size="small" variant="invisible" onClick={onCancel}>Cancel</Button>
      </Stack>
    </div>
  )
}
