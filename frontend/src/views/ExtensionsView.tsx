import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Heading, SegmentedControl, Stack, Text } from '@primer/react'
import PageContainer from '../shared/PageContainer'
import { useUISignalStore } from '../shared/uiSignalStore'
import { notifyPluginRemoved } from '../shared/pluginRemoveSignal'
import ExtensionsSection from './ExtensionsSection'
import { ExtensionsBrowseTab } from './ExtensionsBrowseTab'
import { ExtensionsUpdatesTab } from './ExtensionsUpdatesTab'
import { ExtensionsUpdateDialogHost } from './ExtensionsUpdateDialogHost'
import { refreshUpdates, useExtensionUpdatesStore } from '../shared/extensionUpdatesStore'
import listStyles from '../shared/ListCard.module.css'
import styles from './ExtensionsSection.module.css'

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
  // A palette "marketplace sources" ask lands on Browse, where the
  // dialog lives.
  const [seenSources, setSeenSources] = useState(sourcesRequest)
  useEffect(() => {
    if (sourcesRequest !== seenSources) {
      setSeenSources(sourcesRequest)
      setTab('browse')
    }
  }, [sourcesRequest, seenSources])

  // An install changes what the Installed tab shows; the same signal
  // a removal raises re-reads it.
  const onInstalled = useCallback(() => {
    notifyPluginRemoved()
    setTab('installed')
  }, [])

  // The badge counts the LAST check's candidates; opening the page
  // reads that record and never fetches.
  const updateCount = useExtensionUpdatesStore((s) => s.candidates.length)
  useEffect(() => { void refreshUpdates() }, [])

  return (
    <PageContainer variant="wide" data-testid="extensions-view">
      <Stack direction="vertical" gap="none">
        <Heading as="h1" id="extensions-heading">{t('extensions.heading')}</Heading>
        <Text as="p" size="small" className={listStyles.muted}>{t('extensions.subtitle')}</Text>
      </Stack>

      <SegmentedControl aria-label={t('extensions.tabsAria')} className={styles.tabs} data-testid="extensions-tabs">
        {TABS.map((id) => (
          <SegmentedControl.Button
            key={id}
            selected={tab === id}
            onClick={() => setTab(id)}
            data-testid={`extensions-tab-${id}`}
          >
            {id === 'updates' && updateCount > 0 ? t('extensions.tabs.updatesCount', { count: updateCount }) : t(`extensions.tabs.${id}`)}
          </SegmentedControl.Button>
        ))}
      </SegmentedControl>

      {tab === 'installed' && <ExtensionsSection />}
      {tab === 'browse' && <ExtensionsBrowseTab sourcesRequest={sourcesRequest} onInstalled={onInstalled} />}
      {tab === 'updates' && <ExtensionsUpdatesTab />}
      <ExtensionsUpdateDialogHost />
    </PageContainer>
  )
}
