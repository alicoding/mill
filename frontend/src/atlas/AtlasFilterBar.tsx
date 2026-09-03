import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, ActionMenu, Button, IconButton, Text, TextInput, Token } from '@primer/react'
import { FilterIcon, SearchIcon, TagIcon } from '@primer/octicons-react'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { type BoardFilter, facetFieldsFrom, filterIsActive } from './cardFilter'
import styles from './AtlasFilterBar.module.css'
import { searchInputTextAssistOff } from '../shared/searchInputProps'

// The board filter group (goal 0129 slices 1+3): text + kinds +
// attribute values, ANDed, applied as DIM-in-place by the board
// (cardFilter.ts is the one predicate). Lives on the breadcrumb row --
// the actions row's own comment forbids further additions there.
// Transient by design: a query is a question about the board, never a
// configuration of it (the hide-kinds lens stays the persistent
// concept).
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
  const facetFields = facetFieldsFrom(offerable)
  const facetLabel = new Map(facetFields.map((f) => [f.key, f.label]))

  const toggleKind = (id: string) => {
    const next = new Set(filter.kindIDs)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange({ ...filter, kindIDs: next })
  }

  const toggleFieldValue = (key: string, value: string) => {
    const next = new Map(filter.fieldValues)
    const values = new Set(next.get(key))
    if (values.has(value)) values.delete(value)
    else values.add(value)
    if (values.size === 0) next.delete(key)
    else next.set(key, values)
    onChange({ ...filter, fieldValues: next })
  }

  if (!expanded) {
    return (
      <div className={styles.filterBar} data-testid="atlas-filter-bar">
        <IconButton icon={SearchIcon} size="small" variant="invisible" aria-label={t('filter.placeholder')}
        {...searchInputTextAssistOff} data-testid="atlas-filter-toggle" onClick={() => setOpen(true)} />
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
        {...searchInputTextAssistOff}
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
      {facetFields.length > 0 && (
        <ActionMenu>
          <ActionMenu.Button leadingVisual={FilterIcon} size="small" variant="invisible" data-testid="atlas-filter-fields">
            {t('filter.fields')}
          </ActionMenu.Button>
          <ActionMenu.Overlay>
            <ActionList selectionVariant="multiple">
              {facetFields.map((f) => (
                <ActionList.Group key={f.key}>
                  <ActionList.GroupHeading>{f.label}</ActionList.GroupHeading>
                  {f.values.map((v) => (
                    <ActionList.Item
                      key={v}
                      selected={filter.fieldValues.get(f.key)?.has(v) ?? false}
                      onSelect={() => toggleFieldValue(f.key, v)}
                      data-testid={`atlas-filter-field-${f.key}-${v}`}
                    >
                      {v}
                    </ActionList.Item>
                  ))}
                </ActionList.Group>
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
      {[...filter.fieldValues].flatMap(([key, values]) =>
        [...values].map((v) => (
          <Token
            key={`${key}:${v}`}
            size="small"
            text={`${facetLabel.get(key) ?? key}: ${v}`}
            data-testid="atlas-filter-field-chip"
            onRemove={() => toggleFieldValue(key, v)}
          />
        )),
      )}
      {active && (
        <>
          <Button size="small" variant="invisible" data-testid="atlas-filter-clear" onClick={() => { setOpen(false); onChange({ query: '', kindIDs: new Set(), fieldValues: new Map() }) }}>
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
