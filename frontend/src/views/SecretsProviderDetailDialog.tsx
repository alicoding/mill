import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, FormControl, IconButton, Text, TextInput } from '@primer/react'
import { CopyIcon, EyeClosedIcon, EyeIcon } from '@primer/octicons-react'
import { SecretService } from '../shared/bindings'
import { entityRowContext } from '../shared/entityRowCommands'
import { runCommand } from '../shared/commands'
import styles from './SecretsView.module.css'

// The read-only counterpart to SecretsDetailDialog, for a row backed by
// a configured source rather than the vault (goal 0408 S2): the value
// is read live through the same audited resolve every reveal/copy
// action already gives a vault entry, but there is no Edit or Delete --
// the source's own file owns this key -- so the footer offers Access
// history and Open source instead.
export function SecretsProviderDetailDialog({ id, keyName, sourceLabel, onClose, onAccessHistory }: {
  id: string
  keyName: string
  sourceLabel: string
  onClose: () => void
  onAccessHistory: () => void
}) {
  const { t } = useTranslation('secrets')
  const [value, setValue] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    SecretService.RevealProviderSecret(id).then(setValue).catch((err) => setError(String(err)))
  }, [id])

  const copy = () => {
    SecretService.CopyProviderSecretToClipboard(id).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch((err) => setError(String(err)))
  }

  return (
    <Dialog
      title={keyName}
      onClose={onClose}
      footerButtons={[
        { content: t('accessHistory.button'), onClick: onAccessHistory },
        {
          content: t('providerDetail.openSource'),
          buttonType: 'primary',
          onClick: () => { onClose(); void runCommand('secret.row.openSource', entityRowContext('secret', id)) },
        },
      ]}
    >
      {error && <Text as="p" size="small" className={styles.error} data-testid="secret-provider-detail-error">{error}</Text>}
      {value !== null && (
        <FormControl>
          <FormControl.Label>{t('fields.value')}</FormControl.Label>
          <Text as="p" size="small" className={styles.subtitle} data-testid="secret-provider-detail-source">
            {t('providerDetail.sourceCaption', { source: sourceLabel })}
          </Text>
          <TextInput
            type={revealed ? 'text' : 'password'}
            value={value}
            readOnly
            block
            trailingAction={(
              <TextInput.Action
                icon={revealed ? EyeClosedIcon : EyeIcon}
                aria-label={revealed ? t('hide') : t('reveal')}
                onClick={() => setRevealed((r) => !r)}
              />
            )}
            data-testid="secret-provider-detail-value"
          />
          <IconButton icon={CopyIcon} aria-label={t('copy')} size="small" variant="invisible" onClick={copy} data-testid="secret-provider-detail-copy" />
          {copied && <FormControl.Caption data-testid="secret-provider-detail-copied">{t('copied')}</FormControl.Caption>}
        </FormControl>
      )}
    </Dialog>
  )
}
