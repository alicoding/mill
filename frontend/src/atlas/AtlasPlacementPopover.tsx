import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnchoredOverlay, Button, FormControl, TextInput } from '@primer/react'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { KindPicker } from './KindPicker'
import { lastUsedKindID, rememberLastUsedKind, resolveDefaultKindID } from './atlasCreateHelpers'
import styles from './AtlasPlacementPopover.module.css'

// The small Kind+Title confirm popover every creation door funnels
// through (goal 0081 slice A1's LOCKED design, sections 2 and 5,
// extended by slice A2 with an 'area' mode): a card placed from the
// tray/right-click, a note's promote-to-card ritual, or a drawn/
// grouped area's own "N cards move into this area" confirmation --
// same component, anchored at the fixed screen point the triggering
// gesture happened at (same detached-anchor AnchoredOverlay shape
// shared/ContextMenu.tsx already uses). Kind defaults to the last-used
// one (persisted in localStorage, atlasCreateHelpers.ts); promote mode
// prefills Title from the note's own text; area mode shows the
// membership statement above the form when the gesture enclosed
// existing cards, and stays silent for a draw-empty area.
//
// 'create' mode's own resting chrome is the two-beat loop itself (goal
// 0106 slice B contract item 4: C -> click -> title -> Enter -> board)
// -- no FormControl.Label headings, no visible Submit/Cancel row, just
// the kind chip (KindPicker's own click-to-change disclosure) and the
// title input; Enter/Escape (already wired below) are the only commit/
// cancel paths. 'promote'/'area' keep their existing labeled-form +
// button-row chrome untouched -- neither mode is part of this audit.
export function AtlasPlacementPopover({ mode, anchorPos, kinds, initialTitle, enclosedCount, onSubmit, onCancel }: {
  mode: 'create' | 'promote' | 'area'
  anchorPos: { x: number; y: number }
  kinds: Kind[]
  initialTitle?: string
  enclosedCount?: number
  onSubmit: (kindID: string, title: string) => void
  onCancel: () => void
}) {
  const { t } = useTranslation('atlas')
  const anchorRef = useRef<HTMLDivElement>(null)
  // AnchoredOverlay's own focus trap moves initial focus to the FIRST
  // focusable descendant by default (KindPicker's chip button, since it
  // renders before the title field) -- overriding it here is what
  // actually makes "C -> click -> title -> Enter" type immediately,
  // not "C -> click -> Tab -> title -> Enter".
  const titleRef = useRef<HTMLInputElement>(null)
  const [kindID, setKindID] = useState(() => resolveDefaultKindID(kinds, lastUsedKindID(kinds)))
  const [title, setTitle] = useState(initialTitle ?? '')

  const submit = () => {
    if (!title.trim() || !kindID) return
    rememberLastUsedKind(kindID)
    onSubmit(kindID, title.trim())
  }

  const dialogTitleKey = mode === 'promote' ? 'placement.promoteTitle' : mode === 'area' ? 'placement.areaTitle' : 'placement.title'

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
        focusTrapSettings={{ initialFocusRef: titleRef }}
        overlayProps={{ role: 'dialog', 'aria-label': t(dialogTitleKey), 'data-testid': 'atlas-placement-popover' } as never}
      >
        <div className={styles.form}>
          {mode === 'area' && !!enclosedCount && (
            <div className={styles.contextLine} data-testid="atlas-placement-context">
              {t('placement.areaContextLine', { count: enclosedCount })}
            </div>
          )}
          {mode === 'create' ? (
            <>
              <KindPicker kinds={kinds} value={kindID} onChange={setKindID} ariaLabel={t('placement.kindLabel')} testId="atlas-placement-kind" />
              <TextInput
                ref={titleRef}
                autoFocus
                block
                value={title}
                aria-label={t('placement.titleLabel')}
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
            </>
          ) : (
            <>
              <FormControl>
                <FormControl.Label>{t('placement.kindLabel')}</FormControl.Label>
                <KindPicker kinds={kinds} value={kindID} onChange={setKindID} ariaLabel={t('placement.kindLabel')} testId="atlas-placement-kind" />
              </FormControl>
              <FormControl>
                <FormControl.Label>{t('placement.titleLabel')}</FormControl.Label>
                <TextInput
                  ref={titleRef}
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
            </>
          )}
        </div>
      </AnchoredOverlay>
    </>
  )
}
