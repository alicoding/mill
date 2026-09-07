import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Checkbox, Dialog, FormControl, Label, Stack, Text } from '@primer/react'
import type { InstallPreview } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { ExtensionsPermissions } from './ExtensionsPermissions'
import { ExtensionsNoticed } from './ExtensionsNoticed'
import { tierLabelKey, tierVariant } from './extensionTrust'
import listStyles from '../shared/ListCard.module.css'

// The install prompt (docs/goals/0349): every install, at every tier,
// says what the extension can do BEFORE it lands -- the converged
// permission-prompt shape. The unverified tier adds one thing on top
// of that list: an acknowledgment that nothing has reviewed this code,
// which the Install button waits for.
export function ExtensionsInstallDialog({ preview, busy, mode = 'install', refusal = '', onCancel, onInstall }: {
  preview: InstallPreview
  busy: boolean
  // An update shows the same prompt with its own verbs; the unverified
  // title stays, because it is still unreviewed code landing.
  mode?: 'install' | 'update'
  // A refusal the install itself answered with (the organisation's
  // policy, or a static check over the downloaded files) -- shown in
  // place, so the person reads why before the prompt closes.
  refusal?: string
  onCancel: () => void
  onInstall: () => void
}) {
  const { t } = useTranslation('views')
  const [acknowledged, setAcknowledged] = useState(false)
  const unverified = preview.Tier === 'unverified'
  const badgeKey = tierLabelKey(preview.Tier)
  const name = preview.Name || preview.ID
  const refused = refusal || preview.PolicyRefusal
  const confirmDisabled = busy || !!refused || (unverified && !acknowledged)
  const titleKey = unverified ? 'extensions.install.unreviewedTitle' : mode === 'update' ? 'extensions.install.updateTitle' : 'extensions.install.title'

  return (
    <Dialog
      title={t(titleKey, { name })}
      onClose={onCancel}
      footerButtons={[
        { content: t('extensions.install.cancel'), onClick: onCancel, autoFocus: true },
        {
          content: t(mode === 'update' ? 'extensions.install.updateConfirm' : 'extensions.install.confirm'),
          buttonType: unverified ? 'danger' : 'primary',
          disabled: confirmDisabled,
          onClick: onInstall,
        },
      ]}
    >
      <Stack direction="vertical" gap="condensed" data-testid="extensions-install-dialog">
        <Stack direction="horizontal" gap="condensed" align="center">
          <Text size="small" weight="semibold">{name}</Text>
          {preview.Version && <Text size="small" className={listStyles.muted}>{t('extensions.versionLabel', { version: preview.Version })}</Text>}
          {badgeKey && (
            <Label variant={tierVariant(preview.Tier)} data-testid="extensions-install-tier">{t(badgeKey)}</Label>
          )}
        </Stack>
        {preview.Marketplace && (
          <Text as="p" size="small" className={listStyles.muted}>
            {t('extensions.fromMarketplace', { marketplace: preview.Marketplace })}
          </Text>
        )}
        {unverified && (
          <Text as="p" size="small" data-testid="extensions-install-unreviewed-body">
            {t('extensions.install.unreviewedBody')}
          </Text>
        )}
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
            <Checkbox
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              data-testid="extensions-install-acknowledge"
            />
            <FormControl.Label>{t('extensions.install.acknowledge')}</FormControl.Label>
          </FormControl>
        )}
      </Stack>
    </Dialog>
  )
}
