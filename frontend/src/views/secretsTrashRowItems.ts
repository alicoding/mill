import type { TFunction } from 'i18next'
import type { TrashSummary } from '../shared/bindings'
import type { InventoryItem } from '../shared/InventoryList'
import { entityRowContext } from '../shared/entityRowCommands'
import { ENTITY_ICON } from '../shared/entityIcons'
import { formatTrashCaption } from '../shared/secretsTrashCaption'

// The Trash section's own rows (goal 0406 S2 Contract item 1): label,
// kind's own icon, and the "Deleted <relative> · gone in <n> days"
// caption -- Restore and Delete forever are the ONLY actions (no
// reveal/copy/reference/edit/history: a trashed entry's value is
// unreadable and its history stays with it, but neither is usable from
// here). Split out of secretRowItems.tsx (vault/source rows) since
// this list is a SEPARATE InventoryList mount, never intermixed with
// them (Precedent: 1Password/Bitwarden both keep Trash a separate
// list, not rows folded into the active one).
export function buildSecretsTrashRowItems(list: TrashSummary[], t: TFunction<'secrets'>): InventoryItem[] {
  return list.map((entry) => ({
    id: entry.id,
    entity: 'secret',
    icon: ENTITY_ICON.secret,
    label: entry.label,
    description: formatTrashCaption(t, entry.deletedAt, entry.expiresAt),
    updatedAt: entry.deletedAt,
    onOpen: () => {},
    menuActions: [
      { commandId: 'secret.restore', ctx: entityRowContext('secret', entry.id) },
      {
        commandId: 'secret.destroy',
        ctx: entityRowContext('secret', entry.id),
        danger: true,
        confirm: { title: t('trash.destroyConfirmTitle'), body: t('trash.destroyConfirmBody'), confirmLabel: t('trash.destroyConfirmButton') },
      },
    ],
  }))
}
