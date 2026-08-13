import { useTranslation } from 'react-i18next'
import { Checkbox, FormControl, Heading, Select, Stack, Text, TextInput, Textarea } from '@primer/react'
import { StatusStamp } from '../shared/StatusStamp'
import { AuthType } from '../../bindings/github.com/alicoding/mill/internal/domain/httprequest/models'
import { authLabelFor, AUTH_UNIMPLEMENTED } from './authTypeLabels'
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
  const { t } = useTranslation('configure')
  const AUTH_LABEL_MAP = authLabelFor(t)
  return (
    <>
      <section>
        <Heading as="h3" variant="small" className={styles.sectionHeading}>{t('requestAuthSections.auth')}</Heading>
        <Stack direction="vertical" gap="condensed">
          <FormControl>
            <FormControl.Label>{t('requestAuthSections.authType')}</FormControl.Label>
            <Select value={draft.authType} onChange={(e) => setDraft({ ...draft, authType: e.target.value as AuthType })}>
              {Object.values(AuthType).filter((v) => v !== '').map((v) => (
                <Select.Option key={v} value={v}>{AUTH_LABEL_MAP[v] ?? v}</Select.Option>
              ))}
            </Select>
          </FormControl>

          {AUTH_UNIMPLEMENTED.has(draft.authType) && (
            <Stack direction="horizontal" gap="condensed" align="center">
              <StatusStamp variant="caution">{t('requestAuthSections.notYetImplemented')}</StatusStamp>
              <Text as="p" size="small" className={styles.muted}>
                {t('requestAuthSections.notYetImplementedDescription')}
              </Text>
            </Stack>
          )}

          {draft.authType === AuthType.AuthOAuth2 && (
            <>
              <FormControl>
                <FormControl.Label>{t('requestAuthSections.tokenUrl')}</FormControl.Label>
                <TextInput value={draft.oauth2TokenURL} onChange={(e) => setDraft({ ...draft, oauth2TokenURL: e.target.value })} placeholder={t('requestAuthSections.tokenUrlPlaceholder')} block />
              </FormControl>
              <FormControl>
                <FormControl.Label>{t('requestAuthSections.clientId')}</FormControl.Label>
                <TextInput value={draft.oauth2ClientID} onChange={(e) => setDraft({ ...draft, oauth2ClientID: e.target.value })} block />
              </FormControl>
              <FormControl>
                <FormControl.Label>{t('requestAuthSections.scope')}</FormControl.Label>
                <FormControl.Caption>{t('requestAuthSections.scopeCaption')}</FormControl.Caption>
                <TextInput value={draft.oauth2Scope} onChange={(e) => setDraft({ ...draft, oauth2Scope: e.target.value })} block />
              </FormControl>
            </>
          )}

          {draft.authType === AuthType.AuthHMAC && (
            <FormControl>
              <FormControl.Label>{t('requestAuthSections.signatureHeaderName')}</FormControl.Label>
              <FormControl.Caption>{t('requestAuthSections.signatureHeaderCaption')}</FormControl.Caption>
              <TextInput value={draft.hmacHeaderName} onChange={(e) => setDraft({ ...draft, hmacHeaderName: e.target.value })} placeholder={t('requestAuthSections.signatureHeaderPlaceholder')} block />
            </FormControl>
          )}

          {draft.authType === AuthType.AuthOAuth1 && (
            <>
              <FormControl>
                <FormControl.Label>{t('requestAuthSections.consumerKey')}</FormControl.Label>
                <TextInput value={draft.oauth1ConsumerKey} onChange={(e) => setDraft({ ...draft, oauth1ConsumerKey: e.target.value })} block />
              </FormControl>
              <FormControl>
                <FormControl.Label>{t('requestAuthSections.token')}</FormControl.Label>
                <FormControl.Caption>{t('requestAuthSections.tokenCaption')}</FormControl.Caption>
                <TextInput value={draft.oauth1Token} onChange={(e) => setDraft({ ...draft, oauth1Token: e.target.value })} block />
              </FormControl>
            </>
          )}

          {draft.authType === AuthType.AuthOAuth1 ? (
            <>
              <FormControl>
                <FormControl.Label>{t('requestAuthSections.consumerSecret')}</FormControl.Label>
                <FormControl.Caption>
                  {t('requestAuthSections.secretCaption')}
                  {isEditing && t('requestAuthSections.leaveBlankToKeepSecret')}
                </FormControl.Caption>
                <TextInput type="password" value={draft.oauth1ConsumerSecret} onChange={(e) => setDraft({ ...draft, oauth1ConsumerSecret: e.target.value })} block />
              </FormControl>
              <FormControl>
                <FormControl.Label>{t('requestAuthSections.tokenSecret')}</FormControl.Label>
                <FormControl.Caption>{t('requestAuthSections.tokenSecretCaption')}</FormControl.Caption>
                <TextInput type="password" value={draft.oauth1TokenSecret} onChange={(e) => setDraft({ ...draft, oauth1TokenSecret: e.target.value })} block />
              </FormControl>
            </>
          ) : draft.authType !== AuthType.AuthNone && (
            <FormControl>
              <FormControl.Label>{draft.authType === AuthType.AuthOAuth2 ? t('requestAuthSections.clientSecret') : t('requestAuthSections.secret')}</FormControl.Label>
              <FormControl.Caption>
                {t('requestAuthSections.secretCaption')}
                {isEditing && t('requestAuthSections.leaveBlankToKeepSecret')}
              </FormControl.Caption>
              <TextInput type="password" value={draft.secret} onChange={(e) => setDraft({ ...draft, secret: e.target.value })} block />
            </FormControl>
          )}
        </Stack>
      </section>

      <section>
        <Heading as="h3" variant="small" className={styles.sectionHeading}>{t('requestAuthSections.joseEncryption')}</Heading>
        <Stack direction="vertical" gap="condensed">
          <Text as="p" size="small" className={styles.muted}>
            {t('requestAuthSections.joseDescription')}
          </Text>
          <Stack direction="horizontal" gap="condensed" align="center">
            <Checkbox
              checked={draft.joseEnabled}
              onChange={(e) => setDraft({ ...draft, joseEnabled: e.target.checked })}
              data-testid="jose-enabled-checkbox"
            />
            <Text size="small">{t('requestAuthSections.enableJose')}</Text>
          </Stack>
          {draft.joseEnabled && (
            <>
              <FormControl>
                <FormControl.Label>{t('requestAuthSections.recipientPublicKey')}</FormControl.Label>
                <FormControl.Caption>{t('requestAuthSections.recipientPublicKeyCaption')}</FormControl.Caption>
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
                  aria-label={t('requestAuthSections.decryptResponseAriaLabel')}
                  data-testid="jose-decrypt-response-checkbox"
                />
                <Text size="small">{t('requestAuthSections.decryptResponseLabel')}</Text>
              </Stack>
              {draft.joseDecryptResponse && (
                <FormControl>
                  <FormControl.Label>{t('requestAuthSections.millsPrivateKey')}</FormControl.Label>
                  <FormControl.Caption>
                    {t('requestAuthSections.millsPrivateKeyCaption')}
                    {isEditing && t('requestAuthSections.leaveBlankToKeepKey')}
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
