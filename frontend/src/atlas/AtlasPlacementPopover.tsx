import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnchoredOverlay, Button, FormControl, Select, TextInput } from '@primer/react'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { lastUsedKindID, rememberLastUsedKind, resolveDefaultKindID } from './atlasCreateHelpers'
import styles from './AtlasPlacementPopover.module.css'

// The small Kind+Title confirm popover every creation door funnels
// through (goal 0081 slice A1's LOCKED design, sections 2 and 5): a
// card placed from the tray/right-click, or a note's promote-to-card
// ritual -- same component, anchored at the fixed screen point the
// triggering gesture happened at (same detached-anchor AnchoredOverlay
// shape shared/ContextMenu.tsx already uses). Kind defaults to the
// last-used one (persisted in localStorage, atlasCreateHelpers.ts);
// promote mode prefills Title from the note's own text and swaps the
// primary button's label.
export function AtlasPlacementPopover({ mode, anchorPos, kinds, initialTitle, onSubmit, onCancel }: {
  mode: 'create' | 'promote'
  anchorPos: { x: number; y: number }
  kinds: Kind[]
  initialTitle?: string
  onSubmit: (kindID: string, title: string) => void
  onCancel: () => void
}) {
  const { t } = useTranslation('atlas')
  const anchorRef = useRef<HTMLDivElement>(null)
  const [kindID, setKindID] = useState(() => resolveDefaultKindID(kinds, lastUsedKindID(kinds)))
  const [title, setTitle] = useState(initialTitle ?? '')

  const submit = () => {
    if (!title.trim() || !kindID) return
    rememberLastUsedKind(kindID)
    onSubmit(kindID, title.trim())
  }

  return (
    <>
      <div
        ref={anchorRef}
        style={{ position: 'fixed', left: anchorPos.x, top: anchorPos.y, width: 1, height: 1, pointerEvents: 'none' }}
        aria-hidden="true"
      />
      <AnchoredOverlay
        open
        onClose={onCancel}
        renderAnchor={null}
        anchorRef={anchorRef}
        overlayProps={{ role: 'dialog', 'aria-label': t(mode === 'promote' ? 'placement.promoteTitle' : 'placement.title'), 'data-testid': 'atlas-placement-popover' } as never}
      >
        <div className={styles.form}>
          <FormControl>
            <FormControl.Label>{t('placement.kindLabel')}</FormControl.Label>
            <Select
              value={kindID}
              data-testid="atlas-placement-kind"
              block
              onChange={(e) => setKindID(e.target.value)}
            >
              {kinds.map((k) => (
                <Select.Option key={k.ID} value={k.ID}>{k.Icon ? `${k.Icon} ${k.Label}` : k.Label}</Select.Option>
              ))}
            </Select>
          </FormControl>
          <FormControl>
            <FormControl.Label>{t('placement.titleLabel')}</FormControl.Label>
            <TextInput
              autoFocus
              block
              value={title}
              data-testid="atlas-placement-title"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  onCancel()
                }
              }}
            />
          </FormControl>
          <div className={styles.buttonRow}>
            <Button size="small" variant="invisible" data-testid="atlas-placement-cancel" onClick={onCancel}>
              {t('cancel')}
            </Button>
            <Button
              size="small"
              variant="primary"
              data-testid="atlas-placement-submit"
              disabled={!title.trim() || !kindID}
              onClick={submit}
            >
              {t(mode === 'promote' ? 'placement.promote' : 'placement.add')}
            </Button>
          </div>
        </div>
      </AnchoredOverlay>
    </>
  )
}
