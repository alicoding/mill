import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Banner, Button, Label, Pagination, Spinner, Stack, Text } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { PackageIcon } from '@primer/octicons-react'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import type { BrowseEntry, InstallPreview } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { ListToolbar } from '../shared/ListToolbar'
import { LIST_PAGE_SIZE, clampPage, listCountLabel, pageCountFor, pageItems } from '../shared/listStandard'
import { useListState } from '../shared/useListState'
import { pushNotice } from '../shared/noticeStore'
import { appTranslate, messageFor, userErrorFrom } from '../shared/userError'
import { notifyPluginRemoved } from '../shared/pluginRemoveSignal'
import { runCommand } from '../shared/commands'
import { useExtensionSourcesStore } from '../shared/extensionSourcesStore'
import { useUISignalStore } from '../shared/uiSignalStore'
import { usePluginPolicy } from '../shared/pluginPolicyStore'
import { filterBrowseEntries } from './extensionsBrowseFilter'
import { ExtensionsInstallDialog } from './ExtensionsInstallDialog'
import { ExtensionsSourcesDialog } from './ExtensionsSourcesDialog'
import { ExtensionsKindChips } from './ExtensionsKindChips'
import { tierLabelKey, tierVariant } from './extensionTrust'
import listStyles from '../shared/ListCard.module.css'
import styles from './ExtensionsSection.module.css'

export function ExtensionsBrowseTab({ sourcesRequest, onInstalled }: {
  sourcesRequest: number
  onInstalled: () => void
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
  const policy = usePluginPolicy()
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const consumeSourcesRequest = useUISignalStore((state) => state.consumeExtensionSourcesRequest)
  const [preview, setPreview] = useState<InstallPreview | null>(null)
  const [pending, setPending] = useState<BrowseEntry | null>(null)
  const [refusal, setRefusal] = useState('')
  const [busy, setBusy] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const { state, setPage, resetPage } = useListState('extensions-browse')

  useEffect(() => { void load() }, [completionRevision, load])

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

  const startInstall = (entry: BrowseEntry) => {
    setBusy(true)
    PluginService.PreviewInstall(entry.Marketplace, entry.ID)
      .then((nextPreview) => {
        setPending(entry)
        setRefusal('')
        setPreview(nextPreview)
      })
      .catch((reason) => pushNotice({ level: 'error', text: messageFor(reason, appTranslate) }))
      .finally(() => setBusy(false))
  }

  const confirmInstall = () => {
    if (!pending) return
    setBusy(true)
    PluginService.InstallFromMarketplace(pending.Marketplace, pending.ID)
      .then(() => {
        pushNotice({ level: 'success', text: t('extensions.install.done', { name: pending.Name || pending.ID }) })
        setPending(null)
        setPreview(null)
        void load()
        notifyPluginRemoved()
        onInstalled()
      })
      .catch((reason) => {
        const { code } = userErrorFrom(reason)
        if (code === 'plugin-policy-refused' || code === 'plugin-install-refused') setRefusal(messageFor(reason, appTranslate))
        else pushNotice({ level: 'error', text: messageFor(reason, appTranslate) })
      })
      .finally(() => setBusy(false))
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
  const available = entries.filter((entry) => !entry.Installed)
  const allMatching = filterBrowseEntries(entries, query, kinds)
  const installedMatches = result.InstalledStateReady ? allMatching.filter((entry) => entry.Installed) : []
  const filtered = filterBrowseEntries(available, query, kinds)
  const externalSources = sources.filter((source) => !source.included)
  const partial = sources.some((source) => source.errorCode !== '' || (source.status !== '' && source.status !== 'current'))
  const pageCount = pageCountFor(filtered.length)
  const page = clampPage(state.page, pageCount)
  const rows = pageItems(filtered, page)
  const firstOnPage = (page - 1) * LIST_PAGE_SIZE + 1
  const count = available.length === 0 ? undefined : listCountLabel({
    total: available.length,
    shown: filtered.length,
    ...(pageCount > 1 ? { from: firstOnPage, to: firstOnPage + rows.length - 1 } : {}),
  })
  const blank = (() => {
    if (filtered.length > 0) return null
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
        <Text as="p" size="small" className={listStyles.muted}>{t('extensions.browse.subtitle')}</Text>
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
        searchAriaLabel={t('extensions.browse.searchAria')}
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
            const installDisabled = busy || !result.InstalledStateReady || policy === null || policy.Error !== '' || entry.PolicyReason !== ''
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
                    {entry.Version && <Text size="small" className={listStyles.muted}>{t('extensions.versionLabel', { version: entry.Version })}</Text>}
                    {badgeKey && <Label variant={tierVariant(entry.Tier)}>{t(badgeKey)}</Label>}
                    <Button
                      size="small"
                      variant="primary"
                      disabled={installDisabled}
                      onClick={() => startInstall(entry)}
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
      {preview && (
        <ExtensionsInstallDialog
          preview={preview}
          busy={busy}
          refusal={refusal}
          onCancel={() => { setPreview(null); setPending(null); setRefusal('') }}
          onInstall={confirmInstall}
        />
      )}
    </>
  )
}
