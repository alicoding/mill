import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, ActionMenu, Button, IconButton, Text, TextInput, Token } from '@primer/react'
import { SearchIcon, TagIcon } from '@primer/octicons-react'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { type BoardFilter, filterIsActive } from './cardFilter'
import styles from './AtlasFilterBar.module.css'

// The board filter group (goal 0129 slice 1): text + kinds, ANDed,
// applied as DIM-in-place by the board (cardFilter.ts is the one
// predicate). Lives on the breadcrumb row -- the actions row's own
// comment forbids further additions there. Transient by design: a
// query is a question about the board, never a configuration of it
// (the hide-kinds lens stays the persistent concept).
export function AtlasFilterBar({ kinds, presentKindIDs, filter, onChange, matchCount, totalCount }: {
  kinds: Kind[]
  // Only kinds actually present on this board are offerable facets.
  presentKindIDs: Set<string>
  filter: BoardFilter
  onChange: (next: BoardFilter) => void
  matchCount: number
  totalCount: number
}) {
  const { t } = useTranslation('atlas')
  const active = filterIsActive(filter)
  // Collapsed to one icon at rest -- the toolbar row is ~30px from
  // overflow at default width (its own recorded constraint), so the
  // group only spends space while in use.
  const [open, setOpen] = useState(false)
  const expanded = open || active
  const offerable = kinds.filter((k) => presentKindIDs.has(k.ID))
  const kindByID = new Map(kinds.map((k) => [k.ID, k]))

  const toggleKind = (id: string) => {
    const next = new Set(filter.kindIDs)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange({ ...filter, kindIDs: next })
  }

  if (!expanded) {
    return (
      <div className={styles.filterBar} data-testid="atlas-filter-bar">
        <IconButton icon={SearchIcon} size="small" variant="invisible" aria-label={t('filter.placeholder')} data-testid="atlas-filter-toggle" onClick={() => setOpen(true)} />
      </div>
    )
  }
  return (
    <div className={styles.filterBar} data-testid="atlas-filter-bar">
      <TextInput
        autoFocus={open && !active}
        size="small"
        leadingVisual={SearchIcon}
        placeholder={t('filter.placeholder')}
        aria-label={t('filter.placeholder')}
        value={filter.query}
        data-testid="atlas-filter-query"
        onChange={(e) => onChange({ ...filter, query: e.target.value })}
        className={styles.queryInput}
      />
      {offerable.length > 0 && (
        <ActionMenu>
          <ActionMenu.Button leadingVisual={TagIcon} size="small" variant="invisible" data-testid="atlas-filter-kinds">
            {t('filter.kinds')}
          </ActionMenu.Button>
          <ActionMenu.Overlay>
            <ActionList selectionVariant="multiple">
              {offerable.map((k) => (
                <ActionList.Item
                  key={k.ID}
                  selected={filter.kindIDs.has(k.ID)}
                  onSelect={() => toggleKind(k.ID)}
                  data-testid={`atlas-filter-kind-${k.ID}`}
                >
                  {k.Label}
                </ActionList.Item>
              ))}
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>
      )}
      {[...filter.kindIDs].map((id) => (
        <Token
          key={id}
          size="small"
          text={kindByID.get(id)?.Label ?? id}
          data-testid="atlas-filter-chip"
          onRemove={() => toggleKind(id)}
        />
      ))}
      {active && (
        <>
          <Button size="small" variant="invisible" data-testid="atlas-filter-clear" onClick={() => { setOpen(false); onChange({ query: '', kindIDs: new Set() }) }}>
            {t('filter.clear')}
          </Button>
          <Text size="small" className={styles.count} data-testid="atlas-filter-count">
            {t('filter.count', { matched: matchCount, total: totalCount })}
          </Text>
        </>
      )}
    </div>
  )
}
