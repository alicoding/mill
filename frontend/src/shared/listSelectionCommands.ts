import type { Command } from './commands'
import { copy } from './copy'
import { focusedListSelection } from './listSelectionFocus'

// The list surfaces (goal 0404 S1): every InventoryList consumer that
// can carry a live selection. Atlas keeps its own marquee/⌘A pair
// (shared/atlasBoardCommands.ts) -- a spatial selection is a different
// mechanism by design, never folded into this one.
const LIST_SURFACES: Command['surface'] = ['configure', 'composition', 'secrets']

// ⌘A/Esc/⌫ all act on "whichever list surface currently holds focus"
// (shared/listSelectionFocus.ts) -- the same real-DOM-focus shape
// shared/listGridSearchFocus.ts already established for the identical
// problem (Configure's panes stay mounted-hidden once visited, so more
// than one InventoryList can exist in the DOM at once). hintOnly on
// all three: ⌘A is also the native select-all-text combo and Esc/⌫
// carry their own native meanings inside an editable field, so the
// real keydown handling is app/useKeymapDispatch.ts's own dedicated,
// editable-target-guarded listeners (the same reason atlas.selectAll/
// atlas.delete.selection are hintOnly) -- these three exist so the
// palette, HotkeyHint and the Shortcuts Help overlay can still name
// them.
export const LIST_SELECTION_COMMANDS: Command[] = [
  {
    id: 'list.selectAll',
    label: 'commands.list.selectAll',
    defaultBinding: { mods: ['cmd'], key: 'A' },
    hintOnly: true,
    surface: LIST_SURFACES,
    enabled: () => focusedListSelection() !== null,
    run: () => focusedListSelection()?.selectAll(),
  },
  {
    id: 'list.clearSelection',
    label: 'commands.list.clearSelection',
    defaultBinding: { mods: [], key: 'Escape' },
    hintOnly: true,
    surface: LIST_SURFACES,
    enabled: () => focusedListSelection()?.hasSelection() ?? false,
    run: () => focusedListSelection()?.clear(),
  },
  {
    id: 'list.deleteSelection',
    label: 'commands.list.deleteSelection',
    defaultBinding: { mods: [], key: 'Delete' },
    hintOnly: true,
    surface: LIST_SURFACES,
    bulk: true,
    // Absent (never a no-op button) for a list mounted in Trash mode
    // (goal 0406 S2): its own selectionHandle carries no deleteSelected.
    enabled: () => focusedListSelection()?.deleteSelected !== undefined && (focusedListSelection()?.hasSelection() ?? false),
    run: () => focusedListSelection()?.deleteSelected?.(),
  },
  // Restore / Delete forever (goal 0406 S2): the Trash section's own
  // bulk pair, present only while the focused list's own handle offers
  // restoreSelected/destroySelected (InventoryList's `selection.mode:
  // 'trash'`) -- generic here, not Secrets-specific, the same
  // "multi-purpose surface" shape list.deleteSelection already is.
  {
    id: 'list.restoreSelection',
    label: 'commands.list.restoreSelection',
    defaultBinding: null,
    hintOnly: true,
    surface: LIST_SURFACES,
    bulk: true,
    enabled: () => focusedListSelection()?.restoreSelected !== undefined && (focusedListSelection()?.hasSelection() ?? false),
    run: () => focusedListSelection()?.restoreSelected?.(),
  },
  {
    id: 'list.destroySelection',
    label: 'commands.list.destroySelection',
    defaultBinding: null,
    hintOnly: true,
    surface: LIST_SURFACES,
    bulk: true,
    // Irreversible, unlike Delete (to Trash) -- the one bulk action here
    // that asks first, batched into ONE question rather than the
    // per-row confirm goal 0346 slice B gives a single Delete forever.
    confirm: () => {
      const count = focusedListSelection()?.selectedCount() ?? 0
      return {
        title: copy('bulkTrash.destroyConfirmTitle', { count }),
        body: copy('bulkTrash.destroyConfirmBody'),
        confirmLabel: copy('bulkTrash.destroyConfirmButton'),
      }
    },
    enabled: () => focusedListSelection()?.destroySelected !== undefined && (focusedListSelection()?.hasSelection() ?? false),
    run: () => focusedListSelection()?.destroySelected?.(),
  },
  // Keyboard selection on the row Tab landed on (goal 0404 S1,
  // Gmail/Linear shape): the checkbox itself is out of the
  // tab order (InventoryRow.tsx), so Space/x toggle and Shift+Space
  // extends the range from the anchor -- Enter still opens (Primer's
  // own ActionList.Item keyboard handling, untouched). hintOnly: Space
  // is ALSO how Primer's own Item opens a row on Enter/Space alike, so
  // the real keydown handling is app/useKeymapDispatch.ts's own
  // dedicated listener, which preventDefaults the keydown early enough
  // to suppress the keypress Primer's own onSelect answers to.
  {
    id: 'list.toggleSelection',
    label: 'commands.list.toggleSelection',
    defaultBinding: { mods: [], key: 'Space' },
    extraBindings: [{ mods: [], key: 'X' }],
    hintOnly: true,
    surface: LIST_SURFACES,
    enabled: () => focusedListSelection() !== null,
    run: () => focusedListSelection()?.toggleFocusedRow(),
  },
  {
    id: 'list.extendSelection',
    label: 'commands.list.extendSelection',
    defaultBinding: { mods: ['shift'], key: 'Space' },
    hintOnly: true,
    surface: LIST_SURFACES,
    enabled: () => focusedListSelection() !== null,
    run: () => focusedListSelection()?.extendFocusedRow(),
  },
]
