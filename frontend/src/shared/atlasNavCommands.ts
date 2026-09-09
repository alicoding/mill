import type { Command } from './commands'
import { useUISignalStore } from './uiSignalStore'

// The Atlas board's own history and core projection-view commands,
// split out of shared/commands.ts (CLAUDE.md's 500-line convention)
// into the same "own file per feature-specific command cluster" shape
// every other *_COMMANDS export there already takes. Every one is a
// request signal the live AtlasView consumes -- shared/ can never
// import atlas/, so the store is the seam (shared/uiSignalStore.ts).
// A plugin-contributed pane needs no entry here: the loader composes
// its atlas.pluginView.<id>.open command per contribution (goal 0357).
export const ATLAS_NAV_COMMANDS: Command[] = [
// The board's ⌘Z/⇧⌘Z (goal 0219 S2, ADR-0044): null binding -- ⌘Z is
// ALSO native text-undo, dispatched by useKeymapDispatch.ts's own
// listener instead; these exist for palette/HotkeyHint discovery only.
{
  id: 'atlas.undo',
  menu: { path: 'atlas', group: 0, order: 2 },
  label: 'commands.atlas.undo',
  defaultBinding: null,
  surface: ['atlas'],
  run: () => useUISignalStore.getState().requestAtlasUndo(),
},
{
  id: 'atlas.redo',
  menu: { path: 'atlas', group: 0, order: 3 },
  label: 'commands.atlas.redo',
  defaultBinding: null,
  surface: ['atlas'],
  run: () => useUISignalStore.getState().requestAtlasRedo(),
},
{
  id: 'atlas.board.home',
  label: 'commands.atlas.boardHome',
  defaultBinding: null,
  surface: ['atlas'],
  // Palette-hidden: the switcher's Board segment is the on-screen door
  // for this action; the command exists so a contributed pane's
  // sandboxed page can reach "Escape swaps back to the Board" through
  // the registry (a frame's keydowns never leave it, goal 0357).
  paletteHidden: true,
  run: () => useUISignalStore.getState().requestAtlasBoardOpen(),
},
]
