import { useTranslation } from 'react-i18next'
import { Checkbox, FormControl, Stack, Text, Textarea } from '@primer/react'
import type { RequestDraft } from './requestDraft'
import { SecretPicker } from '../shared/SecretPicker'
import { secretTitleFor } from './secretTitleFor'
import { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/secret/models'
import { AdvancedDisclosure } from './AdvancedDisclosure'
import styles from '../shared/ListCard.module.css'

// The form's one disclosure (goal 0315): what a rare integration needs
// and every other one never sees -- JWE body encryption and the
// schema-less fallback body. Closed by default, open whenever
// anything inside holds a value, so an edited record shows its own
// settings without a hunt.
export function requestAdvancedIsSet(draft: RequestDraft): boolean {
  return draft.joseEnabled || draft.body.trim() !== ''
}

export function RequestAdvancedSection({ draft, setDraft }: {
  draft: RequestDraft
  setDraft: (d: RequestDraft) => void
}) {
  const { t } = useTranslation('configure')
  return (
    <AdvancedDisclosure open={requestAdvancedIsSet(draft)} testId="request-advanced">
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
            <SecretPicker
              value={draft.joseRecipientPublicKeyRef}
              onChange={(ref) => setDraft({ ...draft, joseRecipientPublicKeyRef: ref })}
              kinds={[Kind.KindKey, Kind.KindText]}
              newEntryTitle={secretTitleFor(draft.label, t('requestForm.recipientPublicKey'))}
              ariaLabel={t('requestForm.recipientPublicKey')}
              testID="jose-recipient-public-key"
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
              <FormControl.Caption>{t('requestForm.millsPrivateKeyCaption')}</FormControl.Caption>
              <SecretPicker
                value={draft.josePrivateKeyRef}
                onChange={(ref) => setDraft({ ...draft, josePrivateKeyRef: ref })}
                kinds={[Kind.KindKey]}
                newEntryTitle={secretTitleFor(draft.label, t('requestForm.millsPrivateKey'))}
                ariaLabel={t('requestForm.millsPrivateKey')}
                testID="jose-private-key"
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
    </AdvancedDisclosure>
  )
}
