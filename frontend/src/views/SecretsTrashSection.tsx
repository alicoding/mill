import { useTranslation } from 'react-i18next'
import { TrashIcon } from '@primer/octicons-react'
import type { TrashSummary } from '../shared/bindings'
import { InventoryList } from '../shared/InventoryList'
import { buildSecretsTrashRowItems } from './secretsTrashRowItems'

// The Trash section (goal 0406 S2): its own InventoryList mount, never
// rows folded into the vault's own list -- Restore/Delete forever are
// the row's only actions, and mode: 'trash' gives the selection bar the
// SAME pair in bulk (shared/InventoryList.tsx, shared/
// listSelectionCommands.ts).
export function SecretsTrashSection({ list }: { list: TrashSummary[] | null }) {
  const { t } = useTranslation('secrets')
  const items = buildSecretsTrashRowItems(list ?? [], t)

  return (
    <InventoryList
      listId="secrets-trash"
      items={items}
      searchPlaceholder={t('searchPlaceholder')}
      selection={{ entity: 'secret', mode: 'trash' }}
      emptyState={{
        icon: TrashIcon,
        heading: t('trash.emptyHeading'),
        description: t('trash.emptyDescription'),
      }}
    />
  )
}
