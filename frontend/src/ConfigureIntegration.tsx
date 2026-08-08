import { useEffect, useState } from 'react'
import { Button, Heading, IconButton, Label, Stack, Text } from '@primer/react'
import { PlusIcon, PencilIcon, TrashIcon } from '@primer/octicons-react'
import { ConfigureService } from '../bindings/github.com/alicoding/mill'
import type { Connector } from '../bindings/github.com/alicoding/mill/internal/domain/connector/models'
import { AuthType } from '../bindings/github.com/alicoding/mill/internal/domain/connector/models'
import type { Field, Operation, OperationRef } from '../bindings/github.com/alicoding/mill/internal/adapters/openapispec/models'
import { ConnectorForm, type ConnectorDraft, type HeaderRow } from './ConnectorForm'
import styles from './ListCard.module.css'

const AUTH_LABEL: Record<string, string> = {
  [AuthType.AuthNone]: 'None',
  [AuthType.AuthAPIKey]: 'API key',
  [AuthType.AuthBearer]: 'Bearer token',
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

const EMPTY_DRAFT: ConnectorDraft = { label: '', baseURL: '', authType: AuthType.AuthNone, secret: '', openAPISpec: '' }

// Configure's Integration section (docs/SPEC.md §3.5): CRUD over
// ConfigureService's Connectors. Type is fixed to "http" -- the only
// connector Type built today (§3.2's incremental-extensibility
// principle). The create/edit form itself is ConnectorForm.tsx
// (docs/adr/0011: sectioned into General/Auth/Headers/Schema tabs,
// Schema offering a Paste-OpenAPI/Manual-editor toggle) -- extracted
// out once the Schema tab's Manual/CSV editor made this file too large
// for one component.
export function ConfigureIntegration() {
  const [connectors, setConnectors] = useState<Connector[] | null>(null)
  const [editingID, setEditingID] = useState<string | null>(null)
  const [draft, setDraft] = useState<ConnectorDraft>(EMPTY_DRAFT)
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

  // Takes the draft directly (not read from state) -- ConnectorForm's
  // Manual-schema-editor mode synthesizes openAPISpec at Save time and
  // must not rely on a setState-then-read-state round trip, which
  // isn't synchronous. See ConnectorForm.tsx's handleSave for the real
  // bug this shape avoids.
  const save = async (finalDraft: ConnectorDraft) => {
    setError('')
    try {
      const headers = rowsToHeaders(headerRows)
      const saved = editingID
        ? await ConfigureService.UpdateConnector(editingID, finalDraft.label, 'http', finalDraft.baseURL, finalDraft.authType, headers, finalDraft.openAPISpec)
        : await ConfigureService.CreateConnector(finalDraft.label, 'http', finalDraft.baseURL, finalDraft.authType, headers, finalDraft.openAPISpec)
      if (finalDraft.secret) {
        await ConfigureService.SetConnectorSecret(saved.ID, finalDraft.secret)
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
        <ConnectorForm
          draft={draft}
          onDraftChange={setDraft}
          headerRows={headerRows}
          onHeaderRowsChange={setHeaderRows}
          isEditing={editingID !== null}
          onSave={save}
          onCancel={() => setFormOpen(false)}
          error={error}
        />
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
          <Text size="small">{f.Alias ? `${f.Alias} (${f.Name})` : f.Name}</Text>
          <Label variant="secondary" size="small">{f.In}</Label>
          <Label variant="secondary" size="small">{f.Type}</Label>
          {f.Required && <Label size="small">required</Label>}
          {f.IsSecret && <Label variant="danger" size="small">secret</Label>}
          {f.Path && <Label variant="accent" size="small">path: {f.Path}</Label>}
        </Stack>
      ))}
    </Stack>
  )
}
