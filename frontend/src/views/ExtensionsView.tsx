import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Banner, Button, Heading, SegmentedControl, Stack, Text } from '@primer/react'
import PageContainer from '../shared/PageContainer'
import { useUISignalStore } from '../shared/uiSignalStore'
import ExtensionsSection from './ExtensionsSection'
import { ExtensionsBrowseTab } from './ExtensionsBrowseTab'
import { ExtensionsUpdatesTab } from './ExtensionsUpdatesTab'
import { ExtensionsPolicyBanner } from './ExtensionsPolicyBanner'
import { refreshUpdates, useExtensionUpdatesStore } from '../shared/extensionUpdatesStore'
import listStyles from '../shared/ListCard.module.css'
import styles from './ExtensionsSection.module.css'
import { findCommand, runCommand } from '../shared/commands'
import { ThemeImportDialog } from './ThemeImportDialog'
import { useExtensionRecoveryStore } from '../shared/extensionRecoveryStore'
import { useExtensionMarketplaceInstallStore } from '../shared/extensionMarketplaceInstallStore'

// Extensions (docs/goals/0349): a destination of its own, not a
// Settings pane -- the shape every surveyed extension platform
// converged on. Three tabs: what is installed, what can be installed,
// and what has a newer version. Settings keeps kernel configuration
// only, and the old `#/settings/extensions` address redirects here
// (shared/viewRedirects.ts).
export type ExtensionsTab = 'installed' | 'browse' | 'updates'

const TABS: ExtensionsTab[] = ['installed', 'browse', 'updates']

function tabFrom(value: string | undefined): ExtensionsTab {
  return TABS.includes(value as ExtensionsTab) ? (value as ExtensionsTab) : 'installed'
}

export default function ExtensionsView({ initialTab }: { initialTab?: string } = {}) {
  const { t } = useTranslation('views')
  const [tab, setTab] = useState<ExtensionsTab>(tabFrom(initialTab))
  const sourcesRequest = useUISignalStore((s) => s.extensionSourcesRequest)
  const installedRequest = useUISignalStore((s) => s.extensionInstalledRequest)
  const consumeInstalledRequest = useUISignalStore((s) => s.consumeExtensionInstalledRequest)
  const importRequest = useUISignalStore((s) => s.extensionThemeImportRequest)
  const consumeImportRequest = useUISignalStore((s) => s.consumeExtensionThemeImport)
  const [importOpen, setImportOpen] = useState(false)
  const recovery = useExtensionRecoveryStore()
  useExtensionMarketplaceInstallStore((state) => state.phase)
  useExtensionUpdatesStore((state) => state.bulkActive)
  useEffect(() => {
    if (importRequest) {
      setImportOpen(true)
      consumeImportRequest()
    }
  }, [consumeImportRequest, importRequest])
  // A palette "marketplace sources" ask lands on Browse, where the
  // dialog lives.
  useEffect(() => {
    if (sourcesRequest > 0) setTab('browse')
  }, [sourcesRequest])
  useEffect(() => {
    if (installedRequest > 0) {
      setImportOpen(false)
      setTab('installed')
      consumeInstalledRequest(installedRequest)
    }
  }, [consumeInstalledRequest, installedRequest])

  // The badge counts the LAST check's candidates; opening the page
  // reads that record and never fetches.
  const updateCount = useExtensionUpdatesStore((s) => s.candidates.length)
  useEffect(() => { void refreshUpdates() }, [])
  const importCommand = findCommand('extensions.importTheme')
  const canImport = importCommand !== undefined && (importCommand.enabled?.() ?? true)
  const recoveryCommand = findCommand('extensions.retryRecovery')
  const canRetryRecovery = recoveryCommand !== undefined && (recoveryCommand.enabled?.() ?? true)

  return (
    <PageContainer variant="wide" data-testid="extensions-view">
      <Stack direction="vertical" gap="none">
        <Stack direction="horizontal" justify="space-between" align="center" gap="condensed">
          <Heading as="h1" id="extensions-heading">{t('extensions.heading')}</Heading>
          <Button disabled={!canImport} onClick={() => void runCommand('extensions.importTheme')} data-testid="extensions-import-theme">
            {t('extensions.themeImport.button')}
          </Button>
        </Stack>
        <Text as="p" size="small" className={listStyles.muted}>{t('extensions.subtitle')}</Text>
      </Stack>

      <ExtensionsPolicyBanner />
      {recovery.unresolved && (
        <Banner
          variant="critical"
          title={t('extensions.recovery.title')}
          description={<Stack direction="vertical" gap="condensed"><Text>{t('extensions.recovery.message')}</Text>{recovery.detail && <Text>{recovery.detail}</Text>}</Stack>}
          primaryAction={<Banner.PrimaryAction disabled={!canRetryRecovery} onClick={() => { void runCommand('extensions.retryRecovery') }}>{t('extensions.recovery.retry')}</Banner.PrimaryAction>}
          data-testid="extensions-recovery-banner"
        />
      )}

      <SegmentedControl
        aria-label={t('extensions.tabsAria')}
        className={styles.tabs}
        data-testid="extensions-tabs"
        onChange={(index) => {
          const next = TABS[index]
          if (next) setTab(next)
        }}
      >
        {TABS.map((id) => (
          <SegmentedControl.Button
            key={id}
            selected={tab === id}
            data-testid={`extensions-tab-${id}`}
          >
            {id === 'updates' && updateCount > 0 ? t('extensions.tabs.updatesCount', { count: updateCount }) : t(`extensions.tabs.${id}`)}
          </SegmentedControl.Button>
        ))}
      </SegmentedControl>

      {tab === 'installed' && <ExtensionsSection />}
      {tab === 'browse' && <ExtensionsBrowseTab sourcesRequest={sourcesRequest} />}
      {tab === 'updates' && <ExtensionsUpdatesTab />}
      {importOpen && <ThemeImportDialog onClose={() => setImportOpen(false)} />}
    </PageContainer>
  )
}
