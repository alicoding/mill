import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, Heading, Pagination, Stack, Text } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { ContextMenu, type ContextMenuState } from './ContextMenu'
import { ExamplesSection } from './ExamplesSection'
import { InventoryRow, type InventoryRowSelection } from './InventoryRow'
import { ListToolbar } from './ListToolbar'
import { SelectionBar } from './SelectionBar'
import { useListState } from './useListState'
import { useListSelection } from './useListSelection'
import { useIsNarrowViewport } from './useNarrowViewport'
import { bulkDeleteDoorFor } from './entityDeleteDoors'
import { bulkDeleteWithUndo } from './bulkDeleteWithUndo'
import { useListSelectionFocusStore, type ListSelectionHandle } from './listSelectionFocus'
import {
  LIST_PAGE_SIZE, availableSorts, clampPage, listCountLabel, pageCountFor, pageItems, sortItems, splitExamples,
} from './listStandard'
import { groupOrder, listRuns, type InventoryEmptyState, type InventoryItem } from './inventoryItem'
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
export function InventoryList({ items, emptyState, searchPlaceholder, listId, filters, searchQuery, onSearchQueryChange, selection: selectionConfig }: {
  items: InventoryItem[]
  emptyState: InventoryEmptyState
  searchPlaceholder?: string
  // A caller that drives the search itself (a chip in a row setting the
  // query) passes both; otherwise the list owns its own search box.
  searchQuery?: string
  onSearchQueryChange?: (next: string) => void
  // Identifies this list's persisted sort/page/examples state. Required
  // -- an unnamed list would silently share another one's state.
  listId: string
  filters?: ReactNode
  // Opt-in multi-select + bulk delete (goal 0404 S1): `entity` is the
  // same family slug every row's own menuActions already carry
  // (InventoryItem.entity), looked up in shared/entityDeleteDoors.ts
  // for the SAME delete door and refetch a row's own Delete action
  // uses -- the one line a consumer adds to inherit selection, never a
  // hand-rebuilt hook/bar/checkbox per page. Selection covers the
  // user's OWN items on the current page (never the Examples group,
  // a separate ActionList by design) and, for "Select all {N}", the
  // full filtered set.
  selection?: { entity: string }
}) {
  const { t } = useTranslation('common')
  const [ownQuery, setOwnQuery] = useState('')
  const query = searchQuery ?? ownQuery
  // One right-click menu for the whole list (goal 0075's audit G1):
  // opening another row's closes whichever was open, since this is a
  // single piece of state shared by every row rather than one per row.
  const [rowMenu, setRowMenu] = useState<ContextMenuState | null>(null)
  const { state, setSort, setPage, resetPage, setExamplesExpanded } = useListState(listId)

  const sortOptions = useMemo(() => availableSorts(items), [items])
  const sort = sortOptions.includes(state.sort) ? state.sort : 'updated'
  // groupOrder reorders `own` into its backing buckets (goal 0408 S2's
  // merged Secrets list: vault first, then one bucket per source) --
  // a no-op for every other list, none of whose items carry `group`,
  // so sortItems' own order passes straight through unchanged.
  const { own, examples } = useMemo(() => {
    const split = splitExamples(sortItems(items, sort))
    return { own: groupOrder(split.own), examples: split.examples }
  }, [items, sort])

  const q = query.trim().toLowerCase()
  const matches = (item: InventoryItem) =>
    q === '' || item.label.toLowerCase().includes(q) || (item.description ?? '').toLowerCase().includes(q) ||
    (item.searchTerms ?? []).some((term) => term.toLowerCase().includes(q))
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
    if (onSearchQueryChange) onSearchQueryChange(next)
    else setOwnQuery(next)
    resetPage()
  }

  // The selection model (goal 0404 S1) is always constructed -- React's
  // own hook-order rule -- but only WIRED (rendered checkbox, ⌘A/Esc/⌫
  // focus publish, the bar) while a caller opts in. Bound to the
  // CURRENT PAGE's own ids: a header checkbox/⌘A means "everything
  // visible," matching Gmail/Drive's own split from a broader
  // cross-page "Select all {N}" (selectAllOf below, over the full
  // filtered set).
  const pageIDs = ownPage.map((i) => i.id)
  const selection = useListSelection(pageIDs)
  const isNarrowViewport = useIsNarrowViewport()
  const door = selectionConfig ? bulkDeleteDoorFor(selectionConfig.entity) : undefined

  // A changed search/sort/filter (Configure Lists' own Unused toggle is
  // the proving case) must never leave a phantom row checked -- prunes
  // against the full FILTERED set, not just the current page, so a
  // selection made via "Select all {N}" survives a page change but not
  // a filter that actually drops the row.
  const filteredIDsKey = JSON.stringify(ownFiltered.map((i) => i.id))
  useEffect(() => {
    selection.pruneTo(JSON.parse(filteredIDsKey) as string[])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the id set's own content, not the selection object's identity
  }, [filteredIDsKey])

  const deleteSelected = async () => {
    if (!selectionConfig || !door) return
    const targets = ownFiltered
      .filter((item) => selection.selected.has(item.id))
      .map((item) => ({ id: item.id, label: item.label }))
    if (targets.length === 0) return
    const entity = selectionConfig.entity
    await bulkDeleteWithUndo({
      entity,
      items: targets,
      remove: door.remove,
      refetch: door.refetch,
      journal: door.undoable
        ? { kind: () => (entity === 'workflow' ? 'workflow' : 'configure-entity'), id: (id) => (entity === 'workflow' ? id : `${entity}/${id}`) }
        : null,
    })
    selection.clear()
  }

  // The row's own selection projection (goal 0404 S1), shared between
  // however many group runs render below -- a row with no group and a
  // row inside a source's own run both wire the identical checkbox/
  // long-press contract.
  const rowSelection = (item: InventoryItem): InventoryRowSelection | undefined => (selectionConfig ? {
    isSelected: selection.isSelected(item.id),
    isSelectionMode: selection.isSelectionMode,
    onActivate: (mods) => selection.activate(item.id, mods),
    onActivateCheckbox: (mods) => selection.activateCheckbox(item.id, mods),
    onRowFocus: () => selection.setFocusedId(item.id),
    ...(isNarrowViewport ? {
      longPress: {
        onPointerDown: (e) => selection.handlePointerDown(item.id, e),
        onPointerMove: selection.handlePointerMove,
        onPointerUp: selection.handlePointerUp,
        onPointerCancel: selection.handlePointerCancel,
      },
    } : {}),
  } : undefined)

  // Space/x/Shift+Space (goal 0404 S1) act on whichever row's own
  // real onFocus last called selection.setFocusedId
  // -- a no-op with nothing focused (Tab never reached a row yet, or
  // focus left the list entirely).
  const toggleFocusedRow = () => {
    if (selection.focusedId !== null) selection.toggle(selection.focusedId)
  }
  const extendFocusedRow = () => {
    if (selection.focusedId !== null) selection.range(selection.focusedId)
  }

  // Published to shared/listSelectionFocus.ts on real DOM focus (the
  // container's onFocus/onBlur below) -- the same focus-scoped "which
  // mounted surface currently owns the shortcut" shape
  // listGridSearchFocus.ts already uses, since Configure's panes stay
  // mounted (hidden) once visited and more than one InventoryList can
  // exist in the DOM at once. Re-published every render while this
  // instance is ALREADY the focused one, so ⌘A/⌫ always act on
  // whatever this render's own selection/items actually are, never a
  // stale closure captured back at the original focus event.
  const selectionHandle: ListSelectionHandle | null = selectionConfig
    ? {
      id: listId, selectAll: selection.selectAll, clear: selection.clear, hasSelection: () => selection.selected.size > 0,
      deleteSelected, toggleFocusedRow, extendFocusedRow,
    }
    : null
  useEffect(() => {
    if (!selectionHandle) return
    if (useListSelectionFocusStore.getState().focused?.id !== selectionHandle.id) return
    useListSelectionFocusStore.getState().setFocused(selectionHandle)
  })
  // A non-empty selection publishes itself as the focused list
  // unconditionally, even with no real DOM focus event behind it --
  // a touch long-press toggles a row through the hook's own timer,
  // never a native input interaction, so SelectionBar's own bulk
  // commands (which read this same handle) must still resolve.
  useEffect(() => {
    if (selectionHandle && selection.isSelectionMode) {
      useListSelectionFocusStore.getState().setFocused(selectionHandle)
    }
  })

  // A truly empty inventory (nothing to search) gets the full
  // Blankslate treatment, not a search box over zero rows.
  if (items.length === 0) {
    return <InventoryEmptyBlankslate state={emptyState} />
  }

  return (
    <Stack
      direction="vertical"
      gap="condensed"
      // Publishes/releases this instance as the list.selectAll/
      // clearSelection/deleteSelection commands' live target on real
      // DOM focus entering/leaving anywhere in this subtree (a row, its
      // checkbox, the search box) -- listGridSearchFocus.ts's own
      // pattern, needed because Configure's panes stay mounted-hidden
      // once visited (more than one InventoryList can exist at once).
      onFocus={() => { if (selectionHandle) useListSelectionFocusStore.getState().setFocused(selectionHandle) }}
      onBlur={(e) => {
        if (!selectionHandle) return
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        useListSelectionFocusStore.getState().clearFocused(selectionHandle.id)
      }}
    >
      {selection.isSelectionMode ? (
        <SelectionBar
          count={selection.selected.size}
          totalCount={ownFiltered.length}
          onSelectAllOf={() => selection.selectAllOf(ownFiltered.map((i) => i.id))}
          onCancel={selection.clear}
        />
      ) : (
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
      )}
      {ownFiltered.length === 0 && examplesFiltered.length === 0 ? (
        <Text as="p" size="small" className={styles.muted}>{t('inventoryList.noMatchesFor', { query })}</Text>
      ) : (
        <>
          {ownPage.length > 0 && (
            // One run per contiguous backing (goal 0408 S2) -- a list
            // with no grouped item collapses to exactly one run with no
            // header, so this renders identically to the single
            // ActionList every other InventoryList consumer already
            // gets (listRuns' own doc comment).
            <div data-testid="inventory-items">
              {listRuns(ownPage).map((run, i) => (
                <div key={run.group?.key ?? `ungrouped-${i}`}>
                  {run.group && (
                    <Heading as="h3" className={styles.groupHeading} data-testid={`inventory-group-${run.group.key}`}>
                      <Stack direction="horizontal" gap="condensed" align="center">
                        <span className={styles.groupIcon} style={{ background: run.group.icon.bg }}>
                          <run.group.icon.Icon size={12} fill={run.group.icon.fg} />
                        </span>
                        {run.group.label}
                      </Stack>
                    </Heading>
                  )}
                  <ActionList role="list" showDividers className={styles.list}>
                    {run.items.map((item) => (
                      <InventoryRow key={item.id} item={item} onOpenMenu={setRowMenu} selection={rowSelection(item)} />
                    ))}
                  </ActionList>
                </div>
              ))}
            </div>
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
