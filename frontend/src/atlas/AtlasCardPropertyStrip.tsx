import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Select } from '@primer/react'
import type { Card, Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { freshnessDotColor } from './atlasCardPresentation'
import { statusFieldOf } from './atlasCardPageContent'
import { formatUpdated } from '../shared/inventorySort'
import { AtlasPerspectiveMembership } from './AtlasPerspectiveMembership'
import styles from './AtlasCardPage.module.css'

// The calm page's own compact property strip (goal 0106 slice B
// contract item 3): kind label · status as a chip · freshness dot ·
// perspective membership (ADR-0041, goal 0095 slice 2), one row, small
// type, no boxes -- directly under the title. Perspective membership
// renders nothing of its own when the space has adopted none (its own
// early return), so it never adds a section to a title-only card's
// otherwise-empty page.
//
// Status is a chip only when the displayed card's Kind declares the
// "existing status control" (statusFieldOf, atlasCardPageContent.ts) --
// an ordinary Options field keyed "status" (more than one built-in
// Kind declares one; Card itself carries no dedicated status field).
// At rest the chip shows the field's current value; clicking it swaps
// in that SAME field's own control (a plain Select, the same
// TypeOptions branch AtlasFieldsForm renders elsewhere) rather than a
// second, parallel status widget -- committing the instant a new
// option is chosen, matching AtlasFieldsForm's own discrete-commit
// rule, then collapsing back to the chip. A Kind with no such field
// declared renders no chip at all -- never a placeholder.
//
// Freshness reuses freshnessDotColor verbatim, the SAME function/
// trigger (a mirror synced within the last 7 days) the board's own
// front face already renders its dot from (AtlasNoteCardNode.tsx), so
// the page never disagrees with the board about which cards read
// fresh/stale.
export function AtlasCardPropertyStrip({ card, kind, fields, onFieldsChange, onFieldsCommit }: {
  card: Card
  kind: Kind | undefined
  fields: Record<string, string>
  onFieldsChange: (key: string, value: string) => void
  onFieldsCommit: (key: string, value: string) => void
}) {
  const { t } = useTranslation('atlas')
  const dot = freshnessDotColor(card)
  const freshnessLabel = dot === 'fresh'
    ? t('overlay.lastSynced', { when: formatUpdated(card.LastSyncedAt) })
    : t('overlay.neverSynced')
  const statusField = statusFieldOf(kind)
  const [editingStatus, setEditingStatus] = useState(false)
  const statusValue = statusField ? (fields[statusField.Key] || statusField.Default || '') : ''

  return (
    <div className={styles.propertyStrip} data-testid="atlas-page-property-strip">
      <span className={styles.propertyKind} data-testid="atlas-page-kind-label">{kind?.Label ?? ''}</span>

      {statusField && (
        editingStatus ? (
          <Select
            size="small"
            aria-label={statusField.Label}
            value={statusValue}
            data-testid="atlas-page-status-select"
            onChange={(e) => {
              const next = e.target.value
              onFieldsChange(statusField.Key, next)
              onFieldsCommit(statusField.Key, next)
              setEditingStatus(false)
            }}
            onBlur={() => setEditingStatus(false)}
          >
            {(statusField.Options ?? []).map((opt) => <Select.Option key={opt} value={opt}>{opt}</Select.Option>)}
          </Select>
        ) : (
          <button
            type="button"
            className={styles.statusChip}
            data-testid="atlas-page-status-chip"
            aria-label={t('page.changeStatus')}
            onClick={() => setEditingStatus(true)}
          >
            {statusValue}
          </button>
        )
      )}

      {dot && (
        <span
          className={`${styles.propertyDot} ${styles[`propertyDot-${dot}`]}`}
          data-testid="atlas-page-freshness-dot"
          aria-label={freshnessLabel}
        />
      )}

      <AtlasPerspectiveMembership cardID={card.ID} />
    </div>
  )
}
