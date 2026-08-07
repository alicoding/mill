import { useEffect, useState } from 'react'
import { Button, FormControl, Heading, IconButton, Label, Select, Stack, Text, TextInput } from '@primer/react'
import { PencilIcon, PlusIcon, TrashIcon } from '@primer/octicons-react'
import { ConfigureService } from '../bindings/github.com/alicoding/mill'
import type { Connector } from '../bindings/github.com/alicoding/mill/internal/domain/connector/models'
import { AuthType } from '../bindings/github.com/alicoding/mill/internal/domain/connector/models'
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
}

const EMPTY_DRAFT: DraftConnector = { label: '', baseURL: '', authType: AuthType.AuthNone, secret: '' }

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
    setDraft({ label: c.Label, baseURL: c.BaseURL, authType: c.AuthType, secret: '' })
    setFormOpen(true)
    setError('')
  }

  const save = async () => {
    setError('')
    try {
      const saved = editingID
        ? await ConfigureService.UpdateConnector(editingID, draft.label, 'http', draft.baseURL, draft.authType, null)
        : await ConfigureService.CreateConnector(draft.label, 'http', draft.baseURL, draft.authType, null)
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
                  <IconButton icon={PencilIcon} aria-label={`Edit ${c.Label}`} size="small" variant="invisible" onClick={() => startEdit(c)} />
                  <IconButton icon={TrashIcon} aria-label={`Delete ${c.Label}`} size="small" variant="invisible" onClick={() => remove(c.ID)} />
                </Stack>
              </Stack>
            </div>
          ))}
        </Stack>
      )}
    </div>
  )
}
