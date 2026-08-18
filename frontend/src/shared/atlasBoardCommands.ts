import type { Command } from './commands'
import { useUISignalStore } from './uiSignalStore'

// The Atlas toolbar/board actions that were only ever reachable by
// clicking (goal 0071's discoverability trilogy extended to the rest
// of the surface) -- split out of shared/commands.ts (CLAUDE.md's
// 500-line convention), spread into its COMMANDS array. Every command
// here is `surface: ['atlas']`; each `run` just bumps a
// shared/uiSignalStore.ts counter the owning atlas/ component already
// watches, the same store-signal seam every other cross-bounded-
// context command in commands.ts uses.
export const ATLAS_BOARD_COMMANDS: Command[] = [
  {
    id: 'atlas.arrange',
    label: 'Auto-arrange',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasArrange(),
  },
  {
    id: 'atlas.import',
    label: 'Import atlas',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasImport(),
  },
  {
    id: 'atlas.export',
    label: 'Export atlas',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasExport(),
  },
  {
    id: 'atlas.addFromFolder',
    label: 'Add cards from a folder',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasAddFromFolder(),
  },
  {
    id: 'atlas.share.copyContext',
    label: 'Copy space as context',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasShareCopyContext(),
  },
  {
    id: 'atlas.share.copyLinks',
    label: 'Copy space links',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasShareCopyLinks(),
  },
  {
    id: 'atlas.perspective',
    label: 'Open perspective switcher',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasPerspectiveSwitcherOpen(),
  },
  {
    // ⌘A select-all: the real keydown is a dedicated, editable-target-
    // guarded listener in app/useKeymapDispatch.ts, not the generic
    // dispatch below -- a generic match would preventDefault()
    // unconditionally and break native select-all-text inside any
    // Atlas input. defaultBinding still drives HotkeyHint/the Shortcuts
    // Help overlay's display.
    id: 'atlas.selectAll',
    label: 'Select all',
    defaultBinding: { mods: ['cmd'], key: 'A' },
    hintOnly: true,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasSelectAll(),
  },
  {
    // Unreachable by construction: hintOnly skips generic dispatch,
    // paletteHidden excludes the palette, and ShortcutsHelpDialog's
    // rows carry no onSelect -- this entry exists only to satisfy
    // Command.run's required type. The real action lives in
    // useAtlasSelectionTray.ts's own onDelete/AtlasBoard's Delete/
    // Backspace listener.
    id: 'atlas.delete.selection',
    label: 'Delete selection',
    defaultBinding: { mods: [], key: 'Delete' },
    hintOnly: true,
    paletteHidden: true,
    surface: ['atlas'],
    run: () => {},
  },
  {
    // Unreachable by construction, same reasoning as atlas.delete.selection
    // above -- the real action lives in useAtlasSelectionTray.ts's own
    // triggerGroup/groupFromKeyboard.
    id: 'atlas.group.selection',
    label: 'Group into a new area',
    defaultBinding: { mods: [], key: 'G' },
    hintOnly: true,
    paletteHidden: true,
    surface: ['atlas'],
    run: () => {},
  },
]
