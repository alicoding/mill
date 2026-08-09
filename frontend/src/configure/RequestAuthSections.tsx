import { Checkbox, FormControl, Heading, Label, Select, Stack, Text, TextInput, Textarea } from '@primer/react'
import { AuthType } from '../../bindings/github.com/alicoding/mill/internal/domain/httprequest/models'
import { AUTH_LABEL, AUTH_UNIMPLEMENTED } from './authTypeLabels'
import type { RequestDraft } from './requestDraft'
import styles from '../shared/ListCard.module.css'

// The Auth and JOSE sections of the request form -- split out of
// RequestForm.tsx along the same per-section seam its one-scroll
// layout (ADR-0014) already draws, once ADR-0016 Phase B pushed that
// file past the 500-line limit. Pure presentation over the shared
// draft: all state stays owned by RequestForm.

export function RequestAuthSections({ draft, setDraft, isEditing }: {
  draft: RequestDraft
  setDraft: (d: RequestDraft) => void
  isEditing: boolean
}) {
  return (
    <>
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
    </>
  )
}
