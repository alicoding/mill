import { useState } from 'react'
import { Button, FormControl, Heading, IconButton, Label, Select, Stack, Text, TextInput, Textarea, SegmentedControl } from '@primer/react'
import { PlusIcon, TrashIcon } from '@primer/octicons-react'
import { ConfigureService } from '../../bindings/github.com/alicoding/mill'
import type { AuthConfig, Connector } from '../../bindings/github.com/alicoding/mill/internal/domain/connector/models'
import { AuthType } from '../../bindings/github.com/alicoding/mill/internal/domain/connector/models'
import { ManualSchemaEditor } from './ManualSchemaEditor'
import { ConnectorTestPanel } from './ConnectorTestPanel'
import { headersToRows, rowsToHeaders } from './connectorHeaders'
import { parseOpenAPIToOperations, synthesizeOpenAPISpec, type ManualOperation } from './openapiSynth'
import { AUTH_LABEL, AUTH_UNIMPLEMENTED } from './authTypeLabels'
import styles from '../shared/ListCard.module.css'

export interface HeaderRow {
  key: string
  value: string
}

export interface ConnectorDraft {
  label: string
  baseURL: string
  authType: AuthType
  // Single-secret AuthTypes (APIKey/Bearer/HMAC's signing key/OAuth2's
  // ClientSecret) all reuse this one field -- OAuth1 is the exception
  // (RFC 5849 needs two secrets), see oauth1ConsumerSecret/
  // oauth1TokenSecret below.
  secret: string
  openAPISpec: string
  // ADR-0015's non-secret per-AuthType config -- one flat set of
  // optional fields rather than a discriminated union, since only one
  // group is ever populated/read at a time (driven by authType), and a
  // flat shape keeps draftFrom/handleSave from needing a switch just to
  // move values in and out of a nested shape.
  oauth2TokenURL: string
  oauth2ClientID: string
  oauth2Scope: string
  hmacHeaderName: string
  oauth1ConsumerKey: string
  oauth1Token: string
  oauth1ConsumerSecret: string
  oauth1TokenSecret: string
}

const EMPTY_DRAFT: ConnectorDraft = {
  label: '', baseURL: '', authType: AuthType.AuthNone, secret: '', openAPISpec: '',
  oauth2TokenURL: '', oauth2ClientID: '', oauth2Scope: '',
  hmacHeaderName: '',
  oauth1ConsumerKey: '', oauth1Token: '', oauth1ConsumerSecret: '', oauth1TokenSecret: '',
}

function draftFrom(c: Connector): ConnectorDraft {
  return {
    label: c.Label, baseURL: c.BaseURL, authType: c.AuthType, secret: '', openAPISpec: c.OpenAPISpec,
    oauth2TokenURL: c.Auth?.OAuth2?.TokenURL ?? '',
    oauth2ClientID: c.Auth?.OAuth2?.ClientID ?? '',
    oauth2Scope: c.Auth?.OAuth2?.Scope ?? '',
    hmacHeaderName: c.Auth?.HMAC?.HeaderName ?? '',
    oauth1ConsumerKey: c.Auth?.OAuth1?.ConsumerKey ?? '',
    oauth1Token: c.Auth?.OAuth1?.Token ?? '',
    oauth1ConsumerSecret: '',
    oauth1TokenSecret: '',
  }
}

// authConfigFrom builds the Auth param CreateConnector/UpdateConnector/
// TestConnectorOperation all now take (ADR-0015) -- null for every
// AuthType with no non-secret config (None/APIKey/Bearer/QueryParam,
// and the two stubs), matching Connector.Auth's own "nil unless a
// real config-bearing AuthType" shape.
function authConfigFrom(draft: ConnectorDraft): AuthConfig | null {
  switch (draft.authType) {
    case AuthType.AuthOAuth2:
      return { OAuth2: { GrantType: 'client_credentials', TokenURL: draft.oauth2TokenURL, ClientID: draft.oauth2ClientID, Scope: draft.oauth2Scope, ContentType: '' }, HMAC: null, OAuth1: null }
    case AuthType.AuthHMAC:
      return { OAuth2: null, HMAC: { HeaderName: draft.hmacHeaderName }, OAuth1: null }
    case AuthType.AuthOAuth1:
      return { OAuth2: null, HMAC: null, OAuth1: { ConsumerKey: draft.oauth1ConsumerKey, Token: draft.oauth1Token } }
    default:
      return null
  }
}

// docs/adr/0014: the connector create/edit form -- one continuous
// guided scroll (General -> Auth -> Headers -> Schema -> Test, as
// Heading section breaks), replacing the previous Primer-Tabs layout.
// Matches the reference platform's own precedent: tab the saved-record
// summary (ConnectorSummary.tsx), never the act of authoring. Owns its
// own draft/headerRows/error state internally (seeded once from props,
// same "own state, keyed remount" shape CompositionCanvas.tsx already
// uses for Composition's own tabbed multi-editing) rather than being
// controlled from the parent list page -- required for correctness
// once more than one connector tab can be open at once, not just a
// style preference.
export function ConnectorForm({
  editingConnector, duplicateFrom, onSaved, onCancel,
}: {
  // Non-null => Save calls UpdateConnector against this connector's ID.
  // Null (whether brand-new or a Duplicate) => Save calls CreateConnector.
  editingConnector: Connector | null
  // Set only for the Duplicate case -- seeds the initial draft/headers
  // from an existing connector without editing it (docs/adr/0013 §7).
  duplicateFrom: Connector | null
  onSaved: () => void
  onCancel: () => void
}) {
  const seed = editingConnector ?? duplicateFrom
  const [draft, setDraft] = useState<ConnectorDraft>(() => {
    if (editingConnector) return draftFrom(editingConnector)
    if (duplicateFrom) return { ...draftFrom(duplicateFrom), label: `${duplicateFrom.Label} copy` }
    return EMPTY_DRAFT
  })
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>(() => headersToRows(seed?.Headers))
  const [error, setError] = useState('')
  const isEditing = editingConnector !== null

  const [schemaMode, setSchemaMode] = useState<'openapi' | 'manual'>('openapi')
  const [manualOperations, setManualOperations] = useState<ManualOperation[]>([])
  const [schemaError, setSchemaError] = useState('')

  const updateHeaderRow = (i: number, field: 'key' | 'value', value: string) => {
    setHeaderRows(headerRows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))
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
      setDraft({ ...draft, openAPISpec: synthesizeOpenAPISpec(manualOperations) })
    }
    setSchemaMode('openapi')
  }

  // Manual mode is the source of truth at Save time if it has any
  // operations -- keeps the two representations from silently
  // diverging (editing the table after switching away from OpenAPI
  // mode without switching back would otherwise be lost). Computed
  // into a local value and used directly, never round-tripped through
  // setState first -- setState isn't synchronous, and a save handler
  // that reads state right after setting it reads the *previous*
  // render's stale value. Real bug this shipped with once
  // (.claude/rules/testing.md's own documented pattern for this class
  // of bug), not reintroduced here.
  const effectiveSpec = schemaMode === 'manual' && manualOperations.length > 0
    ? synthesizeOpenAPISpec(manualOperations)
    : draft.openAPISpec
  const effectiveOperations = schemaMode === 'manual'
    ? manualOperations
    : parseOpenAPIToOperations(draft.openAPISpec).operations

  const handleSave = async () => {
    const finalDraft = { ...draft, openAPISpec: effectiveSpec }
    setError('')
    try {
      const headers = rowsToHeaders(headerRows)
      const auth = authConfigFrom(finalDraft)
      const saved = editingConnector
        ? await ConfigureService.UpdateConnector(editingConnector.ID, finalDraft.label, 'http', finalDraft.baseURL, finalDraft.authType, headers, finalDraft.openAPISpec, auth)
        : await ConfigureService.CreateConnector(finalDraft.label, 'http', finalDraft.baseURL, finalDraft.authType, headers, finalDraft.openAPISpec, auth)
      if (finalDraft.authType === AuthType.AuthOAuth1) {
        if (finalDraft.oauth1ConsumerSecret || finalDraft.oauth1TokenSecret) {
          await ConfigureService.SetConnectorOAuth1Secret(saved.ID, finalDraft.oauth1ConsumerSecret, finalDraft.oauth1TokenSecret)
        }
      } else if (finalDraft.secret) {
        await ConfigureService.SetConnectorSecret(saved.ID, finalDraft.secret)
      }
      onSaved()
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <div className={styles.card}>
      <Stack direction="vertical" gap="normal">
        <section>
          <Heading as="h3" variant="small" className={styles.sectionHeading}>General</Heading>
          <Stack direction="vertical" gap="condensed">
            <FormControl>
              <FormControl.Label>Label</FormControl.Label>
              <TextInput value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} block />
            </FormControl>
            <FormControl>
              <FormControl.Label>Base URL</FormControl.Label>
              <TextInput value={draft.baseURL} onChange={(e) => setDraft({ ...draft, baseURL: e.target.value })} placeholder="https://api.example.com" block />
            </FormControl>
          </Stack>
        </section>

        <section>
          <Heading as="h3" variant="small" className={styles.sectionHeading}>Auth</Heading>
          <Stack direction="vertical" gap="condensed">
            <FormControl>
              <FormControl.Label>Auth type</FormControl.Label>
              <Select value={draft.authType} onChange={(e) => setDraft({ ...draft, authType: e.target.value as AuthType })}>
                {Object.values(AuthType).filter((v) => v !== '').map((v) => (
                  <Select.Option key={v} value={v}>{AUTH_LABEL[v] ?? v}</Select.Option>
                ))}
              </Select>
            </FormControl>

            {AUTH_UNIMPLEMENTED.has(draft.authType) && (
              <Stack direction="horizontal" gap="condensed" align="center">
                <Label variant="attention" size="small">Not yet implemented</Label>
                <Text as="p" size="small" className={styles.muted}>
                  This auth type is registered (docs/adr/0015) but its strategy isn&apos;t built yet -- a
                  workflow run through this connector will fail with a clear error rather than a guessed
                  signature. Selectable now so the connector can be configured ahead of that work landing.
                </Text>
              </Stack>
            )}

            {draft.authType === AuthType.AuthOAuth2 && (
              <>
                <FormControl>
                  <FormControl.Label>Token URL</FormControl.Label>
                  <TextInput value={draft.oauth2TokenURL} onChange={(e) => setDraft({ ...draft, oauth2TokenURL: e.target.value })} placeholder="https://auth.example.com/oauth/token" block />
                </FormControl>
                <FormControl>
                  <FormControl.Label>Client ID</FormControl.Label>
                  <TextInput value={draft.oauth2ClientID} onChange={(e) => setDraft({ ...draft, oauth2ClientID: e.target.value })} block />
                </FormControl>
                <FormControl>
                  <FormControl.Label>Scope</FormControl.Label>
                  <FormControl.Caption>Optional -- leave blank to request no specific scope.</FormControl.Caption>
                  <TextInput value={draft.oauth2Scope} onChange={(e) => setDraft({ ...draft, oauth2Scope: e.target.value })} block />
                </FormControl>
              </>
            )}

            {draft.authType === AuthType.AuthHMAC && (
              <FormControl>
                <FormControl.Label>Signature header name</FormControl.Label>
                <FormControl.Caption>Defaults to X-Signature when left blank.</FormControl.Caption>
                <TextInput value={draft.hmacHeaderName} onChange={(e) => setDraft({ ...draft, hmacHeaderName: e.target.value })} placeholder="X-Signature" block />
              </FormControl>
            )}

            {draft.authType === AuthType.AuthOAuth1 && (
              <>
                <FormControl>
                  <FormControl.Label>Consumer key</FormControl.Label>
                  <TextInput value={draft.oauth1ConsumerKey} onChange={(e) => setDraft({ ...draft, oauth1ConsumerKey: e.target.value })} block />
                </FormControl>
                <FormControl>
                  <FormControl.Label>Token</FormControl.Label>
                  <FormControl.Caption>Optional -- omit for 2-legged OAuth 1.0a (RFC 5849).</FormControl.Caption>
                  <TextInput value={draft.oauth1Token} onChange={(e) => setDraft({ ...draft, oauth1Token: e.target.value })} block />
                </FormControl>
              </>
            )}

            {draft.authType === AuthType.AuthOAuth1 ? (
              <>
                <FormControl>
                  <FormControl.Label>Consumer secret</FormControl.Label>
                  <FormControl.Caption>
                    Write-only -- stored in the OS keychain, never readable back through Mill.
                    {isEditing && ' Leave blank to keep the existing secret.'}
                  </FormControl.Caption>
                  <TextInput type="password" value={draft.oauth1ConsumerSecret} onChange={(e) => setDraft({ ...draft, oauth1ConsumerSecret: e.target.value })} block />
                </FormControl>
                <FormControl>
                  <FormControl.Label>Token secret</FormControl.Label>
                  <FormControl.Caption>Optional -- omit for 2-legged OAuth 1.0a, same as Token above.</FormControl.Caption>
                  <TextInput type="password" value={draft.oauth1TokenSecret} onChange={(e) => setDraft({ ...draft, oauth1TokenSecret: e.target.value })} block />
                </FormControl>
              </>
            ) : draft.authType !== AuthType.AuthNone && (
              <FormControl>
                <FormControl.Label>{draft.authType === AuthType.AuthOAuth2 ? 'Client secret' : 'Secret'}</FormControl.Label>
                <FormControl.Caption>
                  Write-only -- stored in the OS keychain, never readable back through Mill.
                  {isEditing && ' Leave blank to keep the existing secret.'}
                </FormControl.Caption>
                <TextInput type="password" value={draft.secret} onChange={(e) => setDraft({ ...draft, secret: e.target.value })} block />
              </FormControl>
            )}
          </Stack>
        </section>

        <section>
          <Heading as="h3" variant="small" className={styles.sectionHeading}>Headers</Heading>
          <Stack direction="vertical" gap="condensed">
            <Text as="p" size="small" className={styles.muted}>
              Static headers (e.g. a required API version) sent with every call, in addition to
              whatever the Auth type adds.
            </Text>
            {headerRows.map((row, i) => (
              <Stack key={i} direction="horizontal" gap="condensed" align="center">
                <TextInput placeholder="header name" value={row.key} onChange={(e) => updateHeaderRow(i, 'key', e.target.value)} data-testid="connector-header-key" />
                <TextInput placeholder="value" value={row.value} onChange={(e) => updateHeaderRow(i, 'value', e.target.value)} data-testid="connector-header-value" />
                <IconButton icon={TrashIcon} aria-label="Remove header" size="small" variant="invisible" onClick={() => setHeaderRows(headerRows.filter((_, idx) => idx !== i))} />
              </Stack>
            ))}
            <Button size="small" variant="invisible" leadingVisual={PlusIcon} onClick={() => setHeaderRows([...headerRows, { key: '', value: '' }])} data-testid="add-connector-header">
              Add header
            </Button>
          </Stack>
        </section>

        <section>
          <Heading as="h3" variant="small" className={styles.sectionHeading}>Schema</Heading>
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
                onChange={(e) => setDraft({ ...draft, openAPISpec: e.target.value })}
                rows={6}
                block
                data-testid="connector-openapi-spec"
              />
            ) : (
              <ManualSchemaEditor operations={manualOperations} onChange={setManualOperations} />
            )}
          </Stack>
        </section>

        <section>
          <Heading as="h3" variant="small" className={styles.sectionHeading}>Test</Heading>
          <ConnectorTestPanel
            operations={effectiveOperations}
            effectiveSpec={effectiveSpec}
            baseURL={draft.baseURL}
            authType={draft.authType}
            auth={authConfigFrom(draft)}
            headers={rowsToHeaders(headerRows)}
            secret={draft.authType === AuthType.AuthOAuth1 ? draft.oauth1ConsumerSecret : draft.secret}
            connectorID={isEditing ? editingConnector.ID : null}
          />
        </section>
      </Stack>

      {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}
      <Stack direction="horizontal" gap="condensed" style={{ marginTop: 'var(--base-size-12)' }}>
        <Button variant="primary" size="small" onClick={handleSave}>Save connector</Button>
        <Button size="small" variant="invisible" onClick={onCancel}>Cancel</Button>
      </Stack>
    </div>
  )
}
