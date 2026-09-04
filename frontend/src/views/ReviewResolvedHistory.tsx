import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Heading } from '@primer/react'
import { HistoryIcon } from '@primer/octicons-react'
import type { MCPWriteResolved, RunSummary } from '../shared/bindings'
import { InventoryList } from '../shared/InventoryList'
import { buildResolvedEntries, resolvedEntryToInventoryItem } from './reviewResolvedAdapter'
import styles from '../shared/ListCard.module.css'

// Review's Recently-resolved section on the one list standard (goal
// 0337 S2): the merged run/MCP-write history through InventoryList,
// replacing the old hand-assembled `.slice(0, 10)` with the standard's
// pagination at 25. Renders nothing when there is no history at all --
// same as the section it replaces, never a Blankslate under a heading
// that already only shows up once something has resolved.
export function ReviewResolvedHistory({ resolved, resolvedWrites, workflowFilter, onOpenRun }: {
  resolved: RunSummary[]
  resolvedWrites: MCPWriteResolved[]
  workflowFilter: string
  onOpenRun: (run: RunSummary) => void
}) {
  const { t } = useTranslation('views')
  const entries = useMemo(
    () => buildResolvedEntries(resolved, resolvedWrites, workflowFilter),
    [resolved, resolvedWrites, workflowFilter],
  )
  const items = useMemo(
    () => entries.map((entry) => resolvedEntryToInventoryItem(entry, { onOpenRun, t })),
    [entries, onOpenRun, t],
  )
  if (items.length === 0) return null
  return (
    <>
      <Heading as="h2" variant="small" className={styles.sectionHeading}>{t('reviewView.recentlyResolved')}</Heading>
      <InventoryList
        items={items}
        listId="review-resolved"
        // Unreachable: this component returns before InventoryList ever
        // sees an empty item list (the `entries.length === 0` guard
        // above), but InventoryList's type still requires one.
        emptyState={{ icon: HistoryIcon, heading: t('reviewView.recentlyResolved'), description: t('reviewView.nothingWaitingDescription') }}
      />
    </>
  )
}
