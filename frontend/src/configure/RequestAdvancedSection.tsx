import { useTranslation } from 'react-i18next'
import { Checkbox, Details, FormControl, Stack, Text, Textarea } from '@primer/react'
import { ChevronRightIcon } from '@primer/octicons-react'
import type { RequestDraft } from './requestDraft'
import styles from '../shared/ListCard.module.css'
import own from './RequestAdvancedSection.module.css'

// The form's one disclosure (goal 0315): what a rare integration needs
// and every other one never sees -- JWE body encryption and the
// schema-less fallback body. Closed by default, open whenever
// anything inside holds a value, so an edited record shows its own
// settings without a hunt.
export function requestAdvancedIsSet(draft: RequestDraft): boolean {
  return draft.joseEnabled || draft.body.trim() !== ''
}

export function RequestAdvancedSection({ draft, setDraft, isEditing }: {
  draft: RequestDraft
  setDraft: (d: RequestDraft) => void
  isEditing: boolean
}) {
  const { t } = useTranslation('configure')
  return (
    <Details open={requestAdvancedIsSet(draft) || undefined} data-testid="request-advanced">
      <Details.Summary className={own.summary} data-testid="request-advanced-summary">
        <ChevronRightIcon size={16} className={own.chevron} aria-hidden />
        {t('requestForm.advanced')}
      </Details.Summary>
      <Stack direction="vertical" gap="condensed" className={own.body}>
        <Stack direction="horizontal" gap="condensed" align="center">
          <Checkbox
            checked={draft.joseEnabled}
            onChange={(e) => setDraft({ ...draft, joseEnabled: e.target.checked })}
            data-testid="jose-enabled-checkbox"
          />
          <Text size="small">{t('requestForm.enableJose')}</Text>
        </Stack>
        <Text as="p" size="small" className={styles.muted}>{t('requestForm.joseDescription')}</Text>
        {draft.joseEnabled && (
          <>
            <FormControl>
              <FormControl.Label>{t('requestForm.recipientPublicKey')}</FormControl.Label>
              <FormControl.Caption>{t('requestForm.recipientPublicKeyCaption')}</FormControl.Caption>
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
                aria-label={t('requestForm.decryptResponseAriaLabel')}
                data-testid="jose-decrypt-response-checkbox"
              />
              <Text size="small">{t('requestForm.decryptResponseLabel')}</Text>
            </Stack>
            {draft.joseDecryptResponse && (
              <FormControl>
                <FormControl.Label>{t('requestForm.millsPrivateKey')}</FormControl.Label>
                <FormControl.Caption>
                  {t('requestForm.millsPrivateKeyCaption')}
                  {isEditing && t('requestForm.leaveBlankToKeepKey')}
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
        <FormControl>
          <FormControl.Label>{t('requestForm.fallbackBody')}</FormControl.Label>
          <FormControl.Caption>{t('requestForm.fallbackBodyCaption')}</FormControl.Caption>
          <Textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={2} block data-testid="request-body" />
        </FormControl>
      </Stack>
    </Details>
  )
}
