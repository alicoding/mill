import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Label, Pagination, Stack, Text } from '@primer/react'
import { PackageIcon } from '@primer/octicons-react'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import type { BrowseEntry, InstallPreview } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { ListToolbar } from '../shared/ListToolbar'
import { LIST_PAGE_SIZE, clampPage, listCountLabel, pageCountFor, pageItems } from '../shared/listStandard'
import { useListState } from '../shared/useListState'
import { pushNotice } from '../shared/noticeStore'
import { appTranslate, messageFor } from '../shared/userError'
import { notifyPluginRemoved } from '../shared/pluginRemoveSignal'
import { ExtensionsInstallDialog } from './ExtensionsInstallDialog'
import { ExtensionsSourcesDialog } from './ExtensionsSourcesDialog'
import { ExtensionsKindChips } from './ExtensionsKindChips'
import { tierLabelKey, tierVariant } from './extensionTrust'
import listStyles from '../shared/ListCard.module.css'
import styles from './ExtensionsSection.module.css'

// Browse (docs/goals/0349): every marketplace's offerings that are not
// already installed, on the one list standard. Reads only what is
// cached on disk -- opening this tab never fetches; Sources > Refresh
// is the only thing that does.
export function ExtensionsBrowseTab({ sourcesRequest, onInstalled }: {
  sourcesRequest: number
  onInstalled: () => void
}) {
  const { t } = useTranslation('views')
  const { t: tc } = useTranslation('common')
  const [entries, setEntries] = useState<BrowseEntry[] | null>(null)
  const [query, setQuery] = useState('')
  const [kinds, setKinds] = useState<string[]>([])
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [preview, setPreview] = useState<InstallPreview | null>(null)
  const [pending, setPending] = useState<BrowseEntry | null>(null)
  const [busy, setBusy] = useState(false)
  const { state, setPage, resetPage } = useListState('extensions-browse')

  const load = useCallback(() => {
    PluginService.BrowseMarketplaces().then((e) => setEntries(e ?? [])).catch(() => setEntries([]))
  }, [])
  useEffect(load, [load])

  // The palette's "Extensions: marketplace sources" command lands here.
  const [seenRequest, setSeenRequest] = useState(sourcesRequest)
  useEffect(() => {
    if (sourcesRequest !== seenRequest) {
      setSeenRequest(sourcesRequest)
      setSourcesOpen(true)
    }
  }, [sourcesRequest, seenRequest])

  const startInstall = (entry: BrowseEntry) => {
    setBusy(true)
    PluginService.PreviewInstall(entry.Marketplace, entry.ID)
      .then((pv) => {
        setPending(entry)
        setPreview(pv)
      })
      .catch((err) => pushNotice({ level: 'error', text: messageFor(err, appTranslate) }))
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
        load()
        notifyPluginRemoved()
        onInstalled()
      })
      .catch((err) => pushNotice({ level: 'error', text: messageFor(err, appTranslate) }))
      .finally(() => setBusy(false))
  }

  const q = query.trim().toLowerCase()
  const available = (entries ?? []).filter((e) => !e.Installed)
  const filtered = available.filter((e) => {
    const matchesQuery = q === '' || (e.Name || e.ID).toLowerCase().includes(q) || (e.Description ?? '').toLowerCase().includes(q)
    const matchesKind = kinds.length === 0 || kinds.some((kind) => (e.Kinds ?? []).includes(kind))
    return matchesQuery && matchesKind
  })
  const pageCount = pageCountFor(filtered.length)
  const page = clampPage(state.page, pageCount)
  const rows = pageItems(filtered, page)
  const firstOnPage = (page - 1) * LIST_PAGE_SIZE + 1
  const count = available.length === 0 ? undefined : listCountLabel({
    total: available.length,
    shown: filtered.length,
    ...(pageCount > 1 ? { from: firstOnPage, to: firstOnPage + rows.length - 1 } : {}),
  })

  return (
    <Stack direction="vertical" gap="condensed" data-testid="extensions-browse">
      <Stack direction="horizontal" justify="space-between" align="center" gap="condensed">
        <Text as="p" size="small" className={listStyles.muted}>{t('extensions.browse.subtitle')}</Text>
        <Button size="small" onClick={() => setSourcesOpen(true)} data-testid="extensions-sources-open">
          {t('extensions.sources.title')}
        </Button>
      </Stack>

      <ListToolbar
        query={query}
        onQueryChange={(next) => { setQuery(next); resetPage() }}
        searchAriaLabel={t('extensions.browse.searchAria')}
        searchTestId="extensions-browse-search"
        count={count}
      />
      <ExtensionsKindChips selected={kinds} onChange={(next) => { setKinds(next); resetPage() }} />

      {entries !== null && available.length === 0 && (
        <Text as="p" size="small" className={listStyles.muted} data-testid="extensions-browse-empty">
          {t('extensions.browse.empty')}
        </Text>
      )}
      {filtered.length === 0 && available.length > 0 && (
        <Text as="p" size="small" className={listStyles.muted}>{tc('inventoryList.noMatchesFor', { query })}</Text>
      )}
      {rows.length > 0 && (
        <ul className={styles.rows} aria-label={t('extensions.tabs.browse')}>
          {rows.map((entry) => {
            const badgeKey = tierLabelKey(entry.Tier)
            return (
              <li key={`${entry.Marketplace}/${entry.ID}`} data-testid="extensions-browse-row" data-plugin-id={entry.ID}>
                <div className={styles.row}>
                  <span className={styles.rowButton}>
                    <PackageIcon size={16} className={styles.rowIcon} />
                    <Text size="small" weight="semibold" className={styles.rowName}>{entry.Name || entry.ID}</Text>
                    <Text size="small" className={styles.rowDescription}>{entry.Description}</Text>
                  </span>
                  <span className={styles.rowMeta}>
                    <Text size="small" className={listStyles.muted}>{entry.Marketplace}</Text>
                    {entry.Version && <Text size="small" className={listStyles.muted}>{t('extensions.versionLabel', { version: entry.Version })}</Text>}
                    {badgeKey && <Label variant={tierVariant(entry.Tier)}>{t(badgeKey)}</Label>}
                    <Button
                      size="small"
                      variant="primary"
                      disabled={busy}
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
          onPageChange={(e, n) => { e.preventDefault(); setPage(n) }}
        />
      )}

      {sourcesOpen && <ExtensionsSourcesDialog onClose={() => setSourcesOpen(false)} onChanged={load} />}
      {preview && (
        <ExtensionsInstallDialog
          preview={preview}
          busy={busy}
          onCancel={() => { setPreview(null); setPending(null) }}
          onInstall={confirmInstall}
        />
      )}
    </Stack>
  )
}
