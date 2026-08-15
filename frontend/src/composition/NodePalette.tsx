import { useMemo, useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Text, TextInput, TreeView } from '@primer/react'
import type { NodeType } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { PALETTE_GROUP_ICON, PALETTE_GROUP_LABEL, PALETTE_GROUP_ORDER, paletteGroupFor, shortLabel, type PaletteGroupId } from '../shared/paletteGroups'
import styles from './CompositionCanvas.module.css'

interface NodePaletteProps {
  nodeTypes: NodeType[]
  // Whether the canvas already has a Trigger node placed -- every
  // Trigger-kind entry gets disabled while true (see the component doc
  // comment below for why this has to be caught here, not just at Save).
  hasTrigger: boolean
}

function onPaletteDragStart(event: DragEvent<HTMLLIElement>, nt: NodeType) {
  event.dataTransfer.setData('application/mill-node-type', nt.ID)
  event.dataTransfer.effectAllowed = 'move'
}

// A plain themed icon, not a Kind-colored square (paletteGroups.ts's
// PALETTE_GROUP_ICON comment has the reasoning -- a display group can
// mix domain Kinds, so a single Kind-derived color would misrepresent
// some of its own members).
function groupIcon(group: PaletteGroupId) {
  const Icon = PALETTE_GROUP_ICON[group]
  return <Icon size={14} className={styles.paletteGroupIcon} />
}

// The "Add steps" drag-source panel -- toggled open/closed from
// CompositionCanvas.tsx's toolbar. Self-contained: drag-start just writes
// the dragged node type's ID onto the DOM drag event, which
// CompositionCanvas's onCanvasDrop reads back out on drop, so this
// component needs no callback prop wired in from the parent.
//
// Design wave 3 (goal 0001, audit §5): grouped by the frontend's own
// 9 display groups (paletteGroups.ts) instead of the 6 domain Kinds --
// see that file's header comment for why (14 of 29 node types share
// one Kind). Still a TreeView, not a flat list, for the same reason
// wave 1 introduced it (docs/SPEC.md §9.1, .claude/rules/frontend.md).
//
// Trigger entries disable once the canvas already has one: every Trigger
// node is a graph root (isValidConnection refuses an edge into one), so
// a second one always breaks findRoot's "exactly one starting node" rule
// server-side -- catching it here, at the source, is the same
// default-safe-guardrail shape SPEC.md §8 already uses elsewhere, and
// beats a raw Save-time error a user has to decode after the fact.
export function NodePalette({ nodeTypes, hasTrigger }: NodePaletteProps) {
  const { t } = useTranslation('composition')
  const [query, setQuery] = useState('')

  // Matches both the shortened palette label AND the full nt.Label
  // (task requirement -- "run" matches "Code: run command" even though
  // the palette itself only shows "Run command"), case-insensitive.
  const normalizedQuery = query.trim().toLowerCase()
  const matches = (nt: NodeType) => {
    if (!normalizedQuery) return true
    return nt.Label.toLowerCase().includes(normalizedQuery) || shortLabel(nt).toLowerCase().includes(normalizedQuery)
  }

  const byGroup = useMemo(() => {
    const map = new Map<string, NodeType[]>()
    for (const nt of nodeTypes) {
      const group = paletteGroupFor(nt)
      const list = map.get(group) ?? []
      list.push(nt)
      map.set(group, list)
    }
    return map
  }, [nodeTypes])

  const visibleGroups = PALETTE_GROUP_ORDER.filter((g) => (byGroup.get(g) ?? []).some(matches))
  const noMatches = normalizedQuery !== '' && visibleGroups.length === 0

  return (
    <div className={styles.palette} data-testid="palette-panel">
      <Text size="small" weight="semibold" className={styles.paletteHeading}>{t('nodePalette.addSteps')}</Text>
      <TextInput
        size="small"
        block
        placeholder={t('nodePalette.searchPlaceholder')}
        aria-label={t('nodePalette.searchAriaLabel')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        data-testid="palette-search"
        className={styles.paletteSearch}
      />
      {noMatches && (
        <Text as="p" size="small" className={styles.paletteNoMatches} data-testid="palette-no-matches">
          {t('nodePalette.noMatches', { query })}
        </Text>
      )}
      <TreeView aria-label={t('nodePalette.addSteps')}>
        {visibleGroups.map((group) => (
          <TreeView.Item key={group} id={`palette-group-${group}`} defaultExpanded data-testid="palette-group" data-group-id={group}>
            <TreeView.LeadingVisual>{groupIcon(group)}</TreeView.LeadingVisual>
            <span className={styles.paletteGroupLabel}>{PALETTE_GROUP_LABEL[group]}</span>
            <TreeView.SubTree>
              {(byGroup.get(group) ?? []).filter(matches).map((nt) => {
                const disabled = nt.Kind === 'trigger' && hasTrigger
                return (
                  <TreeView.Item
                    key={nt.ID}
                    id={`palette-item-${nt.ID}`}
                    className={`${styles.paletteItem} ${disabled ? styles.paletteItemDisabled : ''}`}
                    draggable={!disabled}
                    onDragStart={disabled ? undefined : (e) => onPaletteDragStart(e, nt)}
                    aria-disabled={disabled}
                    title={
                      disabled
                        ? t('nodePalette.onlyOneTriggerTitle')
                        : nt.Label
                    }
                    data-testid="palette-item"
                    data-node-type-id={nt.ID}
                  >
                    {shortLabel(nt)}
                  </TreeView.Item>
                )
              })}
            </TreeView.SubTree>
          </TreeView.Item>
        ))}
      </TreeView>
    </div>
  )
}
