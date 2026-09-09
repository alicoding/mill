import type { TFunction } from 'i18next'
import { Label } from '@primer/react'
import type { SecretSummary } from '../shared/bindings'
import type { Source as SecretSource } from '../../bindings/github.com/alicoding/mill/internal/domain/secretsource/models'
import type { InventoryItem } from '../shared/InventoryList'
import { entityRowContext } from '../shared/entityRowCommands'
import { ENTITY_ICON } from '../shared/entityIcons'
import { formatUpdated, sortByUpdatedDesc } from '../shared/inventorySort'
import { kindLabel } from '../configure/secretSourceFields'
import { providerSecretRows, vaultUnresolvedInfo, type ProviderSecretRow } from '../shared/secretListItems'

// The Secrets list's merged rows (goal 0408 S2 Decision 2): a vault
// entry and a source's own key are the same InventoryItem shape, split
// out of SecretsView.tsx (CLAUDE.md's 500-line convention) since
// building both is the single largest block in that view.

export interface SecretRowItemsResult {
  sorted: SecretSummary[]
  providerRows: ProviderSecretRow[]
  items: InventoryItem[]
}

export function buildSecretRowItems({
  list, providerList, secretSources, t, tConfigure, setSearch, setDetailID, setProviderDetailID,
}: {
  list: SecretSummary[] | null
  providerList: SecretSummary[] | null
  secretSources: SecretSource[] | null
  t: TFunction<'secrets'>
  tConfigure: TFunction<'configure'>
  setSearch: (next: string) => void
  setDetailID: (id: string) => void
  setProviderDetailID: (id: string) => void
}): SecretRowItemsResult {
  const sorted = sortByUpdatedDesc(list ?? [], (s) => s.UpdatedAt)
  const providerRows = providerSecretRows(providerList ?? [], secretSources ?? [])
  const providerIDs = new Set(providerRows.map((r) => r.id))

  const vaultItems: InventoryItem[] = sorted.map((s) => {
    // A vault entry whose SourceRef named a key that has since vanished
    // from its source (the S1 watcher's own live view) -- the entry
    // itself is untouched, so this is a display-only caption, never a
    // reason to hide the row or its own actions.
    const unresolved = s.SourceRef ? vaultUnresolvedInfo(s.SourceRef, providerIDs, secretSources ?? []) : null
    return {
      id: s.ID,
      entity: 'secret',
      icon: ENTITY_ICON.secret,
      label: s.Title,
      // A tag is clickable: it narrows the list to everything carrying
      // it, which is the whole reason to put one on an entry.
      labelBadges: (
        <>
          {unresolved && <Label variant="attention" data-testid={`secret-unresolved-${s.ID}`}>{t('unresolvedBadge')}</Label>}
          {(s.Tags ?? []).map((tag) => (
            <Label
              key={tag}
              as="button"
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); setSearch(`tag:${tag}`) }}
              data-testid={`secret-tag-${tag}`}
            >
              {tag}
            </Label>
          ))}
        </>
      ),
      // The list's search finds an entry by a tag or by the NAME of a
      // field it carries -- never by a value, which is not here at all.
      searchTerms: [...(s.Tags ?? []), ...(s.Tags ?? []).map((tag) => `tag:${tag}`), ...(s.FieldNames ?? [])],
      description: unresolved ? t('unresolvedCaption', { key: unresolved.key, source: unresolved.sourceLabel }) : (s.Username || s.URL || undefined),
      updatedLabel: formatUpdated(s.UpdatedAt),
      updatedAt: s.UpdatedAt,
      onOpen: () => setDetailID(s.ID),
      menuActions: [
        { commandId: 'secret.row.edit', ctx: entityRowContext('secret', s.ID) },
        { commandId: 'secret.row.history', ctx: entityRowContext('secret', s.ID) },
        { commandId: 'secret.copyReference', ctx: entityRowContext('secret', s.ID) },
        {
          commandId: 'secret.row.delete',
          ctx: entityRowContext('secret', s.ID),
          danger: true,
          confirm: { title: t('deleteConfirmTitle'), body: t('deleteConfirmBody'), confirmLabel: t('trash.moveToTrashButton') },
        },
      ],
    }
  })

  // A source key is a secret ENTRY (goal 0408 S2 Decision 2): same row
  // shape, grouped under the source it comes from -- vault entries
  // above have no `group`, so they render first with no header
  // (InventoryList's own groupOrder/listRuns).
  const providerItems: InventoryItem[] = providerRows.map((row) => ({
    id: row.id,
    entity: 'secret',
    icon: ENTITY_ICON.secret,
    label: row.key,
    labelBadges: <Label data-testid={`secret-source-kind-${row.id}`}>{kindLabel(row.sourceKind, [], tConfigure)}</Label>,
    searchTerms: [row.sourceLabel],
    updatedLabel: formatUpdated(row.updatedAt),
    updatedAt: row.updatedAt,
    group: { key: row.sourceID, label: row.sourceLabel, icon: ENTITY_ICON.secretsource },
    onOpen: () => setProviderDetailID(row.id),
    menuActions: [
      { commandId: 'secret.copyReference', ctx: entityRowContext('secret', row.id) },
      { commandId: 'secret.row.openSource', ctx: entityRowContext('secret', row.id) },
    ],
  }))

  return { sorted, providerRows, items: [...vaultItems, ...providerItems] }
}
