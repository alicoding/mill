import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, Text } from '@primer/react'
import { FilteredActionList } from '@primer/react/experimental'
import { DocsService, type DocSearchEntry } from '../shared/bindings'
import { useAppStore } from '../shared/store'
import { useUISignalStore } from '../shared/uiSignalStore'
import { dirOf, sectionTitleKey } from '../views/docsGroups'
import { searchDocs } from '../views/docsSearch'
import styles from './DocsSearchDialog.module.css'
import { searchInputTextAssistOff } from '../shared/searchInputProps'
import { background } from '../shared/background'

// DocsSearchDialog (goal 0235 S2): the `docs.search` command's palette-
// style picker, same FilteredActionList + Dialog shape as
// ClipboardHistoryDialog -- a search-filtered single-select combobox is
// exactly what FilteredActionList fits (frontend.md's component-
// selection reference). The index is fetched once per session on first
// open and cached in this component's own state (not re-fetched on
// every open) -- offline, no new network surface, matching the
// contract's "computed once per session."
export function DocsSearchDialog() {
  const { t } = useTranslation(['app', 'views'])
  const open = useUISignalStore((s) => s.docsSearchOpen)
  const close = useUISignalStore((s) => s.closeDocsSearch)

  const [entries, setEntries] = useState<DocSearchEntry[] | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (open && entries === null) {
      void background(DocsService.DocsSearchIndex()
        .then((result) => setEntries(result ?? [])), 'docsSearch.docsSearchIndex')
    }
    if (!open) setQuery('')
  }, [open, entries])

  if (!open) return null

  // An empty query browses every page in its canonical order (no
  // snippet -- there's no match to center one on) rather than showing
  // nothing until the reader types, the same "show everything, then
  // narrow" shape ClipboardHistoryDialog's own unfiltered list uses.
  const results = query.trim()
    ? (entries ? searchDocs(entries, query) : [])
    : (entries ?? []).map((e) => ({ rel: e.rel, title: e.title, snippet: '' }))
  const sectionLabel = (rel: string) => {
    const dir = dirOf(rel)
    const key = sectionTitleKey(dir)
    return key ? t(key, { ns: 'views' }) : dir
  }
  const items = results.map((r) => ({
    id: r.rel,
    text: r.title,
    description: r.snippet ? `${sectionLabel(r.rel)} — ${r.snippet}` : sectionLabel(r.rel),
    descriptionVariant: 'block' as const,
    onAction: () => {
      close()
      useAppStore.getState().setView({ kind: 'docs', page: r.rel })
    },
  }))

  // FilteredActionList's own `messageText` prop only feeds a
  // screen-reader announcement (useAnnouncements, confirmed against
  // the installed .d.ts/compiled source) -- it renders no visible
  // empty state on its own, so the SIGHTED "no matches" message is
  // this component's own `message` node, shown only once the index has
  // actually loaded (never during the loading spinner) and a real
  // query still matched nothing.
  const showNoMatches = entries !== null && query.trim() !== '' && items.length === 0

  return (
    <Dialog title={t('docsSearch.title')} onClose={close} width="large" height="large" data-component="docs-search">
      <FilteredActionList
        items={items}
        loading={entries === null}
        filterValue={query}
        onFilterChange={setQuery}
        placeholderText={t('docsSearch.searchPlaceholder')}
        textInputProps={searchInputTextAssistOff}
        showItemDividers
        message={
          showNoMatches ? (
            <div className={styles.empty} data-testid="docs-search-empty">
              <Text as="p" className={styles.emptyTitle}>{t('search.noMatchesTitle')}</Text>
              <Text as="p" className={styles.emptyDescription}>{t('search.noMatchesDescription', { query })}</Text>
            </div>
          ) : undefined
        }
        messageText={{ title: t('search.noMatchesTitle'), description: t('search.noMatchesDescription', { query }) }}
      />
    </Dialog>
  )
}
