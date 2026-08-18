import type { RefObject } from 'react'

// Whether a keyboard event genuinely belongs to the BOARD, not some
// other surface (a Dialog, a popover, an AnchoredOverlay) currently
// holding focus -- shared by every board-level window keydown listener
// (useAtlasKeyboardNav's Tab/Arrows/Enter, useAtlasSelectionTray's
// Escape ladder) so a key meant to close/edit one of those surfaces
// never ALSO fires a board action in the same press (regression: an
// Escape closing the Lens dialog also drilled the board up a level,
// since nothing else excluded it). Two independent checks, since a
// surface can be excluded either way:
//   - Portal-rendered surfaces (Primer's Dialog: the card page, Lens,
//     Jump, matrix/coverage) mount OUTSIDE the board wrapper's own DOM
//     subtree -- activeElement containment catches these.
//   - In-wrapper surfaces (AtlasPlacementPopover's AnchoredOverlay,
//     a sticky note's own textarea) still pass containment, but their
//     own focused control is always an editable target -- callers
//     already guard with isEditableTarget separately, which is why
//     this helper only needs to check containment, not editability.
export function isFocusInsideBoard(wrapperRef: RefObject<HTMLElement | null>): boolean {
  const active = document.activeElement
  if (!active || active === document.body) return true
  return !!wrapperRef.current?.contains(active)
}
