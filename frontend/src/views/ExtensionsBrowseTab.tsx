import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Banner, Button, Label, Pagination, Spinner, Stack, Text } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { PackageIcon } from '@primer/octicons-react'
import { ListToolbar } from '../shared/ListToolbar'
import { LIST_PAGE_SIZE, clampPage, listCountLabel, pageCountFor, pageItems } from '../shared/listStandard'
import { useListState } from '../shared/useListState'
import { appTranslate, messageFor } from '../shared/userError'
import { findCommand, runCommand } from '../shared/commands'
import type { CommandContext } from '../shared/commandContext'
import { useExtensionSourcesStore } from '../shared/extensionSourcesStore'
import { useExtensionMarketplaceInstallStore } from '../shared/extensionMarketplaceInstallStore'
import { useUISignalStore } from '../shared/uiSignalStore'
import { usePluginPolicy } from '../shared/pluginPolicyStore'
import { filterBrowseEntries } from './extensionsBrowseFilter'
import { ExtensionsInstallDialog } from './ExtensionsInstallDialog'
import { ExtensionsSourcesDialog } from './ExtensionsSourcesDialog'
import { ExtensionsKindChips } from './ExtensionsKindChips'
import { tierLabelKey, tierVariant } from './extensionTrust'
import listStyles from '../shared/ListCard.module.css'
import styles from './ExtensionsSection.module.css'

export function ExtensionsBrowseTab({ sourcesRequest }: {
  sourcesRequest: number
}) {
  const { t } = useTranslation('views')
  const result = useExtensionSourcesStore((state) => state.browse)
  const loading = useExtensionSourcesStore((state) => state.browseLoading)
  const error = useExtensionSourcesStore((state) => state.browseError)
  const query = useExtensionSourcesStore((state) => state.browseQuery)
  const kinds = useExtensionSourcesStore((state) => state.browseKinds)
  const completionRevision = useExtensionSourcesStore((state) => state.completionRevision)
  const load = useExtensionSourcesStore((state) => state.loadBrowse)
  const setQuery = useExtensionSourcesStore((state) => state.setBrowseQuery)
  const setKinds = useExtensionSourcesStore((state) => state.setBrowseKinds)
  usePluginPolicy()
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const consumeSourcesRequest = useUISignalStore((state) => state.consumeExtensionSourcesRequest)
  const install = useExtensionMarketplaceInstallStore()
  const { preview, target, phase, refusal, acknowledged, setAcknowledged, mountOwner, retireOwner } = install
  const searchRef = useRef<HTMLInputElement>(null)
  const { state, setPage, resetPage } = useListState('extensions-browse')

  useEffect(() => { void load() }, [completionRevision, load])

  useEffect(() => {
    const ownerToken = mountOwner()
    return () => retireOwner(ownerToken)
  }, [mountOwner, retireOwner])

  useEffect(() => {
    if (sourcesRequest > 0) {
      setSourcesOpen(true)
      consumeSourcesRequest(sourcesRequest)
    }
  }, [consumeSourcesRequest, sourcesRequest])

  const openSources = () => { void runCommand('extensions.sources') }
  const clearFilters = async () => {
    if (await runCommand('extension.browse.clearFilters')) {
      resetPage()
      requestAnimationFrame(() => searchRef.current?.focus())
    }
  }

  if (result === null && (loading || error === '')) {
    return (
      <>
        <Stack direction="horizontal" gap="condensed" align="center" data-testid="extensions-browse-loading">
          <Spinner size="small" />
          <Text size="small">{t('extensions.browse.loading')}</Text>
        </Stack>
        {sourcesOpen && <ExtensionsSourcesDialog onClose={() => setSourcesOpen(false)} />}
      </>
    )
  }

  if (result === null) {
    return (
      <>
        <Stack direction="vertical" gap="condensed" data-testid="extensions-browse-read-error">
          <Blankslate>
            <Blankslate.Heading>{t('extensions.browse.readErrorHeading')}</Blankslate.Heading>
            <Blankslate.Description>{t('extensions.browse.readErrorDescription')}</Blankslate.Description>
            <Blankslate.PrimaryAction onClick={() => { void runCommand('extension.browse.retry') }}>
              {t('extensions.browse.retry')}
            </Blankslate.PrimaryAction>
          </Blankslate>
          <Text size="small" className={listStyles.error}>{messageFor(error, appTranslate)}</Text>
        </Stack>
        {sourcesOpen && <ExtensionsSourcesDialog onClose={() => setSourcesOpen(false)} />}
      </>
    )
  }

  const entries = result.Entries ?? []
  const sources = result.Sources ?? []
  const installedStateReady = result.InstalledStateReady
  const available = installedStateReady ? entries.filter((entry) => !entry.Installed) : entries
  const allMatching = filterBrowseEntries(entries, query, kinds)
  const installedMatches = installedStateReady ? allMatching.filter((entry) => entry.Installed) : []
  const filtered = filterBrowseEntries(available, query, kinds)
  const externalSources = sources.filter((source) => !source.included)
  const partial = sources.some((source) => Boolean(source.errorCode) || (Boolean(source.status) && source.status !== 'current'))
  const pageCount = pageCountFor(filtered.length)
  const page = clampPage(state.page, pageCount)
  const rows = pageItems(filtered, page)
  const firstOnPage = (page - 1) * LIST_PAGE_SIZE + 1
  const count = !installedStateReady || available.length === 0 ? undefined : listCountLabel({
    total: available.length,
    shown: filtered.length,
    ...(pageCount > 1 ? { from: firstOnPage, to: firstOnPage + rows.length - 1 } : {}),
  })
  const blank = (() => {
    if (filtered.length > 0) return null
    if (!installedStateReady && entries.length === 0) return null
    if (installedMatches.length > 0) return {
      heading: t('extensions.browse.alreadyInstalledHeading'),
      description: t('extensions.browse.alreadyInstalledDescription'),
      action: t('extensions.browse.viewInstalled'),
      command: 'extensions.viewInstalled',
    }
    if (entries.length === 0 && externalSources.length === 0) return {
      heading: t('extensions.browse.noneAvailableHeading'),
      description: t('extensions.browse.addSourceDescription'),
      action: t('extensions.sources.title'),
      command: 'extensions.sources',
    }
    if (query.trim() === '' && kinds.length > 0) return {
      heading: t('extensions.browse.noCategoriesHeading'),
      description: t('extensions.browse.noCategoriesDescription'),
      action: t('extensions.browse.clearFilters'),
      command: 'extension.browse.clearFilters',
    }
    if (available.length === 0 || entries.length === 0) return {
      heading: t('extensions.browse.noneAvailableHeading'),
      description: t('extensions.browse.emptySourcesDescription'),
      action: t('extensions.sources.title'),
      command: 'extensions.sources',
    }
    return {
      heading: t('extensions.browse.noMatchesHeading', { query: query.trim() }),
      description: t('extensions.browse.noMatchesDescription'),
      action: t('extensions.browse.clearFilters'),
      command: 'extension.browse.clearFilters',
    }
  })()

  return (
    <>
      <Stack direction="vertical" gap="condensed" data-testid="extensions-browse">
        <Stack direction="horizontal" justify="space-between" align="center" gap="condensed">
        <Text as="p" size="small" className={listStyles.muted}>
          {t(installedStateReady ? 'extensions.browse.subtitle' : 'extensions.browse.catalogSubtitle')}
        </Text>
        <Button size="small" onClick={openSources} data-testid="extensions-sources-open">
          {t('extensions.sources.title')}
        </Button>
      </Stack>

      {loading && (
        <Stack direction="horizontal" gap="condensed" align="center" data-testid="extensions-browse-reloading">
          <Spinner size="small" />
          <Text size="small">{t('extensions.browse.loading')}</Text>
        </Stack>
      )}

      {error && (
        <Banner
          variant="critical"
          title={t('extensions.browse.readErrorHeading')}
          description={<Stack direction="vertical" gap="condensed">
            <Text size="small">{t('extensions.browse.readErrorDescription')}</Text>
            <Text size="small">{messageFor(error, appTranslate)}</Text>
          </Stack>}
          primaryAction={<Banner.PrimaryAction onClick={() => { void runCommand('extension.browse.retry') }}>{t('extensions.browse.retry')}</Banner.PrimaryAction>}
          data-testid="extensions-browse-read-error"
        />
      )}

      {partial && (
        <Banner
          variant="warning"
          title={t('extensions.browse.partialTitle')}
          description={t('extensions.browse.partialDescription')}
          primaryAction={<Banner.PrimaryAction onClick={openSources}>{t('extensions.sources.title')}</Banner.PrimaryAction>}
          data-testid="extensions-browse-partial"
        />
      )}
      {!result.InstalledStateReady && (
        <Banner
          variant="warning"
          title={t('extensions.browse.installedUnknownTitle')}
          description={result.InstalledStateError}
          data-testid="extensions-browse-installed-unknown"
        />
      )}

      <ListToolbar
        query={query}
        onQueryChange={(next) => { setQuery(next); resetPage() }}
        searchAriaLabel={t(installedStateReady ? 'extensions.browse.searchAria' : 'extensions.browse.catalogSearchAria')}
        searchTestId="extensions-browse-search"
        inputRef={searchRef}
        count={count}
      />
      <ExtensionsKindChips selected={kinds} onChange={(next) => { setKinds(next); resetPage() }} />

      {blank && (
        <Blankslate data-testid="extensions-browse-empty-state">
          <Blankslate.Heading>{blank.heading}</Blankslate.Heading>
          <Blankslate.Description>{blank.description}</Blankslate.Description>
          <Blankslate.PrimaryAction onClick={() => {
            if (blank.command === 'extension.browse.clearFilters') void clearFilters()
            else void runCommand(blank.command)
          }}>
            {blank.action}
          </Blankslate.PrimaryAction>
        </Blankslate>
      )}
      {rows.length > 0 && (
        <ul className={styles.rows} aria-label={t('extensions.tabs.browse')}>
          {rows.map((entry) => {
            const badgeKey = tierLabelKey(entry.Tier)
            const context: CommandContext = { kind: 'marketplaceEntry', marketplace: entry.Marketplace, pluginId: entry.ID }
            const previewCommand = findCommand('extension.browse.previewInstall')
            const installEnabled = previewCommand !== undefined && (previewCommand.enabled?.(context) ?? true)
            return (
              <li key={`${entry.Marketplace}/${entry.ID}`} data-testid="extensions-browse-row" data-plugin-id={entry.ID}>
                <div className={styles.row}>
                  <span className={styles.rowButton}>
                    <PackageIcon size={16} className={styles.rowIcon} />
                    <Text size="small" weight="semibold" className={styles.rowName}>{entry.Name || entry.ID}</Text>
                    <Text size="small" className={styles.rowDescription}>{entry.Description}</Text>
                    {entry.PolicyReason && <Text size="small" className={listStyles.error}>{entry.PolicyReason}</Text>}
                  </span>
                  <span className={styles.rowMeta}>
                    <Text size="small" className={listStyles.muted}>{entry.Marketplace}</Text>
                    {!entry.PolicyReason && entry.Version && <Text size="small" className={listStyles.muted}>{t('extensions.versionLabel', { version: entry.Version })}</Text>}
                    {badgeKey && <Label variant={tierVariant(entry.Tier)}>{t(badgeKey)}</Label>}
                    <Button
                      size="small"
                      variant="primary"
                      disabled={!installEnabled}
                      onClick={() => { void runCommand('extension.browse.previewInstall', context) }}
                      data-testid="extensions-browse-install"
                      aria-label={t('extensions.browse.installAria', { name: entry.Name || entry.ID })}
                    >
                      {t('extensions.browse.install')}
                    </Button>
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {pageCount > 1 && (
        <Pagination
          pageCount={pageCount}
          currentPage={page}
          showPages
          onPageChange={(event, nextPage) => { event.preventDefault(); setPage(nextPage) }}
        />
      )}

      </Stack>
      {sourcesOpen && <ExtensionsSourcesDialog onClose={() => setSourcesOpen(false)} />}
      {preview && target && (
        <ExtensionsInstallDialog
          preview={preview}
          busy={phase !== 'idle'}
          refusal={refusal}
          onCancel={() => { void runCommand('extension.browse.cancelInstall') }}
          onInstall={() => { void runCommand('extension.browse.confirmInstall', { kind: 'marketplaceEntry', marketplace: target.marketplace, pluginId: target.pluginId }) }}
          actionState={{
            acknowledged,
            onAcknowledgedChange: setAcknowledged,
            confirmEnabled: marketplaceCommandEnabled('extension.browse.confirmInstall', target.marketplace, target.pluginId),
            cancelEnabled: marketplaceCommandEnabled('extension.browse.cancelInstall', target.marketplace, target.pluginId),
          }}
        />
      )}
    </>
  )
}

function marketplaceCommandEnabled(id: string, marketplace: string, pluginId: string): boolean {
  const command = findCommand(id)
  const context: CommandContext = { kind: 'marketplaceEntry', marketplace, pluginId }
  return command !== undefined && (command.enabled?.(context) ?? true)
}
