import { describe, expect, it } from 'vitest'
import {
  EMPTY_SELECTION, LONG_PRESS_MOVE_TOLERANCE_PX, activateCheckbox, activateRow, clearSelected, extendFocus,
  isSelectionMode, longPressStillArmed, pruneSelection, rangeSelected, selectAllSelected, toggleSelected,
} from './listSelectionCore'

const IDS = ['a', 'b', 'c', 'd', 'e']

describe('toggleSelected', () => {
  it('adds an unselected id and sets it as the anchor', () => {
    const state = toggleSelected(EMPTY_SELECTION, 'b')
    expect([...state.selected]).toEqual(['b'])
    expect(state.anchor).toBe('b')
  })

  it('removes an already-selected id', () => {
    const once = toggleSelected(EMPTY_SELECTION, 'b')
    const twice = toggleSelected(once, 'b')
    expect(twice.selected.size).toBe(0)
  })
})

describe('rangeSelected (Shift-click)', () => {
  it('selects every id between the anchor and the target, inclusive', () => {
    const anchored = toggleSelected(EMPTY_SELECTION, 'b')
    const ranged = rangeSelected(anchored, IDS, 'd')
    expect([...ranged.selected].sort()).toEqual(['b', 'c', 'd'])
  })

  it('ranges backward from the anchor the same way', () => {
    const anchored = toggleSelected(EMPTY_SELECTION, 'd')
    const ranged = rangeSelected(anchored, IDS, 'b')
    expect([...ranged.selected].sort()).toEqual(['b', 'c', 'd'])
  })

  it('with no anchor yet, ranges from the target to itself (a bare toggle)', () => {
    const ranged = rangeSelected(EMPTY_SELECTION, IDS, 'c')
    expect([...ranged.selected]).toEqual(['c'])
  })

  it('a second Shift-click re-spans from the SAME original anchor, not the previous range end', () => {
    const anchored = toggleSelected(EMPTY_SELECTION, 'b')
    const first = rangeSelected(anchored, IDS, 'c')
    const second = rangeSelected(first, IDS, 'e')
    expect([...second.selected].sort()).toEqual(['b', 'c', 'd', 'e'])
    expect(second.anchor).toBe('b')
  })

  it('a stale anchor no longer in the (filtered) id list restarts the range at the target', () => {
    const staleAnchor = { ...EMPTY_SELECTION, anchor: 'z' }
    const ranged = rangeSelected(staleAnchor, IDS, 'c')
    expect([...ranged.selected]).toEqual(['c'])
  })

  it('anchor after clear: a fresh Shift-click with no prior selection ranges from itself alone', () => {
    const anchored = toggleSelected(EMPTY_SELECTION, 'b')
    const cleared = clearSelected(anchored)
    expect(cleared.anchor).toBeNull()
    const ranged = rangeSelected(cleared, IDS, 'd')
    expect([...ranged.selected]).toEqual(['d'])
  })
})

describe('selectAllSelected (⌘A)', () => {
  it('selects every id the caller currently passes -- select-all is over the POST-FILTER list', () => {
    const filtered = ['b', 'd']
    const state = selectAllSelected(EMPTY_SELECTION, filtered)
    expect([...state.selected].sort()).toEqual(['b', 'd'])
  })

  it('narrowing the filter after a select-all and calling it again reflects the NEW filtered set', () => {
    const all = selectAllSelected(EMPTY_SELECTION, IDS)
    const narrowed = selectAllSelected(all, ['a'])
    expect([...narrowed.selected]).toEqual(['a'])
  })
})

describe('clearSelected', () => {
  it('empties the selection and drops the anchor', () => {
    const state = rangeSelected(toggleSelected(EMPTY_SELECTION, 'a'), IDS, 'c')
    const cleared = clearSelected(state)
    expect(cleared.selected.size).toBe(0)
    expect(cleared.anchor).toBeNull()
  })
})

describe('isSelectionMode', () => {
  it('is false for an empty selection, true once anything is selected', () => {
    expect(isSelectionMode(EMPTY_SELECTION)).toBe(false)
    expect(isSelectionMode(toggleSelected(EMPTY_SELECTION, 'a'))).toBe(true)
  })
})

describe('activateRow (a row click, each modifier)', () => {
  it('a plain click leaves state untouched and tells the caller to open the row', () => {
    const { state, opensRow } = activateRow(EMPTY_SELECTION, IDS, 'b', { shiftKey: false, toggleModifier: false })
    expect(opensRow).toBe(true)
    expect(state).toBe(EMPTY_SELECTION)
  })

  it('Cmd/Ctrl-click toggles the row and does not open it', () => {
    const { state, opensRow } = activateRow(EMPTY_SELECTION, IDS, 'b', { shiftKey: false, toggleModifier: true })
    expect(opensRow).toBe(false)
    expect([...state.selected]).toEqual(['b'])
  })

  it('Shift-click ranges from the anchor and does not open the row', () => {
    const anchored = toggleSelected(EMPTY_SELECTION, 'b')
    const { state, opensRow } = activateRow(anchored, IDS, 'd', { shiftKey: true, toggleModifier: false })
    expect(opensRow).toBe(false)
    expect([...state.selected].sort()).toEqual(['b', 'c', 'd'])
  })

  it('Shift wins over the toggle modifier when both are held', () => {
    const anchored = toggleSelected(EMPTY_SELECTION, 'b')
    const { opensRow, state } = activateRow(anchored, IDS, 'd', { shiftKey: true, toggleModifier: true })
    expect(opensRow).toBe(false)
    expect([...state.selected].sort()).toEqual(['b', 'c', 'd'])
  })
})

describe('activateCheckbox (a checkbox click, each modifier -- goal 0404 S1 amendment 2026-09-09)', () => {
  it('a plain click TOGGLES -- unlike a row click, a checkbox never opens anything', () => {
    const state = activateCheckbox(EMPTY_SELECTION, IDS, 'b', { shiftKey: false, toggleModifier: false })
    expect([...state.selected]).toEqual(['b'])
    const twice = activateCheckbox(state, IDS, 'b', { shiftKey: false, toggleModifier: false })
    expect(twice.selected.size).toBe(0)
  })

  it('Cmd/Ctrl-click toggles, same as a plain click on a checkbox', () => {
    const state = activateCheckbox(EMPTY_SELECTION, IDS, 'b', { shiftKey: false, toggleModifier: true })
    expect([...state.selected]).toEqual(['b'])
  })

  it('Shift-click on the checkbox ranges from the anchor, exactly like Shift-click on the row body', () => {
    const anchored = toggleSelected(EMPTY_SELECTION, 'b')
    const state = activateCheckbox(anchored, IDS, 'd', { shiftKey: true, toggleModifier: false })
    expect([...state.selected].sort()).toEqual(['b', 'c', 'd'])
  })

  it('a second Shift-click on a checkbox re-spans from the SAME anchor, not the previous range end', () => {
    const anchored = toggleSelected(EMPTY_SELECTION, 'b')
    const first = activateCheckbox(anchored, IDS, 'c', { shiftKey: true, toggleModifier: false })
    const second = activateCheckbox(first, IDS, 'e', { shiftKey: true, toggleModifier: false })
    expect([...second.selected].sort()).toEqual(['b', 'c', 'd', 'e'])
  })

  it('matches activateRow\'s own state for every modifier combination except a plain click', () => {
    for (const mods of [{ shiftKey: true, toggleModifier: false }, { shiftKey: false, toggleModifier: true }, { shiftKey: true, toggleModifier: true }]) {
      const anchored = toggleSelected(EMPTY_SELECTION, 'b')
      const checkbox = activateCheckbox(anchored, IDS, 'd', mods)
      const row = activateRow(anchored, IDS, 'd', mods)
      expect(checkbox).toEqual(row.state)
    }
  })
})

describe('extendFocus (Shift+↑/↓)', () => {
  it('with nothing focused yet, Shift+Down starts at the first row', () => {
    const state = extendFocus(EMPTY_SELECTION, IDS, 'down')
    expect(state.focusedId).toBe('a')
    expect([...state.selected]).toEqual(['a'])
  })

  it('extends the range downward and moves focus onto the new row', () => {
    const first = extendFocus(EMPTY_SELECTION, IDS, 'down')
    const second = extendFocus(first, IDS, 'down')
    expect(second.focusedId).toBe('b')
    expect([...second.selected].sort()).toEqual(['a', 'b'])
  })

  it('extends upward the same way from a focus further down the list', () => {
    const focused = { ...EMPTY_SELECTION, focusedId: 'c' }
    const state = extendFocus(focused, IDS, 'up')
    expect(state.focusedId).toBe('b')
    expect([...state.selected].sort()).toEqual(['b', 'c'])
  })

  it('never moves focus past the first or last row', () => {
    const atStart = { ...EMPTY_SELECTION, focusedId: 'a' }
    expect(extendFocus(atStart, IDS, 'up').focusedId).toBe('a')
    const atEnd = { ...EMPTY_SELECTION, focusedId: 'e' }
    expect(extendFocus(atEnd, IDS, 'down').focusedId).toBe('e')
  })
})

describe('pruneSelection (a changed filter/search never leaves a phantom row checked)', () => {
  it('drops a selected id no longer present in the new filtered set', () => {
    const state = toggleSelected(toggleSelected(EMPTY_SELECTION, 'a'), 'b')
    const pruned = pruneSelection(state, ['b', 'c'])
    expect([...pruned.selected]).toEqual(['b'])
  })

  it('drops a stale anchor/focus the same way', () => {
    const state = { ...toggleSelected(EMPTY_SELECTION, 'a'), focusedId: 'a' }
    const pruned = pruneSelection(state, ['b'])
    expect(pruned.anchor).toBeNull()
    expect(pruned.focusedId).toBeNull()
  })

  it('returns the SAME instance when nothing changes (no unnecessary re-render)', () => {
    const state = toggleSelected(EMPTY_SELECTION, 'a')
    expect(pruneSelection(state, ['a', 'b'])).toBe(state)
  })

  it('is a no-op on an already-empty selection', () => {
    expect(pruneSelection(EMPTY_SELECTION, ['a'])).toBe(EMPTY_SELECTION)
  })
})

describe('longPressStillArmed', () => {
  it('stays armed for a hold within the movement tolerance', () => {
    expect(longPressStillArmed({ x: 100, y: 100 }, { x: 100 + LONG_PRESS_MOVE_TOLERANCE_PX, y: 100 })).toBe(true)
  })

  it('disarms once the pointer travels past the tolerance -- a scroll/drag, not a hold', () => {
    expect(longPressStillArmed({ x: 100, y: 100 }, { x: 100 + LONG_PRESS_MOVE_TOLERANCE_PX + 5, y: 100 })).toBe(false)
  })
})
