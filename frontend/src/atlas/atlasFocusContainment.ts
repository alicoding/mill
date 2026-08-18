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

// The board's own selected node ids, read directly off the DOM's
// `.react-flow__node.selected` wrappers (React Flow's own `data-id`
// convention) rather than the selectedCards/selectedNotes state mirror
// (useAtlasSelection.ts) -- that mirror updates off React Flow's own
// onSelectionChange callback, which can still be mid-flight for one
// more render after the SAME click has already applied the `.selected`
// class (useNodesState's own onNodesChange path, a separate, faster
// mechanism). A keydown handler firing in that gap -- Escape or Enter
// immediately after the click that just selected something -- would
// otherwise read an empty selection. Regression: Escape right after a
// single-card select cleared nothing and climbed a level instead,
// since a single-card selection previously never took this ladder's
// "has a selection" branch under the old >=2 threshold, so the race
// was never reachable before goal 0102's per-card ladder.
export function readSelectedNodeIDs(wrapperRef: RefObject<HTMLElement | null>): string[] {
  const root = wrapperRef.current
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>('.react-flow__node.selected'))
    .map((el) => el.dataset.id)
    .filter((id): id is string => !!id)
}
