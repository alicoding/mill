import { useState } from 'react'
import { Button, Checkbox, FormControl, Heading, IconButton, Label, Select, Stack, Text, TextInput, Textarea, SegmentedControl } from '@primer/react'
import { PlusIcon, TrashIcon } from '@primer/octicons-react'
import { ConfigureService } from '../../bindings/github.com/alicoding/mill'
import type { AuthConfig, HTTPRequest, JOSEConfig } from '../../bindings/github.com/alicoding/mill/internal/domain/httprequest/models'
import { AuthType } from '../../bindings/github.com/alicoding/mill/internal/domain/httprequest/models'
import { ManualSchemaEditor } from './ManualSchemaEditor'
import { RequestTestPanel } from './RequestTestPanel'
import { headersToRows, rowsToHeaders } from './requestHeaders'
import { parseOpenAPIToOperations, synthesizeOpenAPISpec, type ManualOperation } from './openapiSynth'
import { AUTH_LABEL, AUTH_UNIMPLEMENTED } from './authTypeLabels'
import styles from '../shared/ListCard.module.css'
import PageContainer from '../shared/PageContainer'

export interface HeaderRow {
  key: string
  value: string
}

export interface RequestDraft {
  label: string
  description: string
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
  // Phase 3 (JOSE) -- independent of authType (httprequest.JOSEConfig's
  // own doc comment: a request can combine JOSE with any auth scheme),
  // so these are never conditionally reset by an authType change the
  // way the oauth2*/hmac*/oauth1* fields above implicitly are (only the
  // *displayed* section changes per authType, not these).
  joseEnabled: boolean
  joseRecipientPublicKeyPEM: string
  joseDecryptResponse: boolean
  // Write-only, same shape as secret/oauth1*Secret above.
  josePrivateKeyPEM: string
}

const EMPTY_DRAFT: RequestDraft = {
  label: '', description: '', baseURL: '', authType: AuthType.AuthNone, secret: '', openAPISpec: '',
  oauth2TokenURL: '', oauth2ClientID: '', oauth2Scope: '',
  hmacHeaderName: '',
  oauth1ConsumerKey: '', oauth1Token: '', oauth1ConsumerSecret: '', oauth1TokenSecret: '',
  joseEnabled: false, joseRecipientPublicKeyPEM: '', joseDecryptResponse: false, josePrivateKeyPEM: '',
}

function draftFrom(r: HTTPRequest): RequestDraft {
  return {
    label: r.Label, description: r.Description, baseURL: r.BaseURL, authType: r.AuthType, secret: '', openAPISpec: r.OpenAPISpec,
    oauth2TokenURL: r.Auth?.OAuth2?.TokenURL ?? '',
    oauth2ClientID: r.Auth?.OAuth2?.ClientID ?? '',
    oauth2Scope: r.Auth?.OAuth2?.Scope ?? '',
    hmacHeaderName: r.Auth?.HMAC?.HeaderName ?? '',
    oauth1ConsumerKey: r.Auth?.OAuth1?.ConsumerKey ?? '',
    oauth1Token: r.Auth?.OAuth1?.Token ?? '',
    oauth1ConsumerSecret: '',
    oauth1TokenSecret: '',
    joseEnabled: r.JOSE?.Enabled ?? false,
    joseRecipientPublicKeyPEM: r.JOSE?.RecipientPublicKeyPEM ?? '',
    joseDecryptResponse: r.JOSE?.DecryptResponse ?? false,
    josePrivateKeyPEM: '',
  }
}

// authConfigFrom builds the Auth param CreateHTTPRequest/UpdateHTTPRequest/
// TestHTTPRequestOperation all now take (ADR-0015) -- null for every
// AuthType with no non-secret config (None/APIKey/Bearer/QueryParam,
// and the two stubs), matching HTTPRequest.Auth's own "nil unless a
// real config-bearing AuthType" shape.
function authConfigFrom(draft: RequestDraft): AuthConfig | null {
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

// joseConfigFrom builds the JOSE param (Phase 3) -- null when disabled,
// matching HTTPRequest.JOSE's own "nil unless a request actually uses
// it" shape. Algorithm/ContentEncryption are left empty so the domain
// layer's own stated defaults (RSA-OAEP-256/A256GCM,
// internal/domain/composition/jose.go) apply -- no picker for a
// single-supported-combo decision that doesn't exist yet, same "no UI
// for a decision that doesn't exist" discipline docs/SPEC.md §3.5
// already applies to single-option Selects.
function joseConfigFrom(draft: RequestDraft): JOSEConfig | null {
  if (!draft.joseEnabled) return null
  return {
    Enabled: true, Algorithm: '', ContentEncryption: '',
    RecipientPublicKeyPEM: draft.joseRecipientPublicKeyPEM,
    DecryptResponse: draft.joseDecryptResponse,
  }
}

// docs/adr/0014: the request create/edit form -- one continuous guided
// scroll (General -> Auth -> Headers -> Schema -> Test, as Heading
// section breaks), replacing the previous Primer-Tabs layout. Matches
// the reference platform's own precedent: tab the saved-record summary
// (RequestSummary.tsx), never the act of authoring. Owns its own
// draft/headerRows/error state internally (seeded once from props,
// same "own state, keyed remount" shape CompositionCanvas.tsx already
// uses for Composition's own tabbed multi-editing) rather than being
// controlled from the parent list page -- required for correctness
// once more than one request tab can be open at once, not just a
// style preference. Renamed from ConnectorForm by ADR-0016.
export function RequestForm({
  editingRequest, duplicateFrom, onSaved, onCancel,
}: {
  // Non-null => Save calls UpdateHTTPRequest against this request's ID.
  // Null (whether brand-new or a Duplicate) => Save calls CreateHTTPRequest.
  editingRequest: HTTPRequest | null
  // Set only for the Duplicate case -- seeds the initial draft/headers
  // from an existing request without editing it (docs/adr/0013 §7).
  duplicateFrom: HTTPRequest | null
  onSaved: () => void
  onCancel: () => void
}) {
  const seed = editingRequest ?? duplicateFrom
  const [draft, setDraft] = useState<RequestDraft>(() => {
    if (editingRequest) return draftFrom(editingRequest)
    if (duplicateFrom) return { ...draftFrom(duplicateFrom), label: `${duplicateFrom.Label} copy` }
    return EMPTY_DRAFT
  })
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>(() => headersToRows(seed?.Headers))
  const [error, setError] = useState('')
  const isEditing = editingRequest !== null

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
      const jose = joseConfigFrom(finalDraft)
      const saved = editingRequest
        ? await ConfigureService.UpdateHTTPRequest(editingRequest.ID, finalDraft.label, finalDraft.baseURL, finalDraft.authType, headers, finalDraft.openAPISpec, auth, jose, finalDraft.description)
        : await ConfigureService.CreateHTTPRequest(finalDraft.label, finalDraft.baseURL, finalDraft.authType, headers, finalDraft.openAPISpec, auth, jose, finalDraft.description)
      if (finalDraft.authType === AuthType.AuthOAuth1) {
        if (finalDraft.oauth1ConsumerSecret || finalDraft.oauth1TokenSecret) {
          await ConfigureService.SetHTTPRequestOAuth1Secret(saved.ID, finalDraft.oauth1ConsumerSecret, finalDraft.oauth1TokenSecret)
        }
      } else if (finalDraft.secret) {
        await ConfigureService.SetHTTPRequestSecret(saved.ID, finalDraft.secret)
      }
      if (finalDraft.joseEnabled && finalDraft.joseDecryptResponse && finalDraft.josePrivateKeyPEM) {
        await ConfigureService.SetHTTPRequestJOSEPrivateKey(saved.ID, finalDraft.josePrivateKeyPEM)
      }
      onSaved()
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <PageContainer variant="narrow">
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
            <FormControl>
              <FormControl.Label>Description</FormControl.Label>
              <FormControl.Caption>Optional -- what this request is for, or any caveat worth noting.</FormControl.Caption>
              <Textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={2} block data-testid="request-description" />
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
                  workflow run through this request will fail with a clear error rather than a guessed
                  signature. Selectable now so the request can be configured ahead of that work landing.
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
          <Heading as="h3" variant="small" className={styles.sectionHeading}>JOSE encryption</Heading>
          <Stack direction="vertical" gap="condensed">
            <Text as="p" size="small" className={styles.muted}>
              Optional, independent of Auth type above (Phase 3, ADR-0015) -- encrypts what Mill sends to
              this request, and optionally decrypts what it receives back (JWE, RFC 7516).
            </Text>
            <Stack direction="horizontal" gap="condensed" align="center">
              <Checkbox
                checked={draft.joseEnabled}
                onChange={(e) => setDraft({ ...draft, joseEnabled: e.target.checked })}
                data-testid="jose-enabled-checkbox"
              />
              <Text size="small">Enable JOSE encryption</Text>
            </Stack>
            {draft.joseEnabled && (
              <>
                <FormControl>
                  <FormControl.Label>Recipient public key (PEM)</FormControl.Label>
                  <FormControl.Caption>The vendor&apos;s RSA public key -- used to encrypt the outgoing request body. Not a secret.</FormControl.Caption>
                  <Textarea
                    value={draft.joseRecipientPublicKeyPEM}
                    onChange={(e) => setDraft({ ...draft, joseRecipientPublicKeyPEM: e.target.value })}
                    rows={4}
                    block
                    data-testid="jose-recipient-public-key"
                  />
                </FormControl>
                <Stack direction="horizontal" gap="condensed" align="center">
                  <Checkbox
                    checked={draft.joseDecryptResponse}
                    onChange={(e) => setDraft({ ...draft, joseDecryptResponse: e.target.checked })}
                    aria-label="Decrypt response"
                    data-testid="jose-decrypt-response-checkbox"
                  />
                  <Text size="small">Decrypt response (this request&apos;s replies are also JWE-encrypted)</Text>
                </Stack>
                {draft.joseDecryptResponse && (
                  <FormControl>
                    <FormControl.Label>Mill&apos;s private key (PEM)</FormControl.Label>
                    <FormControl.Caption>
                      Write-only -- stored in the OS keychain, separately from the Auth secret above, never
                      readable back through Mill.
                      {isEditing && ' Leave blank to keep the existing key.'}
                    </FormControl.Caption>
                    <Textarea
                      value={draft.josePrivateKeyPEM}
                      onChange={(e) => setDraft({ ...draft, josePrivateKeyPEM: e.target.value })}
                      rows={4}
                      block
                      data-testid="jose-private-key"
                    />
                  </FormControl>
                )}
              </>
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
                <TextInput placeholder="header name" value={row.key} onChange={(e) => updateHeaderRow(i, 'key', e.target.value)} data-testid="request-header-key" />
                <TextInput placeholder="value" value={row.value} onChange={(e) => updateHeaderRow(i, 'value', e.target.value)} data-testid="request-header-value" />
                <IconButton icon={TrashIcon} aria-label="Remove header" size="small" variant="invisible" onClick={() => setHeaderRows(headerRows.filter((_, idx) => idx !== i))} />
              </Stack>
            ))}
            <Button size="small" variant="invisible" leadingVisual={PlusIcon} onClick={() => setHeaderRows([...headerRows, { key: '', value: '' }])} data-testid="add-request-header">
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
                data-testid="request-openapi-spec"
              />
            ) : (
              <ManualSchemaEditor operations={manualOperations} onChange={setManualOperations} />
            )}
          </Stack>
        </section>

        <section>
          <Heading as="h3" variant="small" className={styles.sectionHeading}>Test</Heading>
          <RequestTestPanel
            operations={effectiveOperations}
            effectiveSpec={effectiveSpec}
            baseURL={draft.baseURL}
            authType={draft.authType}
            auth={authConfigFrom(draft)}
            jose={joseConfigFrom(draft)}
            josePrivateKeyPEM={draft.josePrivateKeyPEM}
            headers={rowsToHeaders(headerRows)}
            secret={draft.authType === AuthType.AuthOAuth1 ? draft.oauth1ConsumerSecret : draft.secret}
            requestID={isEditing ? editingRequest.ID : null}
          />
        </section>
      </Stack>

      {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}
      <Stack direction="horizontal" gap="condensed" style={{ marginTop: 'var(--base-size-12)' }}>
        <Button variant="primary" size="small" onClick={handleSave}>Save request</Button>
        <Button size="small" variant="invisible" onClick={onCancel}>Cancel</Button>
      </Stack>
    </div>
    </PageContainer>
  )
}
