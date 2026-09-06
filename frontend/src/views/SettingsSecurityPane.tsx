import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Heading, Stack, Text } from '@primer/react'
import { SecretService } from '../shared/bindings'
import { refreshVaultStatus, useVaultStatusStore } from '../shared/vaultStatusStore'
import SecretsLockingSettings from './SecretsLockingSettings'
import SettingsExtensionPolicy from './SettingsExtensionPolicy'
import listStyles from '../shared/ListCard.module.css'
import styles from './SettingsView.module.css'

// Settings > Security (goal 0360 S1 follow-up): the vault's lock
// policy, and the organisation's extension policy (goal 0349 S6) as
// the second section, read-only. 1Password,
// Bitwarden and KeePassXC all keep lock policy under a Security
// settings page rather than inside the credential list itself; the
// Secrets page still opens/browses/edits vault entries, and links here
// (its own status line's "Change in Settings") to change how long the
// vault stays open.
//
// SecretsLockingSettings itself is unchanged from its Secrets-page
// incarnation -- only its `locked` prop is new here, since this pane
// renders regardless of vault state (no unlocked gate the way the old
// Secrets > Locking segment had one).
export default function SettingsSecurityPane() {
  const { t } = useTranslation('secrets')
  const status = useVaultStatusStore((s) => s.vaultStatus)
  const [capability, setCapability] = useState('none')
  const [unlockBusy, setUnlockBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    SecretService.UnlockCapability().then(setCapability).catch(() => setCapability('none'))
    void refreshVaultStatus()
  }, [])

  const toggleUnlockRequirement = (enabled: boolean) => {
    setUnlockBusy(true)
    setError('')
    SecretService.SetTouchIDProtection(enabled)
      .then(() => refreshVaultStatus())
      .catch((err) => setError(String(err)))
      .finally(() => setUnlockBusy(false))
  }

  if (status === null) return null

  return (
    <>
      <Stack direction="vertical" gap="none">
        <Heading as="h2" variant="small" className={styles.paneSectionHeading} data-testid="settings-section-heading">
          {t('sections.vault')}
        </Heading>
        <Text as="p" size="small" className={listStyles.muted}>{t('sections.vaultSubtitle')}</Text>
      </Stack>
      <SecretsLockingSettings
        capability={capability}
        requireAuth={status.RequireAuth}
        authAvailable={status.AuthAvailable}
        unlockBusy={unlockBusy}
        locked={!status.Unlocked}
        onToggleUnlockRequirement={toggleUnlockRequirement}
      />
      {error && <Text as="p" size="small" className={listStyles.error} data-testid="settings-security-error">{error}</Text>}
      <SettingsExtensionPolicy />
    </>
  )
}
