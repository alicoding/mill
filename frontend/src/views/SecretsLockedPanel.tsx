import type { ReactNode } from 'react'
import type { TFunction } from 'i18next'
import { Blankslate } from '@primer/react/experimental'
import { Button, Stack, Text } from '@primer/react'
import { LockIcon } from '@primer/octicons-react'
import { findCommand, runCommand } from '../shared/commands'
import { vaultErrorKind } from '../shared/secretsCommands'
import { messageOf } from '../shared/userError'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import type { UserError } from '../shared/userError'
import type { VaultBackupTime } from '../shared/bindings'
import styles from './SecretsView.module.css'

// The vault's own locked state (goal 0185 S2, goal 0359's key-mismatch
// branch), split out of SecretsView.tsx (CLAUDE.md's 500-line
// convention) since this is the single largest render branch in that
// view and touches nothing the unlocked list/dialogs below it do.
export function SecretsLockedPanel({
  t, vaultError, protectionStatus, busy, changeInSettingsLink, confirmReset, setConfirmReset,
  vaultBackupTime,
}: {
  t: TFunction<'secrets'>
  vaultError: UserError | null
  protectionStatus: string
  busy: boolean
  changeInSettingsLink: ReactNode
  confirmReset: boolean
  setConfirmReset: (next: boolean) => void
  vaultBackupTime: VaultBackupTime | null
}) {
  // One line, in this view's own words, for each way an unlock ends
  // badly. Anything the tokens don't name falls through to the error
  // itself rather than being hidden.
  const kind = vaultErrorKind(vaultError)
  const isKeyMismatch = kind === 'keyMismatch'
  // The key-mismatch state names the cause in its own heading/body
  // (goal 0359) rather than the generic locked copy plus a red error
  // line -- every other unlock failure keeps today's shape.
  const lockedMessage = {
    keyMismatch: '',
    noKey: t('common:errors.no-vault-key'),
    cancelled: t('common:errors.unlock-cancelled'),
    authUnavailable: t('common:errors.auth-unavailable'),
    other: messageOf(vaultError ?? { code: 'unexpected', message: '' }, t),
    none: '',
  }[kind]
  const resetCommand = findCommand('secrets.resetVault')
  const restoreCommand = findCommand('secrets.restoreVaultFromBackup')

  return (
    <>
      <Blankslate>
        <Blankslate.Visual><LockIcon size={32} /></Blankslate.Visual>
        <Blankslate.Heading>{isKeyMismatch ? t('locked.keyMismatchHeading') : t('locked.heading')}</Blankslate.Heading>
        <Blankslate.Description>{isKeyMismatch ? t('locked.keyMismatchBody') : t('locked.description')}</Blankslate.Description>
        <Stack direction="horizontal" gap="condensed" align="center" justify="center">
          <Text as="p" size="small" className={styles.subtitle} data-testid="secrets-protection-status">{protectionStatus}</Text>
          {changeInSettingsLink}
        </Stack>
        <Stack direction="horizontal" gap="condensed" align="center" justify="center">
          <Button
            variant="primary"
            onClick={() => void runCommand('secrets.unlockVault')}
            disabled={busy}
            data-testid="secrets-unlock-cta"
          >
            {t('locked.cta')}
          </Button>
          {resetCommand?.enabled?.() && (
            <Button onClick={() => setConfirmReset(true)} data-testid="secrets-reset-cta">
              {t('reset.cta')}
            </Button>
          )}
          {restoreCommand?.enabled?.() && (
            <Button onClick={() => void runCommand('secrets.restoreVaultFromBackup')} data-testid="secrets-restore-backup-cta">
              {t('locked.restoreBackupCta')}
            </Button>
          )}
        </Stack>
        {lockedMessage && <Text as="p" size="small" className={styles.error} data-testid="secrets-unlock-error">{lockedMessage}</Text>}
        {isKeyMismatch && vaultBackupTime?.present && (
          <Text as="p" size="small" className={styles.subtitle} data-testid="secrets-vault-backup-caption">
            {t('locked.lastBackup', { time: new Date(vaultBackupTime.time).toLocaleString() })}
          </Text>
        )}
        {restoreCommand?.enabled?.() && (
          <Text as="p" size="small" className={styles.subtitle} data-testid="secrets-restore-backup-caption">
            {t('locked.restoreBackupCaption')}
          </Text>
        )}
      </Blankslate>
      {confirmReset && (
        <ConfirmDialog
          title={t('reset.confirmTitle')}
          body={t('reset.confirmBody')}
          confirmLabel={t('reset.confirmCta')}
          cancelLabel={t('reset.cancel')}
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            setConfirmReset(false)
            void runCommand('secrets.resetVault')
          }}
        />
      )}
    </>
  )
}
