import { useEffect, useState } from 'react'
import { Button, FormControl, Heading, IconButton, Label, Select, Stack, Text, Textarea, TextInput } from '@primer/react'
import { PencilIcon, PlusIcon, TrashIcon } from '@primer/octicons-react'
import { ConfigureService } from '../bindings/github.com/alicoding/mill'
import type { Connector } from '../bindings/github.com/alicoding/mill/internal/domain/connector/models'
import { AuthType } from '../bindings/github.com/alicoding/mill/internal/domain/connector/models'
import type { Field, Operation, OperationRef } from '../bindings/github.com/alicoding/mill/internal/adapters/openapispec/models'
import styles from './ListCard.module.css'

const AUTH_LABEL: Record<string, string> = {
  [AuthType.AuthNone]: 'None',
  [AuthType.AuthAPIKey]: 'API key',
  [AuthType.AuthBearer]: 'Bearer token',
}

interface HeaderRow {
  key: string
  value: string
}

function headersToRows(headers: { [key: string]: string | undefined } | null | undefined): HeaderRow[] {
  return Object.entries(headers ?? {}).map(([key, value]) => ({ key, value: value ?? '' }))
}

function rowsToHeaders(rows: HeaderRow[]): Record<string, string> | null {
  const out: Record<string, string> = {}
  for (const r of rows) {
    if (r.key.trim() !== '') out[r.key] = r.value
  }
  return Object.keys(out).length > 0 ? out : null
}

interface DraftConnector {
  label: string
  baseURL: string
  authType: AuthType
  secret: string
  openAPISpec: string
}

const EMPTY_DRAFT: DraftConnector = { label: '', baseURL: '', authType: AuthType.AuthNone, secret: '', openAPISpec: '' }

// Configure's Integration section (docs/SPEC.md §3.5): CRUD over
// ConfigureService's Connectors. Type is fixed to "http" -- the only
// connector Type built today (§3.2's incremental-extensibility
// principle) -- so the form doesn't offer a choice that would just fail
// server-side Validate. The secret field is write-only: it's cleared
// after every Save (SetConnectorSecret has no matching GetSecret to read
// it back from), and editing an existing connector never pre-fills it.
//
// Static request headers (e.g. a vendor-required "X-Client-Version") are
// a real Connector.Headers field on the Go side, merged into every call
// (integration.go's authHeader/headers merge) -- this form previously
// always saved null for it since nothing here ever exposed an editor,
// a real gap caught directly by testing the live app, not assumed fixed
// just because the domain field existed.
export function ConfigureIntegration() {
  const [connectors, setConnectors] = useState<Connector[] | null>(null)
  const [editingID, setEditingID] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftConnector>(EMPTY_DRAFT)
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [error, setError] = useState('')
  const [operationsByConnector, setOperationsByConnector] = useState<Record<string, OperationRef[] | string>>({})
  const [fieldsByOperation, setFieldsByOperation] = useState<Record<string, Operation | string>>({})

  const refetch = () => {
    ConfigureService.Connectors().then((list) => setConnectors(list ?? [])).catch(console.error)
  }

  useEffect(refetch, [])

  const startCreate = () => {
    setEditingID(null)
    setDraft(EMPTY_DRAFT)
    setHeaderRows([])
    setFormOpen(true)
    setError('')
  }

  const startEdit = (c: Connector) => {
    setEditingID(c.ID)
    setDraft({ label: c.Label, baseURL: c.BaseURL, authType: c.AuthType, secret: '', openAPISpec: c.OpenAPISpec })
    setHeaderRows(headersToRows(c.Headers))
    setFormOpen(true)
    setError('')
  }

  const updateHeaderRow = (i: number, field: 'key' | 'value', value: string) => {
    setHeaderRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))
  }

  const save = async () => {
    setError('')
    try {
      const headers = rowsToHeaders(headerRows)
      const saved = editingID
        ? await ConfigureService.UpdateConnector(editingID, draft.label, 'http', draft.baseURL, draft.authType, headers, draft.openAPISpec)
        : await ConfigureService.CreateConnector(draft.label, 'http', draft.baseURL, draft.authType, headers, draft.openAPISpec)
      if (draft.secret) {
        await ConfigureService.SetConnectorSecret(saved.ID, draft.secret)
      }
      setFormOpen(false)
      refetch()
    } catch (err) {
      setError(String(err))
    }
  }

  const remove = (id: string) => {
    ConfigureService.DeleteConnector(id).then(refetch).catch(console.error)
  }

  const listOperations = (id: string) => {
    ConfigureService.ListConnectorOperations(id)
      .then((ops) => setOperationsByConnector((prev) => ({ ...prev, [id]: ops ?? [] })))
      .catch((err) => setOperationsByConnector((prev) => ({ ...prev, [id]: String(err) })))
  }

  // Schema preview (input/output fields), fetched lazily per operation
  // rather than eagerly for every declared operation -- most specs
  // declare more operations than a user is about to inspect right now.
  const showFields = (connectorID: string, op: OperationRef) => {
    const opKey = `${connectorID} ${op.Method} ${op.Path}`
    ConfigureService.ConnectorOperationFields(connectorID, op.Path, op.Method)
      .then((fields) => setFieldsByOperation((prev) => ({ ...prev, [opKey]: fields })))
      .catch((err) => setFieldsByOperation((prev) => ({ ...prev, [opKey]: String(err) })))
  }

  return (
    <div className={styles.page} data-testid="configure-integration">
      <Stack direction="horizontal" justify="space-between" align="center" className={styles.sectionHeading}>
        <Heading as="h2" variant="small">Integration</Heading>
        <Button leadingVisual={PlusIcon} size="small" onClick={startCreate} data-testid="new-connector">
          New connector
        </Button>
      </Stack>

      {formOpen && (
        <div className={styles.card}>
          <Stack direction="vertical" gap="condensed">
            <FormControl>
              <FormControl.Label>Label</FormControl.Label>
              <TextInput value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} block />
            </FormControl>
            <FormControl>
              <FormControl.Label>Base URL</FormControl.Label>
              <TextInput value={draft.baseURL} onChange={(e) => setDraft({ ...draft, baseURL: e.target.value })} placeholder="https://api.example.com" block />
            </FormControl>
            <FormControl>
              <FormControl.Label>Auth type</FormControl.Label>
              <Select value={draft.authType} onChange={(e) => setDraft({ ...draft, authType: e.target.value as AuthType })}>
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
                  {editingID && ' Leave blank to keep the existing secret.'}
                </FormControl.Caption>
                <TextInput type="password" value={draft.secret} onChange={(e) => setDraft({ ...draft, secret: e.target.value })} block />
              </FormControl>
            )}

            <FormControl>
              <FormControl.Label>Headers</FormControl.Label>
              <FormControl.Caption>
                Static headers (e.g. a required API version) sent with every call, in addition to
                whatever the Auth type above adds.
              </FormControl.Caption>
              <Stack direction="vertical" gap="condensed">
                {headerRows.map((row, i) => (
                  <Stack key={i} direction="horizontal" gap="condensed" align="center">
                    <TextInput placeholder="header name" value={row.key} onChange={(e) => updateHeaderRow(i, 'key', e.target.value)} data-testid="connector-header-key" />
                    <TextInput placeholder="value" value={row.value} onChange={(e) => updateHeaderRow(i, 'value', e.target.value)} data-testid="connector-header-value" />
                    <IconButton
                      icon={TrashIcon}
                      aria-label="Remove header"
                      size="small"
                      variant="invisible"
                      onClick={() => setHeaderRows((prev) => prev.filter((_, idx) => idx !== i))}
                    />
                  </Stack>
                ))}
                <Button
                  size="small"
                  variant="invisible"
                  leadingVisual={PlusIcon}
                  onClick={() => setHeaderRows((prev) => [...prev, { key: '', value: '' }])}
                  data-testid="add-connector-header"
                >
                  Add header
                </Button>
              </Stack>
            </FormControl>

            <FormControl>
              <FormControl.Label>OpenAPI spec (optional)</FormControl.Label>
              <FormControl.Caption>
                Paste the OpenAPI 3.x document (JSON or YAML) for this API -- declares the typed
                input/output fields a workflow node can bind Attributes to (ADR-0007). Leave blank to
                keep using a literal request body, same as before this existed. Once saved, use
                &quot;List operations&quot; below to preview the fields this declares.
              </FormControl.Caption>
              <Textarea
                value={draft.openAPISpec}
                onChange={(e) => setDraft({ ...draft, openAPISpec: e.target.value })}
                rows={6}
                block
                data-testid="connector-openapi-spec"
              />
            </FormControl>
            {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}
            <Stack direction="horizontal" gap="condensed">
              <Button variant="primary" size="small" onClick={save}>Save connector</Button>
              <Button size="small" variant="invisible" onClick={() => setFormOpen(false)}>Cancel</Button>
            </Stack>
          </Stack>
        </div>
      )}

      {connectors === null && <Text as="p" className={styles.muted}>Loading…</Text>}
      {connectors !== null && connectors.length === 0 && !formOpen && (
        <Text as="p" className={styles.muted}>No connectors yet.</Text>
      )}
      {connectors !== null && (
        <Stack direction="vertical" gap="condensed">
          {connectors.map((c) => (
            <div key={c.ID} className={styles.card} data-testid="connector-row">
              <Stack direction="horizontal" justify="space-between" align="start" gap="normal">
                <div>
                  <Stack direction="horizontal" gap="condensed" align="center">
                    <Text weight="semibold">{c.Label}</Text>
                    <Label variant="secondary" size="small">{AUTH_LABEL[c.AuthType] ?? c.AuthType}</Label>
                  </Stack>
                  <Text as="p" size="small" className={styles.muted}>{c.BaseURL}</Text>
                  <Text as="p" size="small" className={styles.muted}>ID: {c.ID}</Text>
                  {c.Headers && Object.keys(c.Headers).length > 0 && (
                    <Text as="p" size="small" className={styles.muted}>
                      Headers: {Object.entries(c.Headers).map(([k, v]) => `${k}: ${v}`).join(', ')}
                    </Text>
                  )}
                </div>
                <Stack direction="horizontal" gap="condensed">
                  {c.OpenAPISpec && (
                    <Button size="small" variant="invisible" onClick={() => listOperations(c.ID)} data-testid="list-operations">
                      List operations
                    </Button>
                  )}
                  <IconButton icon={PencilIcon} aria-label={`Edit ${c.Label}`} size="small" variant="invisible" onClick={() => startEdit(c)} />
                  <IconButton icon={TrashIcon} aria-label={`Delete ${c.Label}`} size="small" variant="invisible" onClick={() => remove(c.ID)} />
                </Stack>
              </Stack>

              {operationsByConnector[c.ID] !== undefined && (
                <div data-testid="connector-operations">
                  {typeof operationsByConnector[c.ID] === 'string' ? (
                    <Text as="p" size="small" className={styles.error}>{operationsByConnector[c.ID] as string}</Text>
                  ) : (operationsByConnector[c.ID] as OperationRef[]).length === 0 ? (
                    <Text as="p" size="small" className={styles.muted}>This spec declares no operations.</Text>
                  ) : (
                    <Stack direction="vertical" gap="condensed">
                      {(operationsByConnector[c.ID] as OperationRef[]).map((op) => {
                        const opKey = `${c.ID} ${op.Method} ${op.Path}`
                        const fields = fieldsByOperation[opKey]
                        return (
                          <div key={opKey}>
                            <Stack direction="horizontal" gap="condensed" align="center">
                              <Label variant="secondary" size="small">{op.Method}</Label>
                              <Text size="small">{op.Path}</Text>
                              {op.Summary && <Text size="small" className={styles.muted}>-- {op.Summary}</Text>}
                              <Button size="small" variant="invisible" onClick={() => showFields(c.ID, op)} data-testid="show-operation-fields">
                                {fields === undefined ? 'Show schema' : 'Refresh schema'}
                              </Button>
                            </Stack>
                            {fields !== undefined && (
                              typeof fields === 'string' ? (
                                <Text as="p" size="small" className={styles.error}>{fields}</Text>
                              ) : (
                                <div data-testid="operation-schema" style={{ marginLeft: 'var(--base-size-16)' }}>
                                  <SchemaFieldList label="Input" fields={fields.InputFields} />
                                  <SchemaFieldList label="Output" fields={fields.OutputFields} />
                                </div>
                              )
                            )}
                          </div>
                        )
                      })}
                    </Stack>
                  )}
                </div>
              )}
            </div>
          ))}
        </Stack>
      )}
    </div>
  )
}

function SchemaFieldList({ label, fields }: { label: string; fields: Field[] | null | undefined }) {
  const list = fields ?? []
  if (list.length === 0) return null
  return (
    <Stack direction="vertical" gap="condensed">
      <Text size="small" weight="semibold">{label}</Text>
      {list.map((f) => (
        <Stack key={f.Name} direction="horizontal" gap="condensed" align="center">
          <Text size="small">{f.Name}</Text>
          <Label variant="secondary" size="small">{f.In}</Label>
          <Label variant="secondary" size="small">{f.Type}</Label>
          {f.Required && <Label size="small">required</Label>}
          {f.IsSecret && <Label variant="danger" size="small">secret</Label>}
        </Stack>
      ))}
    </Stack>
  )
}
