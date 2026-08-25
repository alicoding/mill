import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, FormControl, IconButton, Stack, Text, TextInput } from '@primer/react'
import { CopyIcon, EyeClosedIcon, EyeIcon } from '@primer/octicons-react'
import { SecretService } from '../shared/bindings'
import type { SecretEntry } from '../shared/bindings'
import styles from './SecretsView.module.css'

// The reveal/copy surface (goal 0185 S2) -- a row click opens this,
// never an edit form directly: Password stays masked behind asterisks
// until the user explicitly clicks Show, and Copy writes to the OS
// clipboard through SecretService.CopySecretToClipboard, which
// auto-clears after 10s server-side (secretservice_autolock.go) -- no
// clipboard timer logic lives in this component.
export function SecretsDetailDialog({ id, onClose, onEdit, onHistory, onAccessHistory, onDelete }: {
  id: string
  onClose: () => void
  onEdit: () => void
  onHistory: () => void
  onAccessHistory: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation('secrets')
  const [entry, setEntry] = useState<SecretEntry | null>(null)
  const [error, setError] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    SecretService.RevealSecret(id).then(setEntry).catch((err) => setError(String(err)))
  }, [id])

  const copy = () => {
    SecretService.CopySecretToClipboard(id).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch((err) => setError(String(err)))
  }

  return (
    <Dialog
      title={entry?.Title ?? ''}
      onClose={onClose}
      footerButtons={[
        { content: t('accessHistory.button'), onClick: onAccessHistory },
        { content: t('historyButton'), onClick: onHistory },
        { content: t('deleteButton'), buttonType: 'danger', onClick: onDelete },
        { content: t('editButton'), buttonType: 'primary', onClick: onEdit },
      ]}
    >
      {error && <Text as="p" size="small" className={styles.error} data-testid="secret-detail-error">{error}</Text>}
      {entry && (
        <Stack direction="vertical" gap="condensed">
          {entry.Username && (
            <FormControl>
              <FormControl.Label>{t('detail.usernameLabel')}</FormControl.Label>
              <TextInput value={entry.Username} readOnly block />
            </FormControl>
          )}
          <FormControl>
            <FormControl.Label>{t('fields.password')}</FormControl.Label>
            <Stack direction="horizontal" gap="condensed" align="center">
              <TextInput
                type={revealed ? 'text' : 'password'}
                value={entry.Password}
                readOnly
                block
                data-testid="secret-detail-password"
                trailingAction={(
                  <TextInput.Action
                    icon={revealed ? EyeClosedIcon : EyeIcon}
                    aria-label={revealed ? t('hide') : t('reveal')}
                    onClick={() => setRevealed((r) => !r)}
                  />
                )}
              />
              <IconButton icon={CopyIcon} aria-label={t('copy')} size="small" variant="invisible" onClick={copy} data-testid="secret-detail-copy" />
            </Stack>
            {copied && <Text as="p" size="small" data-testid="secret-detail-copied">{t('copied')}</Text>}
          </FormControl>
          {entry.URL && (
            <FormControl>
              <FormControl.Label>{t('detail.urlLabel')}</FormControl.Label>
              <TextInput value={entry.URL} readOnly block />
            </FormControl>
          )}
          {entry.Notes && (
            <FormControl>
              <FormControl.Label>{t('detail.notesLabel')}</FormControl.Label>
              <Text as="p" size="small">{entry.Notes}</Text>
            </FormControl>
          )}
          {entry.Tags && (
            <FormControl>
              <FormControl.Label>{t('detail.tagsLabel')}</FormControl.Label>
              <Text as="p" size="small">{entry.Tags}</Text>
            </FormControl>
          )}
        </Stack>
      )}
    </Dialog>
  )
}
