import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, Pagination, Stack, Text } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { ContextMenu, type ContextMenuState } from './ContextMenu'
import { ExamplesSection } from './ExamplesSection'
import { InventoryRow } from './InventoryRow'
import { ListToolbar } from './ListToolbar'
import { useListState } from './useListState'
import {
  LIST_PAGE_SIZE, availableSorts, clampPage, listCountLabel, pageCountFor, pageItems, sortItems, splitExamples,
} from './listStandard'
import type { InventoryEmptyState, InventoryItem } from './inventoryItem'
import styles from './InventoryList.module.css'

export type {
  InventoryEmptyState, InventoryItem, InventoryItemIcon, InventoryMenuAction,
} from './inventoryItem'

// The shared inventory surface (docs/goals/0007-resource-inventory-
// redesign.md) wearing the one list standard (docs/goals/0337): one
// toolbar (search, sort, the page's own filters, the count), the user's
// own items paginated at a fixed page size, and the seeded examples in
// their own collapsible group at the bottom. Every list page gets all
// of it by passing a listId -- a page cannot opt into a different page
// size, sort model or grouping.
//
// The Examples group renders through the shared ExamplesSection.tsx
// disclosure (its own header comment carries the ActionList.Group
// rejection reasoning) over its OWN ActionList -- role="list" on the
// owning ActionList is what makes InventoryRow's Items render as divs
// rather than nested buttons, same as the own-items list below.
export function InventoryList({ items, emptyState, searchPlaceholder, listId, filters }: {
  items: InventoryItem[]
  emptyState: InventoryEmptyState
  searchPlaceholder?: string
  // Identifies this list's persisted sort/page/examples state. Required
  // -- an unnamed list would silently share another one's state.
  listId: string
  filters?: ReactNode
}) {
  const { t } = useTranslation('common')
  const [query, setQuery] = useState('')
  // One right-click menu for the whole list (goal 0075's audit G1):
  // opening another row's closes whichever was open, since this is a
  // single piece of state shared by every row rather than one per row.
  const [rowMenu, setRowMenu] = useState<ContextMenuState | null>(null)
  const { state, setSort, setPage, resetPage, setExamplesExpanded } = useListState(listId)

  const sortOptions = useMemo(() => availableSorts(items), [items])
  const sort = sortOptions.includes(state.sort) ? state.sort : 'updated'
  const { own, examples } = useMemo(() => splitExamples(sortItems(items, sort)), [items, sort])

  const q = query.trim().toLowerCase()
  const matches = (item: InventoryItem) =>
    q === '' || item.label.toLowerCase().includes(q) || (item.description ?? '').toLowerCase().includes(q)
  const ownFiltered = own.filter(matches)
  const examplesFiltered = examples.filter(matches)

  const pageCount = pageCountFor(ownFiltered.length)
  const page = clampPage(state.page, pageCount)
  const ownPage = pageItems(ownFiltered, page)
  const firstOnPage = (page - 1) * LIST_PAGE_SIZE + 1
  // The count is the user's OWN items: the Examples section carries its
  // own number, so a total that summed both would name a set no row list
  // shows (goal 0337). A list that is all examples shows no count.
  const count = own.length === 0 ? undefined : listCountLabel({
    total: own.length,
    shown: ownFiltered.length,
    ...(pageCount > 1 ? { from: firstOnPage, to: firstOnPage + ownPage.length - 1 } : {}),
  })

  // Collapsed once the user owns anything here, expanded while the list
  // is all examples -- and always expanded while a live query matches
  // one, so a search can never appear to have found nothing.
  const expanded = state.examplesExpanded ?? own.length === 0
  const showExamples = expanded || (q !== '' && examplesFiltered.length > 0)

  const changeQuery = (next: string) => {
    setQuery(next)
    resetPage()
  }

  // A truly empty inventory (nothing to search) gets the full
  // Blankslate treatment, not a search box over zero rows.
  if (items.length === 0) {
    return <InventoryEmptyBlankslate state={emptyState} />
  }

  return (
    <Stack direction="vertical" gap="condensed">
      <ListToolbar
        query={query}
        onQueryChange={changeQuery}
        searchPlaceholder={searchPlaceholder}
        sort={sort}
        sortOptions={sortOptions}
        onSortChange={setSort}
        filters={filters}
        count={count}
      />
      {ownFiltered.length === 0 && examplesFiltered.length === 0 ? (
        <Text as="p" size="small" className={styles.muted}>{t('inventoryList.noMatchesFor', { query })}</Text>
      ) : (
        <>
          {ownPage.length > 0 && (
            <ActionList role="list" showDividers className={styles.list} data-testid="inventory-items">
              {ownPage.map((item) => (
                <InventoryRow key={item.id} item={item} onOpenMenu={setRowMenu} />
              ))}
            </ActionList>
          )}
          {pageCount > 1 && (
            <Pagination
              pageCount={pageCount}
              currentPage={page}
              showPages
              onPageChange={(e, n) => {
                // Primer's page controls are anchors with a default '#'
                // href -- without this the click also navigates.
                e.preventDefault()
                setPage(n)
              }}
            />
          )}
          <ExamplesSection
            count={examplesFiltered.length}
            expanded={showExamples}
            onToggle={setExamplesExpanded}
            heading={t('list.examples', { count: examplesFiltered.length })}
            showLabel={t('list.showExamples')}
            hideLabel={t('list.hideExamples')}
            testId="inventory-examples"
            toggleTestId="inventory-examples-toggle"
          >
            <ActionList role="list" showDividers className={styles.list}>
              {examplesFiltered.map((item) => (
                <InventoryRow key={item.id} item={item} onOpenMenu={setRowMenu} />
              ))}
            </ActionList>
          </ExamplesSection>
        </>
      )}
      <ContextMenu state={rowMenu} onClose={() => setRowMenu(null)} />
    </Stack>
  )
}

function InventoryEmptyBlankslate({ state }: { state: InventoryEmptyState }) {
  return (
    <Blankslate>
      <Blankslate.Visual>
        <state.icon size={32} />
      </Blankslate.Visual>
      <Blankslate.Heading>{state.heading}</Blankslate.Heading>
      <Blankslate.Description>{state.description}</Blankslate.Description>
      {state.action}
    </Blankslate>
  )
}
