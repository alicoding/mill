import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, ActionMenu, Stack, Text, TextInput } from '@primer/react'
import { SearchIcon } from '@primer/octicons-react'
import styles from './ListToolbar.module.css'
import { searchInputTextAssistOff } from './searchInputProps'
import type { ListCount, ListSort } from './listStandard'

// The one toolbar every list page wears (docs/goals/0337): search on
// the left, the sort menu next to it, the page's own filter controls
// after that, and the count anchored right. Shared by both list
// shapes -- InventoryList's rows and the DataTable pages (Activity, the
// Workflows table view) -- so a page can never grow a second,
// differently-arranged control row.
//
// The sort menu is hidden, not disabled, when a list offers fewer than
// two orderings: a control with one choice is noise, and the two
// DataTable surfaces whose rows carry no label/timestamp shape pass
// none at all.
export interface ListToolbarProps {
  query: string
  onQueryChange: (query: string) => void
  searchPlaceholder?: string
  searchTestId?: string
  searchAriaLabel?: string
  sort?: ListSort
  sortOptions?: ListSort[]
  onSortChange?: (sort: ListSort) => void
  // Page-owned filter controls (Activity's source and outcome pickers).
  filters?: ReactNode
  count?: ListCount
}

export function ListToolbar({
  query, onQueryChange, searchPlaceholder, searchTestId, searchAriaLabel,
  sort, sortOptions, onSortChange, filters, count,
}: ListToolbarProps) {
  const { t } = useTranslation('common')
  const showSort = sortOptions !== undefined && sortOptions.length > 1 && sort !== undefined && onSortChange !== undefined

  return (
    <Stack direction="horizontal" gap="condensed" align="center" className={styles.toolbar} data-testid="list-toolbar">
      <div className={styles.search}>
        <TextInput
          leadingVisual={SearchIcon}
          placeholder={searchPlaceholder ?? t('inventoryList.defaultSearchPlaceholder')}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          aria-label={searchAriaLabel ?? t('inventoryList.searchAriaLabel')}
          {...searchInputTextAssistOff}
          data-testid={searchTestId ?? 'inventory-search'}
          block
        />
      </div>
      {showSort && (
        <ActionMenu>
          <ActionMenu.Button size="small" data-testid="list-sort">
            {t('list.sort')}
          </ActionMenu.Button>
          <ActionMenu.Overlay>
            <ActionList selectionVariant="single">
              {sortOptions.map((option) => (
                <ActionList.Item
                  key={option}
                  selected={option === sort}
                  onSelect={() => onSortChange(option)}
                  data-testid={`list-sort-${option}`}
                >
                  {t(`list.sortOption.${option}`)}
                </ActionList.Item>
              ))}
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>
      )}
      {filters}
      {count && <Text size="small" className={styles.count} data-testid="list-count">
        {t(count.key, count.params)}
      </Text>}
    </Stack>
  )
}
