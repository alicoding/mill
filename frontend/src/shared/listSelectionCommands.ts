import type { Command } from './commands'
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
    enabled: () => focusedListSelection()?.hasSelection() ?? false,
    run: () => focusedListSelection()?.deleteSelected(),
  },
]
