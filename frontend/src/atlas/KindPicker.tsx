import { useRef, useState } from 'react'
import { ActionList, Button, Overlay } from '@primer/react'
import { TriangleDownIcon } from '@primer/octicons-react'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { kindColorTokens } from './atlasKindColor'
import styles from './KindPicker.module.css'

// The shared kind picker (goal 0081 slice A2's "kind picker
// legibility" rider): a bare kind NAME told a picker's reader nothing
// -- every option here renders its own color dot (the same
// atlasKindColor hash a card's chip/frame border already uses) + name
// + its declared one-line Description (muted, truncated), replacing
// the native <select> everywhere a Kind is chosen.
//
// Built on Primer's Overlay (frontend.md's overlay-machinery rule) --
// goal 0124 slice 2 replaced a hand-rolled position:absolute dropdown
// here after it clipped itself: rendered inside AtlasPlacementPopover's
// own AnchoredOverlay, that outer overlay sizes ITSELF to its
// non-absolute content (the kind chip + title field) and clips/scrolls
// anything absolutely positioned past that box -- confirmed live, the
// dropdown's own list was cut to a sliver. Overlay (not the higher-level
// AnchoredOverlay/ActionMenu, both of which wrap it with their own
// anchor-ref-to-state sync effect) is deliberate: ActionMenu was tried
// first and reproduced a confirmed React error #185 infinite-update
// loop live, every time it opened while nested inside
// AtlasPlacementPopover's own AnchoredOverlay -- two instances of that
// same anchor-tracking effect never converge nested in the same tree.
// Overlay carries none of that tracking: it portals to document.body
// (escaping the clipping ancestor) and renders at an explicit
// top/left this component computes itself from its own trigger's
// rect, still through the adopted kit's real floating-surface
// machinery (portal, focus trap, dismiss-on-outside-click, Escape)
// rather than a hand-positioned div.
export function KindPicker({ kinds, value, onChange, ariaLabel, testId }: {
  kinds: Kind[]
  value: string
  onChange: (kindID: string) => void
  ariaLabel: string
  testId?: string
}) {
  const [open, setOpen] = useState(false)
  const [anchorRect, setAnchorRect] = useState<{ top: number; left: number; width: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const selected = kinds.find((k) => k.ID === value)

  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) setAnchorRect({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    setOpen(true)
  }

  return (
    <>
      <Button
        ref={triggerRef}
        block
        trailingVisual={TriangleDownIcon}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={testId}
        className={styles.button}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        {selected ? (
          <span className={styles.selectedLabel}>
            <span className={styles.dot} style={{ background: `var(${kindColorTokens(selected.ID).emphasis})` }} aria-hidden="true" />
            {selected.Icon ? `${selected.Icon} ` : ''}{selected.Label}
          </span>
        ) : ariaLabel}
      </Button>
      {open && anchorRect && (
        <Overlay
          role="listbox"
          top={anchorRect.top}
          left={anchorRect.left}
          width="medium"
          maxHeight="small"
          returnFocusRef={triggerRef}
          onEscape={() => setOpen(false)}
          onClickOutside={() => setOpen(false)}
          ignoreClickRefs={[triggerRef]}
        >
          <ActionList selectionVariant="single">
            {kinds.map((k) => (
              <ActionList.Item
                key={k.ID}
                selected={k.ID === value}
                onSelect={() => {
                  onChange(k.ID)
                  setOpen(false)
                }}
                data-testid={testId ? `${testId}-option-${k.ID}` : undefined}
              >
                <ActionList.LeadingVisual>
                  <span className={styles.dot} style={{ background: `var(${kindColorTokens(k.ID).emphasis})` }} aria-hidden="true" />
                </ActionList.LeadingVisual>
                {k.Icon ? `${k.Icon} ` : ''}{k.Label}
                {k.Description && (
                  <ActionList.Description variant="block" truncate>{k.Description}</ActionList.Description>
                )}
              </ActionList.Item>
            ))}
          </ActionList>
        </Overlay>
      )}
    </>
  )
}
