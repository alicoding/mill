import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Checkbox, Dialog, FormControl, Label, Stack, Text } from '@primer/react'
import type { InstallPreview } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { ExtensionsPermissions } from './ExtensionsPermissions'
import { ExtensionsNoticed } from './ExtensionsNoticed'
import { tierLabelKey, tierVariant } from './extensionTrust'
import listStyles from '../shared/ListCard.module.css'

type InstallMode = 'install' | 'update' | 'import'

interface InstallActionState {
	acknowledged: boolean
	onAcknowledgedChange: (acknowledged: boolean) => void
	confirmEnabled: boolean
	cancelEnabled: boolean
	closeLabel?: boolean
}

// The install prompt (docs/goals/0349): every install, at every tier,
// says what the extension can do BEFORE it lands -- the converged
// permission-prompt shape. The unverified tier adds one thing on top
// of that list: an acknowledgment that nothing has reviewed this code,
// which the Install button waits for.
export function ExtensionsInstallDialog({ preview, busy, mode = 'install', refusal = '', onCancel, onInstall, actionState }: {
  preview: InstallPreview
  busy: boolean
  // An update shows the same prompt with its own verbs; the unverified
  // title stays, because it is still unreviewed code landing.
	mode?: InstallMode
  // A refusal the install itself answered with (the organisation's
  // policy, or a static check over the downloaded files) -- shown in
  // place, so the person reads why before the prompt closes.
  refusal?: string
  onCancel: () => void
  onInstall: () => void
	actionState?: InstallActionState
}) {
  const { t } = useTranslation('views')
  const [localAcknowledged, setLocalAcknowledged] = useState(false)
  const acknowledged = actionState?.acknowledged ?? localAcknowledged
  const unverified = preview.Tier === 'unverified'
  const badgeKey = tierLabelKey(preview.Tier)
  const name = preview.Name || preview.ID
  const refused = refusal || preview.PolicyRefusal
  const confirmDisabled = actionState ? !actionState.confirmEnabled : busy || !!refused || (unverified && !acknowledged)
  const cancelDisabled = actionState ? !actionState.cancelEnabled : false
  const cancel = () => {
    if (!cancelDisabled) onCancel()
  }
	const titleKey = installTitleKey(mode, unverified)
	const confirmKey = installConfirmKey(mode, busy)

  return (
    <Dialog
      title={t(titleKey, { name })}
      onClose={cancel}
      footerButtons={[
        { content: t(actionState?.closeLabel ? 'extensions.install.close' : 'extensions.install.cancel'), onClick: cancel, autoFocus: true, disabled: cancelDisabled },
        {
          content: t(confirmKey),
          buttonType: unverified ? 'danger' : 'primary',
          disabled: confirmDisabled,
          onClick: onInstall,
        },
      ]}
    >
		<InstallDialogContent
			preview={preview}
			name={name}
			badgeKey={badgeKey}
			unverified={unverified}
			refused={refused}
			busy={busy}
			acknowledged={acknowledged}
			onAcknowledgedChange={actionState?.onAcknowledgedChange ?? setLocalAcknowledged}
		/>
	</Dialog>
  )
}

function installTitleKey(mode: InstallMode, unverified: boolean): string {
	if (unverified) return 'extensions.install.unreviewedTitle'
	if (mode === 'update') return 'extensions.install.updateTitle'
	if (mode === 'import') return 'extensions.install.importTitle'
	return 'extensions.install.title'
}

function installConfirmKey(mode: InstallMode, busy: boolean): string {
	if (busy) return mode === 'update' ? 'extensions.install.updating' : 'extensions.install.installing'
	if (mode === 'update') return 'extensions.install.updateConfirm'
	if (mode === 'import') return 'extensions.install.importConfirm'
	return 'extensions.install.confirm'
}

function InstallDialogContent({ preview, name, badgeKey, unverified, refused, busy, acknowledged, onAcknowledgedChange }: {
	preview: InstallPreview
	name: string
	badgeKey: string | null
	unverified: boolean
	refused: string
	busy: boolean
	acknowledged: boolean
	onAcknowledgedChange: (acknowledged: boolean) => void
}) {
	const { t } = useTranslation('views')
	return (
		<Stack direction="vertical" gap="condensed" data-testid="extensions-install-dialog">
			<Stack direction="horizontal" gap="condensed" align="center">
				<Text size="small" weight="semibold">{name}</Text>
				{preview.Version && <Text size="small" className={listStyles.muted}>{t('extensions.versionLabel', { version: preview.Version })}</Text>}
				{badgeKey && <Label variant={tierVariant(preview.Tier)} data-testid="extensions-install-tier">{t(badgeKey)}</Label>}
			</Stack>
			{preview.Marketplace && <Text as="p" size="small" className={listStyles.muted}>{t('extensions.fromMarketplace', { marketplace: preview.Marketplace })}</Text>}
			{unverified && <Text as="p" size="small" data-testid="extensions-install-unreviewed-body">{t('extensions.install.unreviewedBody')}</Text>}
			{refused && (
				<Stack direction="vertical" gap="none" data-testid="extensions-install-refusal">
					<Text as="p" size="small" weight="semibold">{t('extensions.policy.refusedTitle')}</Text>
					<Text as="p" size="small" className={listStyles.muted} data-testid="extensions-install-refusal-reason">{refused}</Text>
				</Stack>
			)}
			<ExtensionsPermissions preview={preview} testId="extensions-install-permissions" />
			<ExtensionsNoticed warnings={preview.Warnings ?? []} testId="extensions-install-noticed" />
			{unverified && (
				<FormControl>
					<Checkbox checked={acknowledged} disabled={busy} onChange={(event) => onAcknowledgedChange(event.target.checked)} data-testid="extensions-install-acknowledge" />
					<FormControl.Label>{t('extensions.install.acknowledge')}</FormControl.Label>
				</FormControl>
			)}
		</Stack>
	)
}
