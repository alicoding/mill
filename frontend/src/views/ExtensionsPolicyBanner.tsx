import { useTranslation } from 'react-i18next'
import { Banner } from '@primer/react'
import { usePluginPolicy } from '../shared/pluginPolicyStore'

// The managed-Mac banner above Extensions (goal 0349 S6): when an
// organisation's policy file is present, every tab says so before any
// row -- the reader learns who decides what installs here, not that a
// particular button is missing. A policy file that cannot be read is
// its own banner, in the critical tone, because it has closed the door
// on every installed extension until an administrator fixes it.
export function ExtensionsPolicyBanner() {
  const { t } = useTranslation('views')
  const policy = usePluginPolicy()
  if (!policy?.Managed) return null
  if (policy.Error) {
    return (
      <Banner
        variant="critical"
        title={t('extensions.policy.unreadableTitle')}
        description={policy.Error}
        data-testid="extensions-policy-banner"
      />
    )
  }
  return (
    <Banner
      variant="info"
      title={t('extensions.policy.managedBy', { org: policy.ManagedBy })}
      description={t('extensions.policy.managedCaption')}
      data-testid="extensions-policy-banner"
    />
  )
}
