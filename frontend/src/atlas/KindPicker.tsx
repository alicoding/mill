import { useEffect, useRef, useState } from 'react'
import { ActionList, Button } from '@primer/react'
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
// A plain local-state disclosure, deliberately NOT Primer's
// ActionMenu (which wraps its own AnchoredOverlay): every caller of
// this component already renders it inside AtlasPlacementPopover's
// own AnchoredOverlay (a detached-anchor popover), and nesting a
// SECOND AnchoredOverlay-based component inside the first one crashes
// on mount -- confirmed live (React error #185, "Maximum update depth
// exceeded") in AnchoredOverlay's own anchor-ref-to-state sync
// (`if (anchorRef.current !== anchorElement) setAnchorElement(...)`,
// @primer/react's AnchoredOverlay.js), which never converges once a
// second instance of the same pattern sits inside the first one's
// portal. ActionList/ActionList.Item/LeadingVisual/Description --
// none of which carry their own overlay -- are still the right list
// primitive (frontend.md's "check the list family before hand-
// rolling"); only the disclosure chrome around them is hand-rolled
// here, and only for this reason.
export function KindPicker({ kinds, value, onChange, ariaLabel, testId }: {
  kinds: Kind[]
  value: string
  onChange: (kindID: string) => void
  ariaLabel: string
  testId?: string
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const selected = kinds.find((k) => k.ID === value)

  useEffect(() => {
    if (!open) return
    const onOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onOutside)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className={styles.container}>
      <Button
        block
        trailingVisual={TriangleDownIcon}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={testId}
        className={styles.button}
        onClick={() => setOpen((o) => !o)}
      >
        {selected ? (
          <span className={styles.selectedLabel}>
            <span className={styles.dot} style={{ background: `var(${kindColorTokens(selected.ID).emphasis})` }} aria-hidden="true" />
            {selected.Icon ? `${selected.Icon} ` : ''}{selected.Label}
          </span>
        ) : ariaLabel}
      </Button>
      {open && (
        <div className={styles.menu} role="listbox">
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
        </div>
      )}
    </div>
  )
}
