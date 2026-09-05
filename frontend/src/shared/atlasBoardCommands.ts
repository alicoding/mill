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
    label: 'commands.atlas.arrange',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasArrange(),
  },
  {
    // The board's Contents dialog (docs/goals/0279): every card, note,
    // and object listed by kind with display names.
    id: 'atlas.contents.open',
    label: 'commands.atlas.contents.open',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasContents(),
  },
  {
    id: 'atlas.import',
    label: 'commands.atlas.import',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasImport(),
  },
  {
    id: 'atlas.export',
    label: 'commands.atlas.export',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasExport(),
  },
  {
    // "Copy as image" / "Export as image..." (docs/goals/0201): both
    // picture the LIVE selection, and with nothing selected both widen
    // to the whole board rather than refusing -- so the only state
    // that can make them invalid is an empty board, which is what
    // atlasBoardNodeCount answers.
    //
    // Unbound by construction, not by preference. The converged key for
    // this action is a bare Shift+Option+C, and comboFromEvent requires
    // Cmd or Ctrl specifically (shared/keybinding.ts's own doc comment):
    // a modifier set without one of those two never becomes a KeyCombo,
    // so no binding here could dispatch. Freely assignable in
    // Settings > Keyboard Shortcuts, same as every other
    // defaultBinding: null command.
    id: 'atlas.selection.copyAsImage',
    label: 'commands.atlas.selection.copyAsImage',
    defaultBinding: null,
    surface: ['atlas'],
    enabled: () => useUISignalStore.getState().atlasBoardNodeCount > 0,
    run: () => useUISignalStore.getState().requestAtlasCopyImage(),
  },
  {
    id: 'atlas.selection.exportAsImage',
    label: 'commands.atlas.selection.exportAsImage',
    defaultBinding: null,
    surface: ['atlas'],
    enabled: () => useUISignalStore.getState().atlasBoardNodeCount > 0,
    run: () => useUISignalStore.getState().requestAtlasExportImage(),
  },
  {
    id: 'atlas.addFromFolder',
    label: 'commands.atlas.addFromFolder',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasAddFromFolder(),
  },
  {
    id: 'atlas.share.copyContext',
    label: 'commands.atlas.share.copyContext',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasShareCopyContext(),
  },
  {
    id: 'atlas.share.copyLinks',
    label: 'commands.atlas.share.copyLinks',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasShareCopyLinks(),
  },
  {
    id: 'atlas.perspective',
    label: 'commands.atlas.perspective',
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
    label: 'commands.atlas.selectAll',
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
    label: 'commands.atlas.delete.selection',
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
    label: 'commands.atlas.group.selection',
    defaultBinding: { mods: [], key: 'G' },
    hintOnly: true,
    paletteHidden: true,
    surface: ['atlas'],
    run: () => {},
  },
  {
    // "Open in default app" (goal 0232 S1): a file-backed board
    // object's own registry command -- mouse-only by construction (its
    // target is whichever object was right-clicked, which the palette/
    // keyboard dispatch path has no way to supply), so paletteHidden
    // per that field's own doc comment, same shape atlas.delete.selection
    // above already takes for the identical constraint. The real,
    // per-object run() and its honest fileBacked+mirrorPath enablement
    // live in useAtlasObjectMenu.ts, which shares this commandId so the
    // menu item's label/HotkeyHint resolve from here.
    id: 'object.openInDefaultApp',
    label: 'commands.object.openInDefaultApp',
    defaultBinding: null,
    hintOnly: true,
    paletteHidden: true,
    surface: ['atlas'],
    run: () => {},
  },
  {
    // "Rename" (goal 0273): a table board object's own registry
    // command -- mouse-only by construction for the same reason
    // object.openInDefaultApp above is (its target is whichever object
    // was right-clicked, which the palette/keyboard dispatch path has
    // no way to supply), so paletteHidden per that field's own doc
    // comment. The real per-object run() and its honest Kind-based
    // enablement live in atlas/useAtlasObjectMenu.ts, which shares this
    // commandId so the menu item's label/HotkeyHint resolve from here.
    id: 'object.rename',
    label: 'commands.object.rename',
    defaultBinding: null,
    hintOnly: true,
    paletteHidden: true,
    surface: ['atlas'],
    run: () => {},
  },
  {
    // The Sparkle companion-panel toggle (goal 0101 slice 1,
    // AtlasToolbar.tsx) -- the button now calls this command instead of
    // toggleCompanion directly, same "button runs the command" shape
    // every other migrated action in goal 0222 S1 follows. Always valid
    // while on the atlas surface -- opening/closing has no invalid
    // state, so no `enabled` predicate is needed here.
    id: 'atlas.companion.toggle',
    label: 'commands.atlas.companion.toggle',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().toggleCompanion(),
  },
  {
    id: 'atlas.minimap.toggle',
    label: 'commands.atlas.minimap.toggle',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasMinimapToggle(),
  },
  {
    // Export-as (ADR-0043 §3, goal 0133 slice E1): the ONE command id
    // the card page's kebab menu and its right-click context menu also
    // key off (AtlasCardPageHeader.tsx / useAtlasLinkMenus.tsx), per the
    // integration-surfaces triage's "sharing commandIds" requirement.
    // Consumed by whichever card page is currently open
    // (AtlasCardOverlay.tsx); a harmless no-op with no card page open.
    id: 'atlas.card.exportAs',
    label: 'commands.atlas.card.exportAs',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasCardExportAs(),
  },
  // The six entries below (goal 0106 slice B) advertise useAtlasKeyboardNav.ts's
  // own key table (goal 0104) in the Shortcuts Help overlay -- every
  // one is unreachable by construction, same shape as
  // atlas.delete.selection/atlas.group.selection above: comboFromEvent
  // requires Cmd/Ctrl by design (shared/keybinding.ts), so none of
  // these bare/Option/Shift combos can ever be a REAL dispatched
  // binding, and each acts on live board focus/selection state the
  // palette has no way to supply -- paletteHidden keeps a dead click
  // out of it. The real handling stays entirely in
  // useAtlasKeyboardNav.ts's own window keydown listener.
  {
    id: 'atlas.focusNext',
    label: 'commands.atlas.focusNext',
    defaultBinding: { mods: [], key: 'Tab' },
    hintOnly: true,
    paletteHidden: true,
    surface: ['atlas'],
    run: () => {},
  },
  {
    id: 'atlas.focusPrevious',
    label: 'commands.atlas.focusPrevious',
    defaultBinding: { mods: ['shift'], key: 'Tab' },
    hintOnly: true,
    paletteHidden: true,
    surface: ['atlas'],
    run: () => {},
  },
  {
    id: 'atlas.focusDirection',
    label: 'commands.atlas.focusDirection',
    defaultBinding: { mods: ['option'], key: 'ArrowRight' },
    hintOnly: true,
    paletteHidden: true,
    surface: ['atlas'],
    run: () => {},
  },
  {
    id: 'atlas.openFocused',
    label: 'commands.atlas.openFocused',
    defaultBinding: { mods: [], key: 'Enter' },
    hintOnly: true,
    paletteHidden: true,
    surface: ['atlas'],
    run: () => {},
  },
  {
    id: 'atlas.nudgeSelection',
    label: 'commands.atlas.nudgeSelection',
    defaultBinding: { mods: [], key: 'ArrowRight' },
    hintOnly: true,
    paletteHidden: true,
    surface: ['atlas'],
    run: () => {},
  },
  {
    id: 'atlas.escapeLadder',
    label: 'commands.atlas.escapeLadder',
    defaultBinding: { mods: [], key: 'Escape' },
    hintOnly: true,
    paletteHidden: true,
    surface: ['atlas'],
    run: () => {},
  },
]
