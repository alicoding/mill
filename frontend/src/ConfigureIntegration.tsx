import { useEffect, useState } from 'react'
import { Button, FormControl, Heading, IconButton, Label, Select, Stack, Text, Textarea, TextInput } from '@primer/react'
import { PencilIcon, PlusIcon, TrashIcon } from '@primer/octicons-react'
import { ConfigureService } from '../bindings/github.com/alicoding/mill'
import type { Connector } from '../bindings/github.com/alicoding/mill/internal/domain/connector/models'
import { AuthType } from '../bindings/github.com/alicoding/mill/internal/domain/connector/models'
import type { OperationRef } from '../bindings/github.com/alicoding/mill/internal/adapters/openapispec/models'
import styles from './ListCard.module.css'

const AUTH_LABEL: Record<string, string> = {
  [AuthType.AuthNone]: 'None',
  [AuthType.AuthAPIKey]: 'API key',
  [AuthType.AuthBearer]: 'Bearer token',
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
export function ConfigureIntegration() {
  const [connectors, setConnectors] = useState<Connector[] | null>(null)
  const [editingID, setEditingID] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftConnector>(EMPTY_DRAFT)
  const [formOpen, setFormOpen] = useState(false)
  const [error, setError] = useState('')
  const [operationsByConnector, setOperationsByConnector] = useState<Record<string, OperationRef[] | string>>({})

  const refetch = () => {
    ConfigureService.Connectors().then((list) => setConnectors(list ?? [])).catch(console.error)
  }

  useEffect(refetch, [])

  const startCreate = () => {
    setEditingID(null)
    setDraft(EMPTY_DRAFT)
    setFormOpen(true)
    setError('')
  }

  const startEdit = (c: Connector) => {
    setEditingID(c.ID)
    setDraft({ label: c.Label, baseURL: c.BaseURL, authType: c.AuthType, secret: '', openAPISpec: c.OpenAPISpec })
    setFormOpen(true)
    setError('')
  }

  const save = async () => {
    setError('')
    try {
      const saved = editingID
        ? await ConfigureService.UpdateConnector(editingID, draft.label, 'http', draft.baseURL, draft.authType, null, draft.openAPISpec)
        : await ConfigureService.CreateConnector(draft.label, 'http', draft.baseURL, draft.authType, null, draft.openAPISpec)
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
              <FormControl.Label>OpenAPI spec (optional)</FormControl.Label>
              <FormControl.Caption>
                Paste the OpenAPI 3.x document (JSON or YAML) for this API -- declares the typed
                input/output fields a workflow node can bind Attributes to (ADR-0007). Leave blank to
                keep using a literal request body, same as before this existed.
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
                      {(operationsByConnector[c.ID] as OperationRef[]).map((op) => (
                        <Stack key={`${op.Method} ${op.Path}`} direction="horizontal" gap="condensed" align="center">
                          <Label variant="secondary" size="small">{op.Method}</Label>
                          <Text size="small">{op.Path}</Text>
                          {op.Summary && <Text size="small" className={styles.muted}>-- {op.Summary}</Text>}
                        </Stack>
                      ))}
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
