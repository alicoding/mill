import { useTranslation } from 'react-i18next'
import { Heading, Stack, Text } from '@primer/react'
import { usePluginPolicy } from '../shared/pluginPolicyStore'
import { capabilityDeedKey, tierLabelKey } from './extensionTrust'
import { SettingsRow } from './SettingsRow'
import listStyles from '../shared/ListCard.module.css'
import styles from './SettingsView.module.css'

// The extension trust policy under Settings > Security (goal 0349 S6):
// read-only, because the file is the administrator's -- delivered by
// device management, never edited from here. The managed-browser and
// managed-editor convention: Settings SHOWS what the organisation
// decided so a person can see why an install was refused; changing it
// is a conversation with whoever manages the Mac.
const MANAGED_EXTENSIONS_DOCS_PAGE = 'reference/managed-extensions.md'

export default function SettingsExtensionPolicy() {
  const { t } = useTranslation('views')
  const policy = usePluginPolicy()
  const list = (values: string[] | null | undefined, emptyKey: string): string =>
    (values ?? []).length > 0 ? (values ?? []).join(', ') : t(emptyKey)
  return (
    <Stack direction="vertical" gap="none" data-testid="settings-extension-policy">
      <Heading as="h2" variant="small" className={styles.paneSectionHeading} data-testid="settings-section-heading">
        {t('extensions.policy.settingsHeading')}
      </Heading>
      <Text as="p" size="small" className={listStyles.muted}>{t('extensions.policy.settingsSubtitle')}</Text>
      {policy !== null && !policy.Managed && (
        <Text as="p" size="small" className={listStyles.muted} data-testid="settings-extension-policy-none">
          {t('extensions.policy.none')}
        </Text>
      )}
      {policy?.Managed && policy.Error && (
        <Text as="p" size="small" className={listStyles.error} data-testid="settings-extension-policy-error">{policy.Error}</Text>
      )}
      {policy?.Managed && !policy.Error && (
        <>
          <SettingsRow label={t('extensions.policy.managedByLabel')}>
            <Text size="small" data-testid="settings-extension-policy-managed-by">{policy.ManagedBy}</Text>
          </SettingsRow>
          <SettingsRow label={t('extensions.policy.requiredTierLabel')}>
            <Text size="small" data-testid="settings-extension-policy-tier">
              {tierLabelKey(policy.RequiredTier) ? t(tierLabelKey(policy.RequiredTier) as string) : t('extensions.policy.tierAny')}
            </Text>
          </SettingsRow>
          <SettingsRow label={t('extensions.policy.blockedCapabilitiesLabel')}>
            <Text size="small" data-testid="settings-extension-policy-capabilities">
              {list((policy.BlockedCapabilities ?? []).map((c) => t(capabilityDeedKey(c))), 'extensions.policy.noneValue')}
            </Text>
          </SettingsRow>
          <SettingsRow label={t('extensions.policy.allowedSourcesLabel')}>
            <Text size="small" data-testid="settings-extension-policy-sources">{list(policy.AllowedSources, 'extensions.policy.anySource')}</Text>
          </SettingsRow>
          <SettingsRow label={t('extensions.policy.listsLabel')}>
            <Text size="small">{t('extensions.policy.listsValue', { allow: policy.AllowCount, block: policy.BlockCount })}</Text>
          </SettingsRow>
          <SettingsRow label={t('extensions.policy.fileLabel')} caption={t('extensions.policy.fileCaption')} docsPage={MANAGED_EXTENSIONS_DOCS_PAGE}>
            <Text size="small" className={listStyles.muted} data-testid="settings-extension-policy-path">{policy.Path}</Text>
          </SettingsRow>
        </>
      )}
    </Stack>
  )
}
