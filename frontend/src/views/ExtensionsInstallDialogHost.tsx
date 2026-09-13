import { useEffect } from 'react'
import { Dialog, Spinner, Stack, Text } from '@primer/react'
import { useTranslation } from 'react-i18next'
import type { CommandContext } from '../shared/commandContext'
import { findCommand, runCommand } from '../shared/commands'
import { useExtensionMarketplaceInstallStore } from '../shared/extensionMarketplaceInstallStore'
import { ExtensionsInstallDialog } from './ExtensionsInstallDialog'
import listStyles from '../shared/ListCard.module.css'

export function ExtensionsInstallDialogHost() {
  const { t } = useTranslation('views')
  const state = useExtensionMarketplaceInstallStore()
	const { operationId, phase, visible, preview, error, retryable, expiresAt, acknowledged, mode, markExpired } = state
  const attempt: CommandContext | null = operationId ? { kind: 'extensionInstallAttempt', operationId } : null

  useEffect(() => {
    if (!operationId || phase !== 'ready' || !expiresAt) return
    const delay = Math.max(0, Date.parse(expiresAt) - Date.now())
		const timer = window.setTimeout(() => markExpired(operationId), delay)
		return () => window.clearTimeout(timer)
	}, [expiresAt, markExpired, operationId, phase])

  if (!visible || !attempt) return null
  const dismiss = () => { void runCommand('extensions.install.dismiss', attempt) }
  if (phase === 'reserved' || phase === 'preparing') {
    return (
      <Dialog
        title={t('extensions.install.preparingTitle')}
        onClose={dismiss}
        footerButtons={[{
          content: t('extensions.install.cancel'), onClick: dismiss, autoFocus: true,
          disabled: !commandEnabled('extensions.install.dismiss', attempt),
        }]}
      >
        <Stack direction="horizontal" gap="condensed" align="center" role="status" data-testid="extensions-install-loading">
          <Spinner size="small" />
          <Text size="small">{t('extensions.install.loadingBody')}</Text>
        </Stack>
      </Dialog>
    )
  }
  if (phase === 'error') {
    return (
      <Dialog
        title={t('extensions.install.errorTitle')}
        onClose={dismiss}
        footerButtons={[
          {
            content: t('extensions.install.close'), onClick: dismiss, autoFocus: true,
            disabled: !commandEnabled('extensions.install.dismiss', attempt),
          },
          ...(retryable ? [{
            content: t('extensions.install.retry'), buttonType: 'primary' as const,
            onClick: () => { void runCommand('extensions.install.retry', attempt) },
            disabled: !commandEnabled('extensions.install.retry', attempt),
          }] : []),
        ]}
      >
        <Text as="p" size="small" className={listStyles.error} data-testid="extensions-install-error">{error}</Text>
      </Dialog>
    )
  }
  if (!preview) return null
  const committing = phase === 'committing'
  return (
    <ExtensionsInstallDialog
      preview={preview}
      mode={mode}
      busy={committing}
      onCancel={dismiss}
      onInstall={() => { void runCommand('extensions.install.confirm', attempt) }}
      actionState={{
        acknowledged,
        onAcknowledgedChange: state.setAcknowledged,
        confirmEnabled: commandEnabled('extensions.install.confirm', attempt),
        cancelEnabled: commandEnabled('extensions.install.dismiss', attempt),
        closeLabel: committing,
      }}
    />
  )
}

function commandEnabled(id: string, context: CommandContext): boolean {
  const command = findCommand(id)
  return command !== undefined && (command.enabled?.(context) ?? true)
}
