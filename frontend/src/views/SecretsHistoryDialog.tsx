import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, Stack, Text, TextInput } from '@primer/react'
import { EyeClosedIcon, EyeIcon } from '@primer/octicons-react'
import { SecretService } from '../shared/bindings'
import type { SecretEntry } from '../shared/bindings'
import styles from './SecretsView.module.css'

// Read-only past-versions view (goal 0185 S2), backed by KDBX's native
// entry history (secretvault.Vault.History) -- most-recently-superseded
// first. Each row reveals independently: showing an old password never
// forces every other row open too.
export function SecretsHistoryDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation('secrets')
  const [label, setLabel] = useState('')
  const [history, setHistory] = useState<SecretEntry[] | null>(null)
  const [error, setError] = useState('')
  const [revealedIdx, setRevealedIdx] = useState<number | null>(null)

  useEffect(() => {
    SecretService.RevealSecret(id).then((e) => setLabel(e.Title)).catch(() => undefined)
    SecretService.SecretHistory(id).then(setHistory).catch((err) => setError(String(err)))
  }, [id])

  return (
    <Dialog
      title={t('history.heading', { label })}
      onClose={onClose}
      footerButtons={[{ content: t('history.close'), onClick: onClose, autoFocus: true }]}
    >
      {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}
      {history && history.length === 0 && <Text as="p" size="small">{t('history.empty')}</Text>}
      {history && history.length > 0 && (
        <Stack direction="vertical" gap="condensed" data-testid="secret-history-list">
          {history.map((h, i) => (
            <Stack key={i} direction="vertical" gap="none" className={styles.historyRow} data-testid="secret-history-row">
              <Text size="small" className={styles.subtitle}>{new Date(h.UpdatedAt).toLocaleString()}</Text>
              <Stack direction="horizontal" gap="condensed" align="center">
                <TextInput
                  type={revealedIdx === i ? 'text' : 'password'}
                  value={h.Password}
                  readOnly
                  size="small"
                  trailingAction={(
                    <TextInput.Action
                      icon={revealedIdx === i ? EyeClosedIcon : EyeIcon}
                      aria-label={revealedIdx === i ? t('hide') : t('reveal')}
                      onClick={() => setRevealedIdx((cur) => (cur === i ? null : i))}
                    />
                  )}
                />
                {h.Username && <Text size="small" className={styles.subtitle}>{h.Username}</Text>}
              </Stack>
            </Stack>
          ))}
        </Stack>
      )}
    </Dialog>
  )
}
