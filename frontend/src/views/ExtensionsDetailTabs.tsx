import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Label, SegmentedControl, Stack, Text } from '@primer/react'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import type { InstallPreview, PluginInfo } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { OutputViewer } from '../shared/OutputViewer'
import { settingDeclsFromManifest } from '../plugins/pluginSettings'
import { ExtensionSettingControl } from './ExtensionSettingControl'
import { ExtensionsPermissions } from './ExtensionsPermissions'
import { tierLabelKey, tierVariant, verificationKey } from './extensionTrust'
import listStyles from '../shared/ListCard.module.css'
import styles from './ExtensionsSection.module.css'

// An installed extension's detail, split the way every surveyed
// extension platform splits it (docs/goals/0349): what it IS, what it
// ADDS, what CHANGED, what CHECKED it, and what you can set.
export type ExtensionDetailTab = 'overview' | 'contributions' | 'changelog' | 'verification' | 'settings'

const TAB_ORDER: ExtensionDetailTab[] = ['overview', 'contributions', 'changelog', 'verification', 'settings']

export function ExtensionsDetailTabStrip({ active, onSelect, hasSettings }: {
  active: ExtensionDetailTab
  onSelect: (tab: ExtensionDetailTab) => void
  hasSettings: boolean
}) {
  const { t } = useTranslation('views')
  const tabs = TAB_ORDER.filter((tab) => tab !== 'settings' || hasSettings)
  return (
    <SegmentedControl
      aria-label={t('extensions.detailTabsAria')}
      className={styles.detailTabs}
      data-testid="extensions-detail-tabs"
      size="small"
    >
      {tabs.map((tab) => (
        <SegmentedControl.Button
          key={tab}
          selected={active === tab}
          onClick={() => onSelect(tab)}
          data-testid={`extensions-detail-tab-${tab}`}
        >
          {t(`extensions.detailTabs.${tab}`)}
        </SegmentedControl.Button>
      ))}
    </SegmentedControl>
  )
}

// The document tabs read the plugin's own README/CHANGELOG through the
// one output surface, in its rendered markdown view -- never a raw
// slab of text, and never the plugin's own HTML.
export function ExtensionsDocTab({ pluginId, file, emptyKey, site }: {
  pluginId: string
  file: 'README.md' | 'CHANGELOG.md'
  emptyKey: string
  site: string
}) {
  const { t } = useTranslation('views')
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    PluginService.ReadPluginDoc(pluginId, file)
      .then((value) => { if (live) setText(value ?? '') })
      .catch(() => { if (live) setText('') })
    return () => { live = false }
  }, [pluginId, file])

  if (text === null) return null
  if (text.trim() === '') {
    return <Text as="p" size="small" className={listStyles.muted} data-testid={`${site}-empty`}>{t(emptyKey)}</Text>
  }
  return <OutputViewer value={text} shape="markdown" site={site} />
}

// What actually checked these bytes, in plain sentences, beside the
// same "what it can do" list the install prompt showed.
export function ExtensionsVerificationTab({ plugin, changed }: {
  plugin: PluginInfo
  changed: boolean
}) {
  const { t } = useTranslation('views')
  const [preview, setPreview] = useState<InstallPreview | null>(null)
  const tier = plugin.Tier ?? ''
  const badgeKey = tierLabelKey(tier)

  useEffect(() => {
    let live = true
    PluginService.PreviewInstalled(plugin.Manifest.id)
      .then((pv) => { if (live) setPreview(pv) })
      .catch(() => { if (live) setPreview(null) })
    return () => { live = false }
  }, [plugin.Manifest.id])

  return (
    <Stack direction="vertical" gap="condensed" data-testid="extensions-verification">
      <Stack direction="horizontal" gap="condensed" align="center">
        {badgeKey && <Label variant={tierVariant(tier)} data-testid="extensions-verification-tier">{t(badgeKey)}</Label>}
        {plugin.Marketplace && (
          <Text size="small" className={listStyles.muted}>{t('extensions.fromMarketplace', { marketplace: plugin.Marketplace })}</Text>
        )}
      </Stack>
      <Text as="p" size="small" data-testid="extensions-verification-sentence">
        {t(verificationKey(tier, changed))}
      </Text>
      {plugin.SigningPolicy && (
        <Text as="p" size="small" className={listStyles.muted}>
          {t(plugin.Signed ? 'extensions.verification.signaturePresent' : 'extensions.verification.signatureMissing')}
        </Text>
      )}
      <ExtensionsPermissions preview={preview} testId="extensions-verification-permissions" />
    </Stack>
  )
}

// The declared settings, on their own tab so the pane's first screen
// is what the extension is rather than a form.
export function ExtensionsSettingsTab({ plugin }: { plugin: PluginInfo }) {
  const settings = settingDeclsFromManifest(plugin.Manifest)
  return (
    <Stack direction="vertical" gap="condensed" data-testid="extensions-detail-settings">
      {settings.map((setting) => (
        <ExtensionSettingControl key={setting.key} extensionId={plugin.Manifest.id} setting={setting} />
      ))}
    </Stack>
  )
}
